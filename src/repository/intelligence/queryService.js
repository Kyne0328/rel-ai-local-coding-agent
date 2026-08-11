import fs from 'node:fs';

import { discoverCommands } from '../../commandDiscovery.js';
import { resolveSafePath } from '../../safety.js';
import { detectVerifyChecks } from '../../bridge/checkDetection.js';
import { clampNumber } from '../../bridge/limits.js';
import { analyzeArchitecture } from './architecture.js';
import { analyzeCrossWorkspace } from './crossWorkspace.js';
import { openIndexDatabase, repositoryIndexPath } from './database.js';
import { reciprocalRankFusion } from './fusion.js';
import { ensureRepositoryIndex } from './indexer.js';
import { queryTerms, simpleSymbol } from './languages.js';
import { searchZoekt } from './zoekt.js';
import { searchGitCandidates } from './lexicalFallback.js';

const DEFAULT_MAX_RESULTS = 200;
const MAX_LINE_CHARS = 400;
const MAX_QUERY_CANDIDATES = 1000;

async function queryCodeInspect(workspace, config, args = {}, options = {}) {
  const action = String(args.action || '').trim().toLowerCase();
  if (!['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics', 'architecture'].includes(action)) {
    throw new Error('relai_code_inspect action must be one of: symbol, references, related, impact, trace, diagnostics, architecture.');
  }
  const index = await ensureRepositoryIndex(workspace, config, { maxFiles: args.maxFiles, signal: options.signal });
  const maxResults = Math.floor(clampNumber(args.maxResults, 1, 1000, DEFAULT_MAX_RESULTS));
  const db = openIndexDatabase(repositoryIndexPath(config, workspace), { readonly: true });
  try {
    const base = { ok: true, workspace: workspace.alias, action, index };
    if (action === 'architecture') {
      const architecture = analyzeArchitecture(db, { maxResults });
      const crossWorkspace = analyzeCrossWorkspace(workspace, config, db, { maxRelationships: Math.min(100, maxResults) });
      return {
        ...base,
        ...architecture,
        architecture: { ...architecture.architecture, crossWorkspace }
      };
    }
    if (action === 'diagnostics') return { ...base, ...diagnosticReadiness(workspace, db) };
    if (action === 'related') {
      const query = String(args.query || args.symbol || '').trim();
      if (!query) throw new Error('relai_code_inspect related requires query or symbol.');
      const candidateLimit = Math.min(MAX_QUERY_CANDIDATES, maxResults * 10);
      const zoekt = searchZoekt(workspace, config, index, query, candidateLimit);
      const fallback = zoekt.available && zoekt.current ? [] : searchGitCandidates(workspace, queryTerms(query, 20), candidateLimit);
      return { ...base, query, ...relatedFiles(workspace, db, query, maxResults, args._workflowContext, {}, [...zoekt.results, ...fallback]) };
    }

    const symbol = String(args.symbol || '').trim();
    const requestedPaths = Array.isArray(args.paths) ? args.paths.filter(Boolean) : [];
    const pathOnlyImpact = action === 'impact' && !symbol && requestedPaths.length > 0;
    if (!symbol && !pathOnlyImpact) throw new Error(`relai_code_inspect ${action} requires symbol${action === 'impact' ? ' or paths' : ''}.`);
    if (symbol && !/^[A-Za-z_$][A-Za-z0-9_$.:#-]{0,255}$/.test(symbol)) throw new Error('symbol must be a simple code identifier or qualified identifier.');

    const definitions = symbol ? findDefinitions(workspace, db, symbol, maxResults) : [];
    const references = symbol ? findReferences(workspace, db, symbol, maxResults) : emptyReferences();
    if (action === 'symbol') {
      return {
        ...base,
        symbol,
        definitions,
        definitionCount: countDefinitions(db, symbol),
        references: references.items.slice(0, Math.min(50, maxResults)),
        referenceCount: references.referenceCount,
        callCount: references.callCount,
        truncated: definitions.length >= maxResults || references.truncated,
        next: definitions.length ? 'Use action references or impact to trace structural callers, importers, and affected tests.' : 'No structural definition was recognized. Use related or relai_search for lexical evidence.'
      };
    }
    if (action === 'references') return { ...base, symbol, definitions, ...references };

    const impact = impactAnalysis(workspace, db, symbol, definitions, references, args, maxResults);
    if (action === 'trace') return { ...base, symbol, ...traceAnalysis(db, symbol, definitions, references, impact, maxResults) };
    return { ...base, ...(symbol ? { symbol } : {}), ...impact };
  } finally {
    db.close();
  }
}

async function querySemanticSearch(workspace, config, args = {}, options = {}) {
  const query = String(args.query || '').trim();
  if (!query) throw new Error('relai_semantic_search requires query.');
  const maxResults = Math.floor(clampNumber(args.maxResults, 1, 100, 20));
  const index = await ensureRepositoryIndex(workspace, config, { maxFiles: args.maxFiles, signal: options.signal });
  const db = openIndexDatabase(repositoryIndexPath(config, workspace), { readonly: true });
  try {
    const candidateLimit = Math.min(MAX_QUERY_CANDIDATES, maxResults * 20);
    const zoekt = searchZoekt(workspace, config, index, query, candidateLimit);
    const fallback = zoekt.available && zoekt.current ? [] : searchGitCandidates(workspace, queryTerms(query, 20), candidateLimit);
    const related = relatedFiles(workspace, db, query, maxResults, args._workflowContext, {
      pathPrefix: String(args.pathPrefix || '').replaceAll('\\', '/').replace(/^\.\//, ''),
      language: String(args.language || '').toLowerCase()
    }, [...zoekt.results, ...fallback]);
    return {
      ok: true,
      workspace: workspace.alias,
      query,
      strategy: 'local-hybrid-' + related.strategy,
      neuralEmbeddings: false,
      privacy: 'All parsing, graph indexing, and ranking run locally. No source text is sent to an external service.',
      fingerprint: index.fingerprint,
      cacheHit: index.cacheHit,
      results: related.files,
      resultCount: related.matchCount,
      truncated: related.truncated
    };
  } finally {
    db.close();
  }
}

function findDefinitions(workspace, db, symbol, maxResults) {
  const simple = simpleSymbol(symbol);
  const qualified = String(symbol);
  const rows = db.prepare(`
    SELECT s.id, s.name, s.qualified_name, s.kind, s.start_line, s.start_column, s.end_line, s.end_column,
           s.provider, s.confidence, f.path, f.language, f.is_test
    FROM symbols s JOIN files f ON f.id=s.file_id
    WHERE s.name=? OR s.qualified_name=?
    ORDER BY CASE WHEN s.qualified_name=? THEN 0 ELSE 1 END, f.path, s.start_line
    LIMIT ?
  `).all(simple, qualified, qualified, maxResults);
  return rows.map(row => {
    const lines = readSourceLines(workspace, String(row.path));
    return {
      name: String(row.name), qualifiedName: String(row.qualified_name), kind: String(row.kind),
      line: Number(row.start_line), column: Number(row.start_column), endLine: Number(row.end_line), endColumn: Number(row.end_column),
      path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1,
      provider: String(row.provider), confidence: Number(row.confidence),
      text: String(lines?.[Number(row.start_line) - 1] || '').trim().slice(0, MAX_LINE_CHARS)
    };
  });
}

function countDefinitions(db, symbol) {
  const simple = simpleSymbol(symbol);
  const qualified = String(symbol);
  return Number(db.prepare('SELECT count(*) AS count FROM symbols WHERE name=? OR qualified_name=?').get(simple, qualified)?.count || 0);
}

function emptyReferences() {
  return { items: [], matchCount: 0, referenceCount: 0, callCount: 0, truncated: false };
}

function findReferences(workspace, db, symbol, maxResults) {
  const simple = simpleSymbol(symbol);
  const total = Number(db.prepare('SELECT count(*) AS count FROM occurrences WHERE name=?').get(simple)?.count || 0);
  const rows = db.prepare(`
    SELECT o.name, o.role, o.line, o.column_no, o.end_line, o.end_column, o.provider, o.confidence,
           f.path, f.language, f.is_test
    FROM occurrences o JOIN files f ON f.id=o.file_id
    WHERE o.name=?
    ORDER BY CASE o.role WHEN 'call' THEN 0 ELSE 1 END, f.path, o.line
    LIMIT ?
  `).all(simple, maxResults);
  const items = rows.map(row => {
    const lines = readSourceLines(workspace, String(row.path));
    return {
      path: String(row.path), line: Number(row.line), column: Number(row.column_no), language: String(row.language), test: Number(row.is_test) === 1,
      classification: row.role === 'reference' ? 'usage' : String(row.role), provider: String(row.provider), confidence: Number(row.confidence),
      text: String(lines?.[Number(row.line) - 1] || '').trim().slice(0, MAX_LINE_CHARS)
    };
  });
  const callCount = Number(db.prepare("SELECT count(*) AS count FROM occurrences WHERE name=? AND role='call'").get(simple)?.count || 0);
  return { items, matchCount: total, referenceCount: total, callCount, truncated: total > items.length };
}

function relatedFiles(workspace, db, query, maxResults, workflowContext = {}, filters = {}, externalCandidates = []) {
  const terms = queryTerms(query, 20);
  if (!terms.length) return { strategy: 'fts5-tree-sitter-graph', semanticEmbeddings: false, files: [], matchCount: 0, truncated: false, next: 'Use a more specific query.' };
  const candidateLimit = Math.min(MAX_QUERY_CANDIDATES, Math.max(100, maxResults * 20));
  const fts = ftsCandidates(db, terms, candidateLimit, filters);
  const symbols = symbolCandidates(db, terms, candidateLimit, filters);
  const paths = pathCandidates(db, terms, candidateLimit, filters);
  const filteredExternal = externalCandidates.filter(item => filterRow(item, filters));
  const fused = reciprocalRankFusion([filteredExternal, fts, symbols, paths], { limit: candidateLimit });
  const ranked = fused.map(item => {
    const structuralScore = workflowContextBoost(item.path, workflowContext)
      + (item.reasons?.some(reason => reason.startsWith('exact-symbol:')) ? 0.08 : 0)
      + (item.reasons?.some(reason => reason.startsWith('path:')) ? 0.04 : 0);
    return { ...item, score: item.score + structuralScore };
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const results = [];
  for (const candidate of ranked.slice(0, maxResults)) {
    const lines = readSourceLines(workspace, candidate.path);
    if (!lines) continue;
    results.push({
      path: candidate.path,
      language: candidate.language,
      test: candidate.test,
      score: Number(candidate.score.toFixed(6)),
      providers: candidate.providers,
      reasons: candidate.reasons,
      snippets: bestSnippets(lines, terms, 3, 500)
    });
  }
  return {
    strategy: externalStrategy(filteredExternal),
    semanticEmbeddings: false,
    files: results,
    matchCount: ranked.length,
    truncated: ranked.length > maxResults,
    next: 'Results combine persistent lexical retrieval, symbol structure, and workflow context. Use symbol, references, trace, or impact for graph-native questions.'
  };
}


function externalStrategy(candidates) {
  if (candidates.some(item => item.provider === 'zoekt')) return 'zoekt-fts5-tree-sitter-graph';
  if (candidates.some(item => item.provider === 'git-grep')) return 'git-grep-fts5-tree-sitter-graph';
  return 'fts5-tree-sitter-graph';
}

function ftsCandidates(db, terms, limit, filters) {
  const match = terms.map(quoteFtsTerm).filter(Boolean).join(' OR ');
  if (!match) return [];
  const clauses = [];
  const values = [match];
  if (filters.pathPrefix) { clauses.push('f.path LIKE ?'); values.push(`${filters.pathPrefix}%`); }
  if (filters.language) { clauses.push('f.language=?'); values.push(filters.language); }
  const suffix = clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
  values.push(limit);
  return db.prepare(`
    SELECT f.path, f.language, f.is_test, bm25(search_fts) AS rank
    FROM search_fts JOIN files f ON f.id=search_fts.rowid
    WHERE search_fts MATCH ?${suffix}
    ORDER BY rank, f.path LIMIT ?
  `).all(...values).map(row => ({
    path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1,
    provider: 'sqlite-fts5', reasons: ['lexical-fts5'], structuralScore: bm25Boost(row.rank)
  }));
}

function symbolCandidates(db, terms, limit, filters) {
  const byPath = new Map();
  const statement = db.prepare(`
    SELECT f.path, f.language, f.is_test, s.name, s.qualified_name
    FROM symbols s JOIN files f ON f.id=s.file_id
    WHERE lower(s.name) LIKE ? OR lower(s.qualified_name) LIKE ?
    ORDER BY f.path LIMIT ?
  `);
  for (const term of terms) {
    for (const row of statement.all(`%${term}%`, `%${term}%`, limit)) {
      if (!filterRow(row, filters)) continue;
      const path = String(row.path);
      const item = byPath.get(path) || { path, language: String(row.language), test: Number(row.is_test) === 1, provider: 'tree-sitter', reasons: [] };
      item.reasons.push(String(row.name).toLowerCase() === term ? `exact-symbol:${term}` : `symbol:${term}`);
      byPath.set(path, item);
    }
  }
  return [...byPath.values()].slice(0, limit);
}

function pathCandidates(db, terms, limit, filters) {
  const byPath = new Map();
  const statement = db.prepare('SELECT path, language, is_test FROM files WHERE lower(path) LIKE ? ORDER BY path LIMIT ?');
  for (const term of terms) {
    for (const row of statement.all(`%${term}%`, limit)) {
      if (!filterRow(row, filters)) continue;
      const path = String(row.path);
      const item = byPath.get(path) || { path, language: String(row.language), test: Number(row.is_test) === 1, provider: 'graph-path', reasons: [] };
      item.reasons.push(`path:${term}`);
      byPath.set(path, item);
    }
  }
  return [...byPath.values()].slice(0, limit);
}

function impactAnalysis(workspace, db, symbol, definitions, references, args, maxResults) {
  const maxDepth = Math.floor(clampNumber(args.maxDepth, 1, 8, 3));
  const seeds = new Set(definitions.map(item => item.path));
  for (const requested of Array.isArray(args.paths) ? args.paths : []) {
    const safe = resolveSafePath(workspace.path, requested, { operation: 'read' });
    if (db.prepare('SELECT 1 AS present FROM files WHERE path=?').get(safe.relativePath)) seeds.add(safe.relativePath);
  }
  if (!seeds.size) for (const reference of references.items) if (!reference.test) seeds.add(reference.path);
  if (!seeds.size) throw new Error('impact requires a recognized structural symbol definition or at least one indexed path.');

  const impacted = new Map([...seeds].map(path => [path, { path, depth: 0, reason: 'seed' }]));
  let frontier = fileRowsByPaths(db, [...seeds]);
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const targetById = new Map(frontier.map(item => [item.id, item.path]));
    const importers = importerRows(db, frontier.map(item => item.id), maxResults * 8);
    const next = [];
    for (const importer of importers) {
      if (impacted.has(importer.path)) continue;
      impacted.set(importer.path, { path: importer.path, depth, reason: `imports:${targetById.get(importer.targetFileId) || importer.targetPath || ''}` });
      next.push(importer);
    }
    frontier = dedupeRows(next);
  }
  for (const reference of references.items) if (!impacted.has(reference.path)) impacted.set(reference.path, { path: reference.path, depth: 1, reason: `references:${simpleSymbol(symbol)}` });

  const impactedPaths = [...impacted.values()].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const metadata = new Map(fileRowsByPaths(db, impactedPaths.map(item => item.path)).map(row => [row.path, row]));
  const affectedTests = impactedPaths.filter(item => metadata.get(item.path)?.test).map(item => item.path);
  const importEdges = importEdgesWithin(db, metadata, impactedPaths.map(item => item.path), maxResults);
  return {
    definitions,
    references: references.items,
    referenceCount: references.referenceCount,
    calls: references.items.filter(item => item.classification === 'call'),
    seeds: [...seeds],
    maxDepth,
    impactedPaths: impactedPaths.slice(0, maxResults),
    impactedPathCount: impactedPaths.length,
    affectedTests: [...new Set(affectedTests)].slice(0, maxResults),
    importEdges,
    truncated: impactedPaths.length > maxResults || references.truncated,
    next: affectedTests.length ? 'Run the listed tests or relai_validate checks after the final mutation.' : 'No directly connected test file was identified; use diagnostics to review available validation commands.'
  };
}

function traceAnalysis(db, symbol, definitions, references, impact, maxResults) {
  const definitionPaths = new Set(definitions.map(item => item.path));
  const directCallers = references.items.filter(item => item.classification === 'call');
  const importers = references.items.filter(item => item.classification === 'import');
  const relatedSymbols = symbolsInPaths(db, [...definitionPaths], simpleSymbol(symbol), maxResults);
  const uiSurfaces = impact.impactedPaths.filter(item => /(?:^|\/)(?:ui|electron|public|renderer|components?|features?)(?:\/|$)/i.test(item.path)).slice(0, maxResults);
  const testSurfaces = impact.affectedTests.slice(0, maxResults);
  const registrationSurfaces = impact.impactedPaths.filter(item => /(?:registry|schema|handlers|tools|routes?|mcpServer|http)/i.test(item.path)).slice(0, maxResults);
  const recommendedReadOrder = [
    ...definitions.map(item => item.path), ...directCallers.map(item => item.path), ...registrationSurfaces.map(item => item.path), ...testSurfaces
  ].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, maxResults);
  return {
    definitions, definitionPaths: [...definitionPaths], directCallers, importers,
    references: references.items.slice(0, maxResults), indirectImpact: impact.impactedPaths.slice(0, maxResults),
    importEdges: impact.importEdges, relatedSymbols, affectedTests: testSurfaces, uiSurfaces, registrationSurfaces, recommendedReadOrder,
    summary: { definitions: definitions.length, directCalls: directCallers.length, imports: importers.length, impactedPaths: impact.impactedPathCount, affectedTests: impact.affectedTests.length },
    truncated: impact.truncated,
    next: 'Read recommendedReadOrder in sequence; validate affectedTests after the final mutation.'
  };
}
function diagnosticReadiness(workspace, db) {
  const discovered = discoverCommands(workspace.path);
  const diagnosticCommands = Object.entries(discovered)
    .filter(([key, command]) => /(?:typecheck|lint|check|analy|vet|clippy|doctor)/i.test(`${key} ${command}`))
    .map(([key, command]) => ({ key, command }));
  const languages = {};
  for (const row of db.prepare('SELECT language, count(*) AS count FROM files GROUP BY language ORDER BY language').all()) {
    languages[String(row.language)] = Number(row.count);
  }
  return {
    languages,
    diagnosticCommands,
    validationCommands: {
      quick: detectVerifyChecks(workspace.path, 'quick'),
      standard: detectVerifyChecks(workspace.path, 'standard'),
      release: detectVerifyChecks(workspace.path, 'release')
    },
    configuredTestCommands: Object.entries(workspace.testCommands || {}).map(([key, command]) => ({ key, command })),
    diagnosticsExecuted: false,
    next: diagnosticCommands.length ? 'Run relai_validate checks at the appropriate level to execute diagnostics.' : 'No dedicated language diagnostic command was detected.'
  };
}

function filterRow(row, filters = {}) {
  const path = String(row.path || '');
  if (filters.pathPrefix && !path.startsWith(filters.pathPrefix)) return false;
  if (filters.language && String(row.language || '').toLowerCase() !== filters.language) return false;
  return true;
}

function workflowContextBoost(filePath, context = {}) {
  const target = String(filePath || '').replaceAll('\\', '/');
  if ((context.taskOwnedPaths || []).includes(target)) return 0.12;
  if ((context.impactedPaths || []).includes(target)) return 0.08;
  if ((context.packagePaths || []).some(value => target === value || target.startsWith(`${value}/`))) return 0.04;
  return 0;
}

function quoteFtsTerm(term) {
  const clean = String(term || '').replace(/"/g, '""').trim();
  return clean ? `"${clean}"` : '';
}

function bm25Boost(rank) {
  const numeric = Number(rank);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(0.08, 0.08 / (1 + Math.abs(numeric)));
}

function bestSnippets(lines, terms, limit, maxChars) {
  const scored = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = String(lines[index] || '');
    const lower = text.toLowerCase();
    const matches = terms.filter(term => lower.includes(term)).length;
    if (!matches) continue;
    scored.push({ line: index + 1, text: text.trim().slice(0, maxChars), matches });
  }
  scored.sort((left, right) => right.matches - left.matches || left.line - right.line);
  return scored.slice(0, limit).map(({ matches: _matches, ...item }) => item);
}

function readSourceLines(workspace, relativePath) {
  try {
    const resolved = resolveSafePath(workspace.path, relativePath, { operation: 'read' });
    return fs.readFileSync(resolved.absolutePath, 'utf8').split(/\r\n|\n|\r/);
  } catch {
    return null;
  }
}

function fileRowsByPaths(db, paths) {
  const unique = [...new Set(paths.map(String).filter(Boolean))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  return db.prepare(`SELECT id, path, language, is_test FROM files WHERE path IN (${placeholders}) ORDER BY path`).all(...unique)
    .map(row => ({ id: Number(row.id), path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1 }));
}

function importerRows(db, targetIds, limit) {
  const ids = [...new Set(targetIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT DISTINCT f.id, f.path, f.language, f.is_test, i.target_file_id, i.target_path
    FROM imports i JOIN files f ON f.id=i.source_file_id
    WHERE i.target_file_id IN (${placeholders})
    ORDER BY f.path, i.target_file_id LIMIT ?
  `).all(...ids, Math.max(1, Math.min(MAX_QUERY_CANDIDATES, limit || MAX_QUERY_CANDIDATES))).map(row => ({
    id: Number(row.id), path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1,
    targetFileId: Number(row.target_file_id), targetPath: row.target_path == null ? null : String(row.target_path)
  }));
}

function importEdgesWithin(db, metadata, paths, maxResults) {
  const rows = [...metadata.values()];
  const ids = rows.map(row => row.id);
  if (!ids.length) return [];
  const pathById = new Map(rows.map(row => [row.id, row.path]));
  const allowed = new Set(paths);
  const placeholders = ids.map(() => '?').join(',');
  const edges = [];
  for (const row of db.prepare(`SELECT source_file_id, target_file_id FROM imports WHERE source_file_id IN (${placeholders}) AND target_file_id IS NOT NULL`).all(...ids)) {
    const from = pathById.get(Number(row.source_file_id));
    const to = pathById.get(Number(row.target_file_id));
    if (from && to && allowed.has(from) && allowed.has(to)) edges.push({ from, to });
    if (edges.length >= maxResults) break;
  }
  return edges;
}

function symbolsInPaths(db, paths, excludeName, maxResults) {
  const rows = fileRowsByPaths(db, paths);
  const ids = rows.map(row => row.id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT s.name, s.qualified_name, s.kind, s.start_line, f.path
    FROM symbols s JOIN files f ON f.id=s.file_id
    WHERE s.file_id IN (${placeholders}) AND s.name<>?
    ORDER BY f.path, s.start_line LIMIT ?
  `).all(...ids, excludeName, maxResults).map(row => ({
    path: String(row.path), line: Number(row.start_line), name: String(row.name), qualifiedName: String(row.qualified_name),
    kind: String(row.kind), reason: 'same-definition-file'
  }));
}

function dedupeRows(rows) {
  const byId = new Map();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()];
}

export { queryCodeInspect, querySemanticSearch };
