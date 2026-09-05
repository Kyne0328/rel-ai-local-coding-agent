import { boundedInteger } from './limits.js';

const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MAX_EDGES = 4000;
const DEFAULT_MAX_SEEDS = 20;
const MAX_SECOND_HOP_SEEDS = 40;
const EXPANDED_SCORE_CAP = 0.6;

const EDGE_WEIGHT = Object.freeze({
  HTTP_CALLS: 0.98,
  CALLS: 0.95,
  EMITS: 0.86,
  HANDLES: 0.82,
  LISTENS_ON: 0.8,
  IMPLEMENTS: 0.78,
  INHERITS: 0.78,
  USES_TYPE: 0.72,
  TESTS: 0.65,
  IMPORTS: 0.58
});

const REVERSE_FACTOR = Object.freeze({
  HTTP_CALLS: 0.62,
  CALLS: 0.7,
  EMITS: 0.58,
  HANDLES: 0.55,
  LISTENS_ON: 0.55,
  IMPLEMENTS: 0.65,
  INHERITS: 0.65,
  USES_TYPE: 0.58,
  TESTS: 0.62,
  IMPORTS: 0.48
});

function rankWithGraphDiffusion(db, baselineResults = [], options = {}) {
  const maxResults = boundedInteger(options.maxResults, 1, 100, DEFAULT_MAX_RESULTS);
  const maxEdges = boundedInteger(options.maxEdges, 100, 20000, DEFAULT_MAX_EDGES);
  const maxSeeds = boundedInteger(options.maxSeeds, 1, 100, DEFAULT_MAX_SEEDS);
  const includeExpanded = options.includeExpanded !== false;
  const queryTerms = tokenizeQuery(options.query);
  const baseline = dedupeBaseline(baselineResults).slice(0, maxSeeds);
  const seedPaths = baseline.map(item => normalizePath(item.path)).filter(Boolean);
  if (!seedPaths.length) return emptyResult();

  const placeholders = seedPaths.map(() => '?').join(',');
  const seedRows = db.prepare(`SELECT id, path, language, is_test FROM files WHERE path IN (${placeholders})`).all(...seedPaths).map(fileRow);
  if (!seedRows.length) return emptyResult();

  const fileById = new Map(seedRows.map(item => [item.id, item]));
  const idByPath = new Map(seedRows.map(item => [item.path, item.id]));
  const baselineRankByPath = new Map();
  const baselineScoreById = new Map();
  const propagationSeedById = new Map();
  const reasons = new Map();

  for (let index = 0; index < baseline.length; index += 1) {
    const item = baseline[index];
    const path = normalizePath(item.path);
    const id = idByPath.get(path);
    if (!id) continue;
    const rank = index + 1;
    const baselineScore = 1 / (1 + index * 0.3);
    const coverage = queryCoverage(item, queryTerms);
    baselineRankByPath.set(path, rank);
    baselineScoreById.set(id, baselineScore);
    propagationSeedById.set(id, baselineScore * (0.15 + coverage * 0.85));
    addReason(reasons, id, `baseline:${rank}:coverage:${coverage.toFixed(2)}`);
  }

  const first = loadNeighborhood(db, [...propagationSeedById.keys()], maxEdges);
  mergeFiles(fileById, first.files);
  const expandedRaw = new Map();
  const firstHopStrength = new Map();
  for (const [seedId, seedStrength] of propagationSeedById) {
    for (const edge of first.byNode.get(seedId) || []) {
      const contribution = seedStrength * edge.weight * 0.8;
      addContribution(expandedRaw, reasons, edge.target, contribution, `graph1:${edge.type}:${edge.direction}:${fileById.get(seedId)?.path || seedId}`);
      if (!baselineScoreById.has(edge.target)) firstHopStrength.set(edge.target, Math.max(Number(firstHopStrength.get(edge.target) || 0), contribution));
    }
  }

  const secondSeeds = includeExpanded
    ? [...firstHopStrength.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SECOND_HOP_SEEDS)
    : [];
  let analyzedEdgeCount = first.edgeCount;
  let truncated = first.truncated;
  if (secondSeeds.length && analyzedEdgeCount < maxEdges) {
    const second = loadNeighborhood(db, secondSeeds.map(([id]) => id), maxEdges - analyzedEdgeCount);
    analyzedEdgeCount += second.edgeCount;
    truncated ||= second.truncated;
    mergeFiles(fileById, second.files);
    for (const [seedId, strength] of secondSeeds) {
      for (const edge of second.byNode.get(seedId) || []) {
        if (baselineScoreById.has(edge.target)) continue;
        const contribution = strength * edge.weight * 0.22;
        if (contribution < 0.02) continue;
        addContribution(expandedRaw, reasons, edge.target, contribution, `graph2:${edge.type}:${edge.direction}`);
      }
    }
  }

  const candidateIds = new Set(includeExpanded
    ? [...baselineScoreById.keys(), ...expandedRaw.keys()]
    : [...baselineScoreById.keys()]);
  const results = [];
  for (const id of candidateIds) {
    const file = fileById.get(id);
    if (!file) continue;
    const baselineScore = baselineScoreById.get(id);
    const graphScore = Number(expandedRaw.get(id) || 0);
    const score = baselineScore == null
      ? Math.min(EXPANDED_SCORE_CAP, graphScore)
      : baselineScore + Math.min(0.04, graphScore * 0.08);
    results.push({
      path: file.path,
      language: file.language,
      test: file.test,
      score: Number(score.toFixed(6)),
      graphScore: Number(graphScore.toFixed(6)),
      baselineRank: baselineRankByPath.get(file.path) || null,
      expanded: baselineScore == null,
      reasons: [...(reasons.get(id) || [])].slice(0, 8)
    });
  }
  results.sort((left, right) => right.score - left.score
    || (left.baselineRank || Number.MAX_SAFE_INTEGER) - (right.baselineRank || Number.MAX_SAFE_INTEGER)
    || left.path.localeCompare(right.path));

  return {
    results: results.slice(0, maxResults),
    analyzedEdgeCount,
    seedCandidateCount: baselineScoreById.size,
    expandedCandidateCount: results.filter(item => item.expanded).length,
    totalCandidateCount: results.length,
    truncated: truncated || results.length > maxResults
  };
}

function loadNeighborhood(db, ids, maxEdges) {
  const uniqueIds = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!uniqueIds.length || maxEdges <= 0) return { byNode: new Map(), files: [], edgeCount: 0, truncated: false };
  const placeholders = uniqueIds.map(() => '?').join(',');
  const perSeedLimit = Math.max(1, Math.ceil(maxEdges / uniqueIds.length));
  const rows = db.prepare(`
    WITH relevant AS (
      SELECT e.id, e.source_file_id, e.target_file_id, e.type, e.provider, e.confidence,
             source.path AS source_path, source.language AS source_language, source.is_test AS source_test,
             target.path AS target_path, target.language AS target_language, target.is_test AS target_test,
             CASE WHEN e.source_file_id IN (${placeholders}) THEN e.source_file_id ELSE e.target_file_id END AS seed_id,
             EXISTS(
               SELECT 1 FROM edges support
               WHERE support.source_file_id=e.source_file_id
                 AND support.target_file_id=e.target_file_id
                 AND support.type='IMPORTS'
             ) AS import_supported
      FROM edges e
      JOIN files source ON source.id=e.source_file_id
      JOIN files target ON target.id=e.target_file_id
      WHERE e.target_file_id IS NOT NULL
        AND (e.source_file_id IN (${placeholders}) OR e.target_file_id IN (${placeholders}))
        AND e.type IN ('HTTP_CALLS','CALLS','EMITS','HANDLES','LISTENS_ON','IMPLEMENTS','INHERITS','USES_TYPE','TESTS','IMPORTS')
    ), ranked AS (
      SELECT *,
             row_number() OVER (
               PARTITION BY seed_id
               ORDER BY CASE type
                 WHEN 'HTTP_CALLS' THEN 10 WHEN 'CALLS' THEN 9 WHEN 'EMITS' THEN 8 WHEN 'HANDLES' THEN 8
                 WHEN 'LISTENS_ON' THEN 8 WHEN 'IMPLEMENTS' THEN 7 WHEN 'INHERITS' THEN 7 WHEN 'USES_TYPE' THEN 6
                 WHEN 'TESTS' THEN 5 WHEN 'IMPORTS' THEN 4 ELSE 1 END DESC,
                 confidence DESC, id
             ) AS seed_rank,
             count(*) OVER (PARTITION BY seed_id) AS seed_edge_count
      FROM relevant
    )
    SELECT * FROM ranked
    WHERE seed_rank <= ?
    ORDER BY seed_rank, seed_id, id
    LIMIT ?
  `).all(...uniqueIds, ...uniqueIds, ...uniqueIds, perSeedLimit, maxEdges);

  const files = new Map();
  const byNode = new Map();
  const seen = new Set();
  for (const row of rows) {
    const type = String(row.type);
    const provider = String(row.provider || '');
    const confidence = Number(row.confidence || 0);
    if (!isReliableDiffusionEdge(type, provider, confidence, Number(row.import_supported) === 1)) continue;
    const source = Number(row.source_file_id);
    const target = Number(row.target_file_id);
    files.set(source, { id: source, path: String(row.source_path), language: String(row.source_language), test: Number(row.source_test) === 1 });
    files.set(target, { id: target, path: String(row.target_path), language: String(row.target_language), test: Number(row.target_test) === 1 });
    const baseWeight = (EDGE_WEIGHT[type] || 0) * Math.min(1, Math.max(0.5, confidence));
    addNeighbor(byNode, seen, source, target, baseWeight, type, 'forward');
    addNeighbor(byNode, seen, target, source, baseWeight * (REVERSE_FACTOR[type] || 0.5), type, 'reverse');
  }
  return {
    byNode,
    files: [...files.values()],
    edgeCount: rows.length,
    truncated: rows.length >= maxEdges || rows.some(row => Number(row.seed_edge_count || 0) > perSeedLimit)
  };
}

function isReliableDiffusionEdge(type, provider, confidence, importSupported) {
  if (confidence < 0.7) return false;
  if (type === 'CALLS') return provider.startsWith('resolver-') || importSupported;
  if (type === 'HTTP_CALLS' || type === 'EMITS' || type === 'HANDLES' || type === 'LISTENS_ON') return confidence >= 0.85;
  if (type === 'IMPLEMENTS' || type === 'INHERITS' || type === 'USES_TYPE') return confidence >= 0.85;
  if (type === 'TESTS') return confidence >= 0.9;
  return type === 'IMPORTS' && confidence >= 0.8;
}

function addNeighbor(byNode, seen, source, target, weight, type, direction) {
  const key = `${source}:${target}:${type}:${direction}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (!byNode.has(source)) byNode.set(source, []);
  byNode.get(source).push({ target, weight, type, direction });
}

function addContribution(scores, reasons, id, score, reason) {
  scores.set(id, Number(scores.get(id) || 0) + score);
  addReason(reasons, id, reason);
}

function addReason(reasons, id, reason) {
  if (!reasons.has(id)) reasons.set(id, new Set());
  reasons.get(id).add(reason);
}

function mergeFiles(target, files) {
  for (const file of files) target.set(file.id, file);
}

function queryCoverage(result, queryTerms) {
  if (!queryTerms.length) return 1;
  const text = [result?.path || '', ...(result?.snippets || []).map(item => item?.text || ''), ...(result?.reasons || [])].join(' ').toLowerCase();
  const matched = queryTerms.filter(term => text.includes(term)).length;
  return Math.max(0.05, matched / queryTerms.length);
}

function tokenizeQuery(value) {
  return [...new Set(String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(term => term.length >= 2))];
}

function dedupeBaseline(results) {
  const seen = new Set();
  return (results || []).filter(item => {
    const path = normalizePath(item?.path);
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

function fileRow(row) {
  return { id: Number(row.id), path: String(row.path), language: String(row.language), test: Number(row.is_test) === 1 };
}
function normalizePath(value) { return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, ''); }
function emptyResult() { return { results: [], analyzedEdgeCount: 0, seedCandidateCount: 0, expandedCandidateCount: 0, totalCandidateCount: 0, truncated: false }; }
export { rankWithGraphDiffusion };
