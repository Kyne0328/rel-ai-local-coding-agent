import fs from 'node:fs';

import { analyzeArchitecture } from './architecture.js';
import { analyzeCrossWorkspace } from './crossWorkspace.js';
import { currentGeneration, indexStats, openIndexDatabase, repositoryIndexPath } from './database.js';
import { repositoryIndexStatus } from './indexer.js';
import { rankWithGraphDiffusion } from './graphDiffusion.js';
import { boundedInteger } from './limits.js';
import { recentIntelligenceDiagnostics, recordIntelligenceDiagnostic, repositoryFreshness } from './state.js';

const BOOTSTRAP_MAX_MODULES = 6;
const BOOTSTRAP_MAX_ENTRY_POINTS = 8;
const BOOTSTRAP_MAX_HOTSPOTS = 8;
const BOOTSTRAP_MAX_READ_ORDER = 12;
const SEARCH_MAX_SEEDS = 100;
const SEARCH_MAX_EDGES = 4000;

function cachedRepositorySummary(workspace, config = {}, options = {}) {
  const opened = openCachedIndex(workspace, config, options.repositoryStatuses?.[workspace.alias]);
  if (!opened) return null;
  const { db, generation, status } = opened;
  try {
    const stats = indexStats(db);
    return {
      available: true,
      source: 'persistent-code-graph',
      generation: Number(generation.id || 0),
      fingerprint: `generation:${Number(generation.id || 0)}`,
      freshness: repositoryFreshness(status, generation),
      builtAt: generation.completed_at || generation.started_at || null,
      sourceFileCount: stats.fileCount,
      structuralFileCount: stats.structuralFileCount,
      symbolCount: stats.symbolCount,
      occurrenceCount: stats.occurrenceCount,
      diagnostics: recentIntelligenceDiagnostics(workspace),
      summaryOnly: true,
      policy: 'Compact cached metadata avoids architecture traversal during task bootstrap; source remains authoritative and background reconciliation verifies freshness.'
    };
  } catch (error) {
    recordIntelligenceDiagnostic(workspace, 'cached_summary_failed', error);
    return null;
  } finally {
    db.close();
  }
}

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
      freshness: repositoryFreshness(status, generation),
      modules,
      entryPoints,
      hotspots,
      communities: architecture.communities.slice(0, 6),
      crossWorkspace,
      recommendedReadOrder,
      truncated: architecture.truncated,
      diagnostics: recentIntelligenceDiagnostics(workspace),
      policy: 'Cached graph guidance narrows exploration; source files remain authoritative.'
    };
  } catch (error) {
    recordIntelligenceDiagnostic(workspace, 'cached_context_failed', error);
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
    const ranked = rankWithGraphDiffusion(
      db,
      seedPaths.map(path => ({ path, reasons: [], snippets: [] })),
      { maxResults: seedPaths.length, maxSeeds: SEARCH_MAX_SEEDS, maxEdges: SEARCH_MAX_EDGES, includeExpanded: false }
    );
    const seedSet = new Set(seedPaths);
    const rankedPaths = ranked.results
      .filter(item => seedSet.has(item.path) && Number(item.graphScore || 0) > 0)
      .map(item => ({
        path: item.path,
        score: Math.min(500, Math.round(Number(item.graphScore || 0) * 1000) / 10),
        reasons: (item.reasons || []).filter(reason => reason.startsWith('graph')).sort()
      }))
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    if (!rankedPaths.length) return null;
    return {
      available: true,
      generation: Number(generation.id || 0),
      freshness: repositoryFreshness(status, generation),
      pathScores: Object.fromEntries(rankedPaths.map(item => [item.path, item.score])),
      rankedPaths: rankedPaths.slice(0, 20),
      analyzedEdgeCount: ranked.analyzedEdgeCount,
      truncated: ranked.truncated
    };
  } catch (error) {
    recordIntelligenceDiagnostic(workspace, 'cached_search_context_failed', error);
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
  } catch (error) {
    try { db?.close(); } catch {}
    recordIntelligenceDiagnostic(workspace, 'cached_index_open_failed', error);
    return null;
  }
}

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export { cachedRepositoryContext, cachedRepositorySummary, cachedSearchGraphContext };
