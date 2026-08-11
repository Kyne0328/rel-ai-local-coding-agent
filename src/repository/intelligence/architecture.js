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
  const files = db.prepare(`
    SELECT f.id, f.path, f.language, f.is_test, count(s.id) AS symbol_count
    FROM files f LEFT JOIN symbols s ON s.file_id=f.id
    GROUP BY f.id ORDER BY f.is_test, f.path LIMIT ?
  `).all(maxNodes).map(row => ({
    id: Number(row.id), path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1,
    symbolCount: Number(row.symbol_count || 0), incoming: 0, outgoing: 0, routeCount: 0, testLinks: 0
  }));
  const byId = new Map(files.map(file => [file.id, file]));
  const edges = db.prepare(`
    SELECT source_file_id, target_file_id, type, target_name
    FROM edges
    ORDER BY id LIMIT ?
  `).all(maxEdges).map(row => ({
    source: Number(row.source_file_id), target: row.target_file_id == null ? null : Number(row.target_file_id), type: String(row.type),
    targetName: row.target_name == null ? null : String(row.target_name)
  })).filter(edge => byId.has(edge.source) && (edge.target == null || byId.has(edge.target)));

  const relationshipTypes = {};
  const adjacency = new Map(files.map(file => [file.id, new Map()]));
  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = edge.target == null ? null : byId.get(edge.target);
    relationshipTypes[edge.type] = Number(relationshipTypes[edge.type] || 0) + 1;
    if (edge.type === 'HANDLES') source.routeCount += 1;
    if (!target) continue;
    source.outgoing += 1;
    target.incoming += 1;
    if (edge.type === 'TESTS') {
      source.testLinks += 1;
      target.testLinks += 1;
    }
    const weight = EDGE_WEIGHTS[edge.type] || 1;
    addNeighbor(adjacency, edge.source, edge.target, weight);
    addNeighbor(adjacency, edge.target, edge.source, weight);
  }

  const modules = moduleSummary(files, edges, maxResults);
  const entryPoints = rankEntryPoints(files, maxResults);
  const hotspots = rankHotspots(files, maxResults);
  const layers = dependencyLayers(modules.items, modules.edgeWeights);
  const communities = detectCommunities(files, adjacency, maxResults);

  return {
    architecture: {
      strategy: 'bounded-file-graph',
      totalFileCount,
      analyzedFileCount: files.length,
      analyzedEdgeCount: edges.length,
      maxNodes,
      maxEdges,
      truncated: totalFileCount > files.length || edges.length >= maxEdges
    },
    relationshipTypes,
    modules: modules.items,
    entryPoints,
    hotspots,
    layers,
    communities,
    summary: {
      files: totalFileCount,
      analyzedFiles: files.length,
      edges: edges.length,
      modules: modules.items.length,
      communities: communities.length,
      entryPoints: entryPoints.length,
      hotspots: hotspots.length
    },
    truncated: totalFileCount > files.length || edges.length >= maxEdges,
    next: 'Use entryPoints for repository bootstrap, hotspots for high-impact review, and modules/layers/communities to choose the smallest source boundary before reading code.'
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

  return { items: items.slice(0, maxResults), edgeWeights };
}

function rankEntryPoints(files, maxResults) {
  return files.map(file => {
    const reasons = [];
    let score = 0;
    const basename = basenameWithoutExtension(file.path);
    if (/^(?:main|index|server|app|cli|worker|bootstrap|start)$/.test(basename)) { score += 8; reasons.push(`entry-name:${basename}`); }
    if (!file.path.includes('/')) { score += 4; reasons.push('repository-root'); }
    if (file.routeCount) { score += Math.min(8, file.routeCount * 3); reasons.push(`routes:${file.routeCount}`); }
    if (file.incoming === 0 && file.outgoing > 0) { score += 4; reasons.push('no-incoming-dependencies'); }
    if (/^(?:bin|cmd|scripts?|electron|src)\//.test(file.path)) { score += 1; reasons.push('entry-directory'); }
    if (file.test) score -= 8;
    return { path: file.path, language: file.language, score, incoming: file.incoming, outgoing: file.outgoing, reasons };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.outgoing - a.outgoing || a.path.localeCompare(b.path))
    .slice(0, maxResults);
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
  const depth = new Map([...names].map(name => [name, 0]));
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let changed = false;
    for (const name of [...names].sort()) {
      const deps = [...dependencies.get(name)].filter(dep => dep !== name);
      const next = deps.length ? Math.min(8, Math.max(...deps.map(dep => Number(depth.get(dep) || 0) + 1))) : 0;
      if (next !== depth.get(name)) { depth.set(name, next); changed = true; }
    }
    if (!changed) break;
  }
  const grouped = new Map();
  for (const name of [...names].sort()) {
    const layer = Number(depth.get(name) || 0);
    if (!grouped.has(layer)) grouped.set(layer, []);
    grouped.get(layer).push(name);
  }
  return [...grouped.entries()].sort((a, b) => a[0] - b[0]).map(([depthValue, moduleNames]) => ({
    depth: depthValue,
    role: depthValue === 0 ? 'foundation' : 'consumer',
    modules: moduleNames
  }));
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

function boundedInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export { analyzeArchitecture };
