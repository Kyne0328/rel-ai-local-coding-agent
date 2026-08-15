import fs from 'node:fs';
import path from 'node:path';

import { boundedInteger } from './limits.js';

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_NODES = 5000;
const DEFAULT_MAX_EDGES = 20000;
const MAX_COMMUNITY_ITERATIONS = 8;

const EDGE_WEIGHTS = Object.freeze({
  HTTP_CALLS: 5,
  CALLS: 4,
  INHERITS: 3,
  IMPLEMENTS: 3,
  IMPORTS: 2,
  EMITS: 2,
  TESTS: 1,
  USES_TYPE: 1,
  HANDLES: 1,
  LISTENS_ON: 1
});

function analyzeArchitecture(db, options = {}) {
  const maxResults = boundedInteger(options.maxResults, 1, 200, DEFAULT_MAX_RESULTS);
  const maxNodes = boundedInteger(options.maxNodes, 100, 10000, DEFAULT_MAX_NODES);
  const maxEdges = boundedInteger(options.maxEdges, 100, 50000, DEFAULT_MAX_EDGES);
  const totalFileCount = Number(db.prepare('SELECT count(*) AS count FROM files').get()?.count || 0);
  const files = selectRepresentativeFiles(db, maxNodes);
  const byId = new Map(files.map(file => [file.id, file]));
  const edgeSelection = selectArchitectureEdges(db, files.map(file => file.id), maxEdges);
  const edges = edgeSelection.edges;

  const relationshipTypes = {};
  const adjacency = new Map(files.map(file => [file.id, new Map()]));
  for (const edge of edges) {
    const target = edge.target == null ? null : byId.get(edge.target);
    relationshipTypes[edge.type] = Number(relationshipTypes[edge.type] || 0) + 1;
    if (!target) continue;
    const weight = EDGE_WEIGHTS[edge.type] || 1;
    addNeighbor(adjacency, edge.source, edge.target, weight);
    addNeighbor(adjacency, edge.target, edge.source, weight);
  }

  const modules = moduleSummary(files, edges, maxResults);
  const entryPoints = rankEntryPoints(files, maxResults, options.workspaceRoot);
  const hotspots = rankHotspots(files, maxResults);
  const dependencyAnalysis = dependencyLayers(modules.allItems, modules.edgeWeights);
  const communities = detectCommunities(files, adjacency, maxResults);
  const truncated = totalFileCount > files.length || edgeSelection.truncated;

  return {
    architecture: {
      strategy: 'bounded-file-graph',
      totalFileCount,
      analyzedFileCount: files.length,
      analyzedEdgeCount: edges.length,
      maxNodes,
      maxEdges,
      truncated
    },
    relationshipTypes,
    modules: modules.items,
    entryPoints,
    hotspots,
    layers: dependencyAnalysis.layers,
    cycles: dependencyAnalysis.cycles,
    communities,
    summary: {
      files: totalFileCount,
      analyzedFiles: files.length,
      edges: edges.length,
      modules: modules.allItems.length,
      cycles: dependencyAnalysis.cycles.length,
      communities: communities.length,
      entryPoints: entryPoints.length,
      hotspots: hotspots.length
    },
    truncated,
    next: 'Use entryPoints for repository bootstrap, hotspots for high-impact review, and modules/layers/cycles/communities to choose the smallest source boundary before reading code.'
  };
}

function selectRepresentativeFiles(db, maxNodes) {
  return db.prepare(`
    WITH symbol_counts AS (
      SELECT file_id, count(*) AS symbol_count FROM symbols GROUP BY file_id
    ), edge_rows AS (
      SELECT source_file_id AS file_id,
             0 AS incoming,
             count(*) AS outgoing,
             sum(CASE WHEN type='HANDLES' THEN 1 ELSE 0 END) AS route_count,
             sum(CASE WHEN type='TESTS' THEN 1 ELSE 0 END) AS test_links
      FROM edges GROUP BY source_file_id
      UNION ALL
      SELECT target_file_id AS file_id,
             count(*) AS incoming,
             0 AS outgoing,
             0 AS route_count,
             sum(CASE WHEN type='TESTS' THEN 1 ELSE 0 END) AS test_links
      FROM edges WHERE target_file_id IS NOT NULL GROUP BY target_file_id
    ), edge_counts AS (
      SELECT file_id,
             sum(incoming) AS incoming,
             sum(outgoing) AS outgoing,
             sum(route_count) AS route_count,
             sum(test_links) AS test_links
      FROM edge_rows GROUP BY file_id
    )
    SELECT f.id, f.path, f.language, f.is_test,
           coalesce(s.symbol_count, 0) AS symbol_count,
           coalesce(e.incoming, 0) AS incoming,
           coalesce(e.outgoing, 0) AS outgoing,
           coalesce(e.route_count, 0) AS route_count,
           coalesce(e.test_links, 0) AS test_links
    FROM files f
    LEFT JOIN symbol_counts s ON s.file_id=f.id
    LEFT JOIN edge_counts e ON e.file_id=f.id
    ORDER BY f.is_test,
             (coalesce(e.incoming, 0) * 2 + coalesce(e.outgoing, 0) + coalesce(s.symbol_count, 0) * 0.25
               + coalesce(e.route_count, 0) * 3 + coalesce(e.test_links, 0)) DESC,
             f.path
    LIMIT ?
  `).all(maxNodes).map(row => ({
    id: Number(row.id), path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1,
    symbolCount: Number(row.symbol_count || 0), incoming: Number(row.incoming || 0), outgoing: Number(row.outgoing || 0),
    routeCount: Number(row.route_count || 0), testLinks: Number(row.test_links || 0)
  }));
}

function selectArchitectureEdges(db, fileIds, maxEdges) {
  const ids = [...new Set(fileIds.map(Number).filter(Number.isSafeInteger))];
  if (!ids.length) return { edges: [], truncated: false };
  const placeholders = ids.map(() => '?').join(',');
  const perSourceLimit = Math.max(1, Math.ceil(maxEdges / ids.length));
  const rows = db.prepare(`
    WITH ranked AS (
      SELECT id, source_file_id, target_file_id, type, target_name, confidence,
             row_number() OVER (
               PARTITION BY source_file_id
               ORDER BY CASE type
                 WHEN 'HTTP_CALLS' THEN 10 WHEN 'CALLS' THEN 9 WHEN 'INHERITS' THEN 8 WHEN 'IMPLEMENTS' THEN 8
                 WHEN 'IMPORTS' THEN 7 WHEN 'EMITS' THEN 6 WHEN 'TESTS' THEN 5 WHEN 'USES_TYPE' THEN 4
                 WHEN 'HANDLES' THEN 3 WHEN 'LISTENS_ON' THEN 3 ELSE 1 END DESC,
                 confidence DESC, id
             ) AS source_rank,
             count(*) OVER (PARTITION BY source_file_id) AS source_edge_count
      FROM edges
      WHERE source_file_id IN (${placeholders})
        AND (target_file_id IS NULL OR target_file_id IN (${placeholders}))
    )
    SELECT id, source_file_id, target_file_id, type, target_name, source_edge_count
    FROM ranked
    WHERE source_rank <= ?
    ORDER BY source_rank, source_file_id, id
    LIMIT ?
  `).all(...ids, ...ids, perSourceLimit, maxEdges);
  return {
    edges: rows.map(row => ({
      source: Number(row.source_file_id),
      target: row.target_file_id == null ? null : Number(row.target_file_id),
      type: String(row.type),
      targetName: row.target_name == null ? null : String(row.target_name)
    })),
    truncated: rows.length >= maxEdges || rows.some(row => Number(row.source_edge_count || 0) > perSourceLimit)
  };
}

function moduleSummary(files, edges, maxResults) {
  const byModule = new Map();
  const moduleByFile = new Map();
  for (const file of files) {
    const name = moduleForPath(file.path);
    moduleByFile.set(file.id, name);
    const item = byModule.get(name) || {
      name, fileCount: 0, symbolCount: 0, testFileCount: 0, incoming: 0, outgoing: 0,
      internalEdges: 0, externalEdges: 0, languages: new Map(), files: []
    };
    item.fileCount += 1;
    item.symbolCount += file.symbolCount;
    item.testFileCount += file.test ? 1 : 0;
    item.languages.set(file.language, Number(item.languages.get(file.language) || 0) + 1);
    item.files.push(file);
    byModule.set(name, item);
  }

  const edgeWeights = new Map();
  for (const edge of edges) {
    const from = moduleByFile.get(edge.source);
    const to = moduleByFile.get(edge.target);
    if (!from || !to) continue;
    const source = byModule.get(from);
    const target = byModule.get(to);
    if (from === to) {
      source.internalEdges += 1;
      continue;
    }
    source.outgoing += 1;
    source.externalEdges += 1;
    target.incoming += 1;
    target.externalEdges += 1;
    const key = `${from}\u0000${to}`;
    edgeWeights.set(key, Number(edgeWeights.get(key) || 0) + (EDGE_WEIGHTS[edge.type] || 1));
  }

  const items = [...byModule.values()].map(item => ({
    name: item.name,
    fileCount: item.fileCount,
    symbolCount: item.symbolCount,
    testFileCount: item.testFileCount,
    incoming: item.incoming,
    outgoing: item.outgoing,
    internalEdges: item.internalEdges,
    externalEdges: item.externalEdges,
    languages: Object.fromEntries([...item.languages.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    representativeFiles: item.files
      .sort((a, b) => fileImportance(b) - fileImportance(a) || a.path.localeCompare(b.path))
      .slice(0, 5)
      .map(file => file.path)
  })).sort((a, b) => b.fileCount - a.fileCount || b.externalEdges - a.externalEdges || a.name.localeCompare(b.name));

  return { items: items.slice(0, maxResults), allItems: items, edgeWeights };
}

function rankEntryPoints(files, maxResults, workspaceRoot = '') {
  const explicit = packageEntryHints(workspaceRoot);
  return files.map(file => {
    if (!isExecutableLanguage(file.language)) return { path: file.path, score: 0 };
    const reasons = [];
    let score = 0;
    const basename = basenameWithoutExtension(file.path);
    if (explicit.has(file.path)) { score += 20; reasons.push('package-entry'); }
    if (/^(?:main|server|cli|worker|bootstrap|start)$/.test(basename)) { score += 8; reasons.push(`entry-name:${basename}`); }
    else if (basename === 'app') { score += 5; reasons.push('entry-name:app'); }
    else if (basename === 'index') { score += 2; reasons.push('entry-name:index'); }
    if (!file.path.includes('/')) { score += 3; reasons.push('repository-root'); }
    if (file.routeCount) { score += Math.min(6, file.routeCount * 2); reasons.push(`routes:${file.routeCount}`); }
    if (file.incoming === 0 && file.outgoing > 0) { score += 4; reasons.push('no-incoming-dependencies'); }
    if (/^(?:bin|cmd|scripts?|electron)\//.test(file.path)) { score += 2; reasons.push('entry-directory'); }
    if (file.test) score -= 12;
    return { path: file.path, language: file.language, score, incoming: file.incoming, outgoing: file.outgoing, reasons };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.outgoing - a.outgoing || a.path.localeCompare(b.path))
    .slice(0, maxResults);
}

function packageEntryHints(workspaceRoot) {
  const root = String(workspaceRoot || '').trim();
  const result = new Set();
  if (!root) return result;
  for (const relativeManifest of ['package.json', 'electron/package.json']) {
    try {
      const file = path.join(root, ...relativeManifest.split('/'));
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      const base = path.posix.dirname(relativeManifest) === '.' ? '' : path.posix.dirname(relativeManifest);
      for (const value of [pkg.main, pkg.module, pkg.browser]) addEntryHint(result, base, value);
      for (const value of Object.values(pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : {})) addEntryHint(result, base, value);
      for (const command of Object.values(pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {})) {
        const match = String(command || '').match(/(?:^|\s)node\s+([^\s;&|]+)/);
        if (match) addEntryHint(result, base, match[1]);
      }
    } catch {}
  }
  return result;
}

function addEntryHint(result, base, value) {
  const text = String(value || '').trim().replace(/^\.\//, '').replaceAll('\\', '/');
  if (!text || text.includes('*')) return;
  result.add(base ? path.posix.join(base, text) : text);
}

function isExecutableLanguage(language) {
  return new Set(['javascript', 'typescript', 'tsx', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'c', 'cpp', 'ruby', 'php', 'dart', 'swift']).has(String(language || ''));
}

function rankHotspots(files, maxResults) {
  return files.map(file => ({
    path: file.path,
    language: file.language,
    test: file.test,
    score: Number((file.incoming * 2 + file.outgoing + file.symbolCount * 0.25 + file.routeCount * 3 + file.testLinks).toFixed(2)),
    incoming: file.incoming,
    outgoing: file.outgoing,
    symbolCount: file.symbolCount,
    routeCount: file.routeCount,
    testLinks: file.testLinks
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.incoming - a.incoming || a.path.localeCompare(b.path))
    .slice(0, maxResults);
}

function dependencyLayers(modules, edgeWeights) {
  const names = new Set(modules.map(item => item.name));
  const dependencies = new Map([...names].map(name => [name, new Set()]));
  for (const key of edgeWeights.keys()) {
    const [from, to] = key.split('\u0000');
    if (from !== to && names.has(from) && names.has(to)) dependencies.get(from).add(to);
  }

  const components = stronglyConnectedComponents(dependencies);
  const componentByName = new Map();
  components.forEach((component, index) => {
    for (const name of component) componentByName.set(name, index);
  });
  const componentDependencies = new Map(components.map((_component, index) => [index, new Set()]));
  for (const [from, targets] of dependencies) {
    const fromComponent = componentByName.get(from);
    for (const to of targets) {
      const toComponent = componentByName.get(to);
      if (fromComponent !== toComponent) componentDependencies.get(fromComponent).add(toComponent);
    }
  }

  const depthMemo = new Map();
  const componentDepth = componentId => {
    if (depthMemo.has(componentId)) return depthMemo.get(componentId);
    const targets = [...componentDependencies.get(componentId)];
    const depth = targets.length ? 1 + Math.max(...targets.map(componentDepth)) : 0;
    depthMemo.set(componentId, depth);
    return depth;
  };
  const grouped = new Map();
  for (const name of [...names].sort()) {
    const depth = componentDepth(componentByName.get(name));
    if (!grouped.has(depth)) grouped.set(depth, []);
    grouped.get(depth).push(name);
  }
  const layers = [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([depth, moduleNames]) => ({
    depth,
    role: depth === 0 ? 'foundation' : 'consumer',
    modules: moduleNames
  }));
  const cycles = components
    .filter(component => component.length > 1)
    .map(component => ({ modules: [...component].sort(), size: component.length }))
    .sort((a, b) => b.size - a.size || a.modules[0].localeCompare(b.modules[0]));
  return { layers, cycles };
}

function stronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const stack = [];
  const onStack = new Set();
  const indexByNode = new Map();
  const lowLink = new Map();
  const components = [];

  const visit = node => {
    indexByNode.set(node, nextIndex);
    lowLink.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) || []) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowLink.set(node, Math.min(lowLink.get(node), lowLink.get(target)));
      } else if (onStack.has(target)) {
        lowLink.set(node, Math.min(lowLink.get(node), indexByNode.get(target)));
      }
    }

    if (lowLink.get(node) !== indexByNode.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component);
  };

  for (const node of [...graph.keys()].sort()) if (!indexByNode.has(node)) visit(node);
  return components;
}

function detectCommunities(files, adjacency, maxResults) {
  const labels = new Map(files.map(file => [file.id, file.id]));
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (let iteration = 0; iteration < MAX_COMMUNITY_ITERATIONS; iteration += 1) {
    let changed = false;
    for (const file of ordered) {
      const neighbors = adjacency.get(file.id);
      if (!neighbors?.size) continue;
      const scores = new Map();
      for (const [neighborId, weight] of neighbors) {
        const label = labels.get(neighborId);
        scores.set(label, Number(scores.get(label) || 0) + weight);
      }
      const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0]?.[0];
      if (best != null && best !== labels.get(file.id)) { labels.set(file.id, best); changed = true; }
    }
    if (!changed) break;
  }

  const grouped = new Map();
  for (const file of files) {
    const label = labels.get(file.id);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(file);
  }
  return [...grouped.values()].filter(group => group.length > 1).map(group => ({
    name: communityName(group.map(file => file.path)),
    fileCount: group.length,
    files: group.sort((a, b) => fileImportance(b) - fileImportance(a) || a.path.localeCompare(b.path)).slice(0, 8).map(file => file.path),
    languages: [...new Set(group.map(file => file.language))].sort()
  })).sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name)).slice(0, maxResults);
}

function addNeighbor(adjacency, source, target, weight) {
  const neighbors = adjacency.get(source);
  if (!neighbors) return;
  neighbors.set(target, Number(neighbors.get(target) || 0) + weight);
}

function fileImportance(file) {
  return file.incoming * 2 + file.outgoing + file.symbolCount * 0.25 + file.routeCount * 3 + file.testLinks;
}

function moduleForPath(filePath) {
  const parts = String(filePath || '').replaceAll('\\', '/').split('/').filter(Boolean);
  if (!parts.length) return '(root)';
  if (['packages', 'apps', 'services', 'modules', 'libs'].includes(parts[0]) && parts[1]) return `${parts[0]}/${parts[1]}`;
  if (parts[0] === 'src' && parts[1] === 'repository' && parts[2]) return `src/repository/${parts[2]}`;
  if (parts[0] === 'src' && parts[1] && parts.length > 2) return `src/${parts[1]}`;
  return parts.length === 1 ? '(root)' : parts[0];
}

function basenameWithoutExtension(filePath) {
  const leaf = String(filePath || '').replaceAll('\\', '/').split('/').at(-1) || '';
  return leaf.replace(/\.[^.]+$/, '').toLowerCase();
}

function communityName(paths) {
  const split = paths.map(value => String(value).split('/').filter(Boolean));
  if (!split.length) return '(community)';
  const common = [];
  for (let index = 0; ; index += 1) {
    const value = split[0][index];
    if (!value || split.some(parts => parts[index] !== value)) break;
    common.push(value);
  }
  return common.join('/') || moduleForPath(paths[0]);
}

export { analyzeArchitecture };
