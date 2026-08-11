import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { openIndexDatabase, repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { isReliableDiffusionEdge, rankWithGraphDiffusion } from '../src/repository/intelligence/graphDiffusion.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = path.resolve(stringArg('--root', process.cwd()));
const sampleLimit = integerArg('--samples', 20, 5, 50);
const json = process.argv.includes('--json');
const assertGate = process.argv.includes('--assert');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-semantic-real-repo-'));
const stateDir = path.join(tempRoot, 'state');
const workspace = { alias: 'real-repo-experiment', path: root, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

const STOP_WORDS = new Set([
  'const','let','var','function','return','export','import','from','async','await','true','false','null','undefined','this','new','class','default',
  'string','number','boolean','object','array','value','values','result','results','error','errors','data','item','items','options','config','context',
  'source','target','path','file','files','test','tests','with','without','into','when','where','which','that','then','else','for','while','case','break',
  'node','src','rel','mcp','workspace','workspaces','repository','intelligence'
]);
const EDGE_PRIORITY = Object.freeze({ HTTP_CALLS: 9, CALLS: 8, EMITS: 7, USES_TYPE: 6, IMPLEMENTS: 5, INHERITS: 5, IMPORTS: 4, TESTS: 2 });

try {
  const rssBefore = process.memoryUsage().rss;
  const indexStarted = performance.now();
  const index = await repositoryIntelligence.ensure(workspace, config, { force: true, maxFiles: 20000 });
  const indexMs = performance.now() - indexStarted;
  const dbFile = repositoryIndexPath(config, workspace);
  const graphBytesBefore = fs.statSync(dbFile).size;
  const rssAfterIndex = process.memoryUsage().rss;
  const db = openIndexDatabase(dbFile, { readonly: true });
  const productionEdgeIndexes = new Set(db.prepare("PRAGMA index_list('edges')").all().map(row => String(row.name)));
  const cases = [];
  let minedCandidates = 0;
  try {
    const corpus = loadCorpusTerms(db);
    const edges = candidateEdges(db);
    for (const edge of edges) {
      if (cases.length >= sampleLimit) break;
      const queryTerms = sourceOnlyQueryTerms(edge.sourceId, edge.targetId, corpus);
      if (queryTerms.length < 3) continue;
      minedCandidates += 1;
      const query = queryTerms.slice(0, 4).join(' ');
      const baselineStarted = performance.now();
      const baseline = await repositoryIntelligence.semanticSearch(workspace, config, { query, maxResults: 8 }, { graphDiffusion: false });
      const baselineMs = performance.now() - baselineStarted;
      const baselinePaths = baseline.results.map(item => item.path);
      const sourceRank = rankOf(baselinePaths, edge.sourcePath);
      const targetRank = rankOf(baselinePaths, edge.targetPath);
      if (sourceRank == null || sourceRank > 3) continue;
      if (targetRank != null && targetRank <= 5) continue;

      const prototypeStarted = performance.now();
      const prototype = rankWithGraphDiffusion(db, baseline.results, { query, maxResults: 8, maxSeeds: 8, maxEdges: 20000 });
      const prototypeMs = performance.now() - prototypeStarted;
      const prototypePaths = prototype.results.map(item => item.path);
      cases.push({
        type: edge.type,
        query,
        source: edge.sourcePath,
        target: edge.targetPath,
        sourceBaselineRank: sourceRank,
        baselineTargetRank: targetRank,
        prototypeTargetRank: rankOf(prototypePaths, edge.targetPath),
        baselineTop3: baselinePaths.slice(0, 3),
        prototypeTop5: prototypePaths.slice(0, 5),
        baselineMs: rounded(baselineMs),
        prototypeMs: rounded(prototypeMs),
        expandedCandidates: prototype.expandedCandidateCount
      });
    }
  } finally {
    db.close();
  }

  const graphBytesAfter = fs.statSync(dbFile).size;
  const rssAfterQueries = process.memoryUsage().rss;
  const report = {
    repository: path.basename(root),
    indexedFiles: index.sourceFileCount,
    indexMs: rounded(indexMs),
    minedCandidates,
    evaluatedCases: cases.length,
    prototypeTargetRecallAt5: recallAt(cases, 'prototypeTargetRank', 5),
    prototypeTargetMrr: mrr(cases, 'prototypeTargetRank'),
    baselineTop3RetentionAt5: retention(cases),
    prototypeMedianMs: rounded(median(cases.map(item => item.prototypeMs))),
    prototypeP95Ms: rounded(percentile(cases.map(item => item.prototypeMs), 0.95)),
    baselineMedianMs: rounded(median(cases.map(item => item.baselineMs))),
    addedPersistentBytes: graphBytesAfter - graphBytesBefore,
    productionEdgeIndexes: [...productionEdgeIndexes].filter(name => name.startsWith('edges_')).sort(),
    graphDbBytes: graphBytesAfter,
    rssBeforeBytes: rssBefore,
    rssAfterIndexBytes: rssAfterIndex,
    rssAfterQueriesBytes: rssAfterQueries,
    edgeTypes: countBy(cases, item => item.type),
    cases
  };
  report.recommendation = realRepoRecommendation(report, sampleLimit);
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else printReport(report);

  if (assertGate) {
    const minimumCases = Math.min(10, sampleLimit);
    if (report.evaluatedCases < minimumCases) throw new Error(`Only ${report.evaluatedCases} real-repo hidden-target cases were eligible; need ${minimumCases}.`);
    if (report.prototypeTargetRecallAt5 < 0.6) throw new Error(`Real-repo target recall@5 ${report.prototypeTargetRecallAt5} is below 0.60.`);
    if (report.baselineTop3RetentionAt5 < 0.9) throw new Error(`Baseline top-3 retention@5 ${report.baselineTop3RetentionAt5} is below 0.90.`);
    if (report.prototypeP95Ms > 25) throw new Error(`Prototype p95 ${report.prototypeP95Ms} ms exceeds 25 ms.`);
    if (!productionEdgeIndexes.has('edges_source_file_type_target_idx') || !productionEdgeIndexes.has('edges_target_file_type_source_idx')) {
      throw new Error('Production file-level edge indexes are missing.');
    }
    if (report.addedPersistentBytes !== 0) throw new Error(`Benchmark queries changed the persistent graph by ${report.addedPersistentBytes} bytes.`);
  }
} finally {
  repositoryIntelligence.shutdown();
  if (process.env.REL_AI_MCP_BENCHMARK_KEEP !== '1') fs.rmSync(tempRoot, { recursive: true, force: true });
  else console.error(`Real-repo semantic experiment state kept at ${tempRoot}`);
}

function loadCorpusTerms(db) {
  const rows = db.prepare(`
    SELECT f.id, f.path, search_fts.terms
    FROM search_fts JOIN files f ON f.id=search_fts.rowid
    WHERE f.is_test=0 ORDER BY f.id
  `).all();
  const termsById = new Map();
  const documentFrequency = new Map();
  for (const row of rows) {
    const terms = new Set(String(row.terms || '').split(/\s+/).map(cleanTerm).filter(Boolean));
    termsById.set(Number(row.id), terms);
    for (const term of terms) documentFrequency.set(term, Number(documentFrequency.get(term) || 0) + 1);
  }
  return { termsById, documentFrequency, documentCount: rows.length };
}

function candidateEdges(db) {
  const rows = db.prepare(`
    SELECT e.source_file_id, e.target_file_id, e.type, e.provider, e.confidence, source.path AS source_path, target.path AS target_path,
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
      AND e.source_file_id<>e.target_file_id
      AND source.is_test=0 AND target.is_test=0
      AND e.type IN ('HTTP_CALLS','CALLS','EMITS','USES_TYPE','IMPLEMENTS','INHERITS','IMPORTS')
    ORDER BY e.id
  `).all();
  const byPair = new Map();
  for (const row of rows) {
    const item = {
      sourceId: Number(row.source_file_id), targetId: Number(row.target_file_id), type: String(row.type),
      sourcePath: String(row.source_path), targetPath: String(row.target_path),
      provider: String(row.provider || ''), confidence: Number(row.confidence || 0), importSupported: Number(row.import_supported) === 1
    };
    if (!isReliableDiffusionEdge(item.type, item.provider, item.confidence, item.importSupported)) continue;
    const key = `${item.sourceId}:${item.targetId}`;
    const previous = byPair.get(key);
    if (!previous || (EDGE_PRIORITY[item.type] || 0) > (EDGE_PRIORITY[previous.type] || 0)) byPair.set(key, item);
  }
  return [...byPair.values()].sort((a, b) => (EDGE_PRIORITY[b.type] || 0) - (EDGE_PRIORITY[a.type] || 0)
    || a.sourcePath.localeCompare(b.sourcePath) || a.targetPath.localeCompare(b.targetPath));
}

function sourceOnlyQueryTerms(sourceId, targetId, corpus) {
  const source = corpus.termsById.get(sourceId) || new Set();
  const target = corpus.termsById.get(targetId) || new Set();
  const maxFrequency = Math.max(3, Math.ceil(corpus.documentCount * 0.08));
  return [...source].filter(term => !target.has(term)
    && !STOP_WORDS.has(term)
    && /^[a-z][a-z0-9]{2,}$/.test(term)
    && Number(corpus.documentFrequency.get(term) || 0) <= maxFrequency)
    .sort((a, b) => Number(corpus.documentFrequency.get(a) || 0) - Number(corpus.documentFrequency.get(b) || 0)
      || b.length - a.length || a.localeCompare(b));
}

function cleanTerm(value) {
  const term = String(value || '').trim().toLowerCase();
  return term.length >= 3 ? term : '';
}

function rankOf(paths, target) {
  const index = paths.indexOf(target);
  return index === -1 ? null : index + 1;
}

function recallAt(rows, key, k) {
  if (!rows.length) return 0;
  return rounded(rows.filter(row => row[key] != null && row[key] <= k).length / rows.length);
}

function mrr(rows, key) {
  if (!rows.length) return 0;
  return rounded(rows.reduce((sum, row) => sum + (row[key] ? 1 / row[key] : 0), 0) / rows.length);
}

function retention(rows) {
  if (!rows.length) return 0;
  let retained = 0;
  let total = 0;
  for (const row of rows) {
    const allowed = new Set(row.prototypeTop5);
    for (const pathValue of row.baselineTop3) {
      total += 1;
      if (allowed.has(pathValue)) retained += 1;
    }
  }
  return total ? rounded(retained / total) : 0;
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = String(keyFn(value));
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function realRepoRecommendation(report, requestedSamples) {
  const minimumCases = Math.min(10, requestedSamples);
  if (report.evaluatedCases >= minimumCases && report.prototypeTargetRecallAt5 >= 0.6
    && report.baselineTop3RetentionAt5 >= 0.9 && report.prototypeP95Ms <= 25 && report.addedPersistentBytes === 0) {
    return 'promising on real repository: graph diffusion is a candidate for production integration behind bounded ranking rules';
  }
  return 'do-not-integrate yet: real-repository evidence did not clear the quality/cost gate';
}

function printReport(report) {
  console.log(`Real-repository semantic experiment: ${report.repository}`);
  console.log(`  Indexed files:              ${report.indexedFiles}`);
  console.log(`  Evaluated hidden targets:   ${report.evaluatedCases}`);
  console.log(`  Target recall@5:            ${report.prototypeTargetRecallAt5}`);
  console.log(`  Target MRR:                 ${report.prototypeTargetMrr}`);
  console.log(`  Baseline top3 retention@5:  ${report.baselineTop3RetentionAt5}`);
  console.log(`  Prototype median / p95:     ${report.prototypeMedianMs} ms / ${report.prototypeP95Ms} ms`);
  console.log(`  Production edge indexes:   ${report.productionEdgeIndexes.join(', ')}`);
  console.log(`  Added query-time bytes:     ${report.addedPersistentBytes}`);
  console.log(`  Edge types:                 ${JSON.stringify(report.edgeTypes)}`);
  console.log(`  Recommendation:             ${report.recommendation}`);
}

function median(values) { return percentile(values, 0.5); }
function percentile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
}
function integerArg(name, fallback, min, max) {
  const index = process.argv.indexOf(name);
  const parsed = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return parsed;
}
function stringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}
function rounded(value) { return Number(Number(value).toFixed(4)); }
