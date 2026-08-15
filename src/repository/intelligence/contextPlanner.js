import fs from 'node:fs';

import { analyzeArchitecture } from './architecture.js';
import { analyzeCrossWorkspace } from './crossWorkspace.js';
import { currentGeneration, openIndexDatabase, repositoryIndexPath } from './database.js';
import { repositoryIndexStatus } from './indexer.js';
import { boundedInteger } from './limits.js';

const BOOTSTRAP_MAX_MODULES = 6;
const BOOTSTRAP_MAX_ENTRY_POINTS = 8;
const BOOTSTRAP_MAX_HOTSPOTS = 8;
const BOOTSTRAP_MAX_READ_ORDER = 12;
const SEARCH_MAX_SEEDS = 100;
const SEARCH_MAX_EDGES = 4000;

const SEARCH_EDGE_WEIGHT = Object.freeze({
  HTTP_CALLS: 8,
  CALLS: 7,
  INHERITS: 6,
  IMPLEMENTS: 6,
  IMPORTS: 5,
  TESTS: 4,
  EMITS: 4,
  USES_TYPE: 3,
  HANDLES: 2,
  LISTENS_ON: 2
});

function cachedRepositoryContext(workspace, config = {}, options = {}) {
  const opened = openCachedIndex(workspace, config, options.repositoryStatuses?.[workspace.alias]);
  if (!opened) return null;
  const { db, generation, status } = opened;
  try {
    const architecture = analyzeArchitecture(db, {
      maxResults: boundedInteger(options.maxResults, 1, 20, 10),
      maxNodes: boundedInteger(options.maxNodes, 100, 2500, 1500),
      maxEdges: boundedInteger(options.maxEdges, 100, 10000, 6000)
    });
    const modules = architecture.modules.slice(0, BOOTSTRAP_MAX_MODULES).map(item => ({
      name: item.name,
      fileCount: item.fileCount,
      incoming: item.incoming,
      outgoing: item.outgoing,
      representativeFiles: item.representativeFiles.slice(0, 3)
    }));
    const entryPoints = architecture.entryPoints.slice(0, BOOTSTRAP_MAX_ENTRY_POINTS).map(item => ({
      path: item.path,
      score: item.score,
      reasons: item.reasons
    }));
    const hotspots = architecture.hotspots.slice(0, BOOTSTRAP_MAX_HOTSPOTS).map(item => ({
      path: item.path,
      score: item.score,
      incoming: item.incoming,
      outgoing: item.outgoing
    }));
    const crossWorkspace = analyzeCrossWorkspace(workspace, config, db, {
      maxPeers: 8,
      maxHintsPerWorkspace: 600,
      maxRelationships: 12,
      repositoryStatuses: options.repositoryStatuses
    });
    const recommendedReadOrder = unique([
      ...entryPoints.slice(0, 5).map(item => item.path),
      ...hotspots.slice(0, 7).map(item => item.path)
    ]).slice(0, BOOTSTRAP_MAX_READ_ORDER);
    return {
      available: true,
      source: 'persistent-code-graph',
      generation: Number(generation.id || 0),
      fingerprint: `generation:${Number(generation.id || 0)}`,
      freshness: cachedFreshness(status),
      modules,
      entryPoints,
      hotspots,
      communities: architecture.communities.slice(0, 6),
      crossWorkspace,
      recommendedReadOrder,
      truncated: architecture.truncated,
      policy: 'Cached graph guidance narrows exploration; source files remain authoritative.'
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function cachedSearchGraphContext(workspace, config = {}, matches = [], options = {}) {
  const seedPaths = unique((matches || []).map(item => normalizePath(item?.path)).filter(Boolean)).slice(0, SEARCH_MAX_SEEDS);
  if (!seedPaths.length) return null;
  const opened = openCachedIndex(workspace, config, options.repositoryStatuses?.[workspace.alias]);
  if (!opened) return null;
  const { db, generation, status } = opened;
  try {
    const placeholders = seedPaths.map(() => '?').join(',');
    const fileRows = db.prepare(`SELECT id, path FROM files WHERE path IN (${placeholders})`).all(...seedPaths)
      .map(row => ({ id: Number(row.id), path: String(row.path) }));
    if (!fileRows.length) return null;
    const ids = fileRows.map(item => item.id);
    const idPlaceholders = ids.map(() => '?').join(',');
    const edges = db.prepare(`
      SELECT source_file_id, target_file_id, type
      FROM edges
      WHERE source_file_id IN (${idPlaceholders}) OR target_file_id IN (${idPlaceholders})
      ORDER BY id LIMIT ?
    `).all(...ids, ...ids, SEARCH_MAX_EDGES);
    const seedIds = new Set(ids);
    const pathById = new Map(fileRows.map(item => [item.id, item.path]));
    const scores = new Map(fileRows.map(item => [item.path, 0]));
    const reasons = new Map(fileRows.map(item => [item.path, new Set()]));

    for (const edge of edges) {
      const sourceId = Number(edge.source_file_id);
      const targetId = edge.target_file_id == null ? null : Number(edge.target_file_id);
      const type = String(edge.type || 'RELATED');
      const weight = SEARCH_EDGE_WEIGHT[type] || 1;
      if (seedIds.has(sourceId)) addSearchScore(pathById.get(sourceId), weight + (targetId != null && seedIds.has(targetId) ? weight * 2 : 0), type, scores, reasons);
      if (targetId != null && seedIds.has(targetId)) addSearchScore(pathById.get(targetId), weight * 1.5 + (seedIds.has(sourceId) ? weight * 2 : 0), type, scores, reasons);
    }

    const rankedPaths = [...scores.entries()].map(([path, rawScore]) => ({
      path,
      score: Math.min(500, Math.round(rawScore * 10) / 10),
      reasons: [...reasons.get(path)].sort()
    })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    if (!rankedPaths.length) return null;
    return {
      available: true,
      generation: Number(generation.id || 0),
      freshness: cachedFreshness(status),
      pathScores: Object.fromEntries(rankedPaths.map(item => [item.path, item.score])),
      rankedPaths: rankedPaths.slice(0, 20),
      analyzedEdgeCount: edges.length,
      truncated: edges.length >= SEARCH_MAX_EDGES
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function openCachedIndex(workspace, config, statusOverride = null) {
  let databaseFile;
  try { databaseFile = repositoryIndexPath(config, workspace); } catch { return null; }
  if (!fs.existsSync(databaseFile)) return null;
  let db;
  try {
    db = openIndexDatabase(databaseFile, { readonly: true });
    const generation = currentGeneration(db);
    if (!generation) { db.close(); return null; }
    return { db, generation, status: statusOverride || repositoryIndexStatus(workspace, config) };
  } catch {
    try { db?.close(); } catch {}
    return null;
  }
}

function cachedFreshness(status = {}) {
  if (status.metadata) return status.dirty ? 'stale' : 'current';
  return 'cached-unverified';
}

function addSearchScore(path, score, type, scores, reasons) {
  if (!path || !scores.has(path)) return;
  scores.set(path, Number(scores.get(path) || 0) + Number(score || 0));
  reasons.get(path)?.add(String(type || 'RELATED'));
}

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export { cachedRepositoryContext, cachedSearchGraphContext };
