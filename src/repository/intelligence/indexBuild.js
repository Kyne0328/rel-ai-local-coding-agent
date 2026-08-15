import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { collectOptionsFromWorkspace, collectTextFiles, isPathInside, looksBinary, realRootOf } from '../../safety.js';
import {
  beginGeneration,
  checkIndexIntegrity,
  currentGeneration,
  deleteIndexedPath,
  ensureIndexSchema,
  finishGeneration,
  indexStats,
  listManifest,
  openIndexDatabase,
  replaceFileFacts,
  relationshipImpactForPaths,
  relationshipSourceIdsForNames,
  resolveRelationships
} from './database.js';
import { enhancedResolverLanguages, isTestPath, languageForPath, PARSER_VERSION, structuralLanguages } from './languages.js';
import { parseSourceFile } from './treeSitter.js';
import { rebuildZoektIndex } from './zoekt.js';

const DEFAULT_MAX_INDEX_FILES = 100000;
const MAX_INDEXED_FILE_BYTES = 1024 * 1024;
const WRITE_BATCH_SIZE = 100;

async function executeRepositoryIndexJob(job, signal) {
  const kind = normalizeJobKind(job?.kind);
  const databaseFile = String(job?.databaseFile || '');
  if (!databaseFile) throw new Error('Repository Intelligence worker requires databaseFile.');
  if (kind === 'recover') {
    discardRepositoryIndex(databaseFile);
    const result = await refreshRepositoryIndex({ ...job, kind, paths: null }, signal);
    return { ...result, rebuilt: true, recovered: true };
  }
  if (kind === 'rebuild') {
    const result = await refreshRepositoryIndex({ ...job, kind, paths: null }, signal);
    return { ...result, rebuilt: true, recovered: false };
  }
  try {
    return await refreshRepositoryIndex(job, signal);
  } catch (error) {
    if (!isRecoverableIndexError(error)) throw error;
    const recoveryReason = boundedErrorMessage(error);
    discardRepositoryIndex(databaseFile);
    const result = await refreshRepositoryIndex({ ...job, kind: 'recover', paths: null }, signal);
    return { ...result, rebuilt: true, recovered: true, recoveryReason };
  }
}

async function refreshRepositoryIndex(job, signal) {
  throwIfAborted(signal);
  const workspace = normalizeWorkspace(job?.workspace);
  const databaseFile = String(job?.databaseFile || '');
  const checkedAt = new Date().toISOString();
  const maxFiles = boundedMaxFiles(job?.maxFiles);
  let db = null;
  let generationId = null;
  let processedFiles = 0;
  let skippedChangedFiles = 0;
  try {
    db = openIndexDatabase(databaseFile);
    ensureIndexSchema(db);
    const integrity = checkIndexIntegrity(db);
    if (!integrity.ok) {
      const error = new Error(`Repository Intelligence index integrity check failed: ${integrity.message}`);
      error.code = 'INDEX_INTEGRITY_FAILED';
      throw error;
    }
    const previousGeneration = currentGeneration(db);
    const manifest = listManifest(db);
    const manifestByPath = new Map(manifest.map(item => [item.path, item]));
    const parserVersionChanged = manifest.some(item => item.parserVersion !== PARSER_VERSION);
    const requestedPaths = normalizeRequestedPaths(job?.paths);
    let scan = previousGeneration && requestedPaths.length && !parserVersionChanged
      ? scanSelectedPaths(workspace, requestedPaths)
      : scanWorkspace(workspace, maxFiles);
    if (scan.requiresFullScan) scan = scanWorkspace(workspace, maxFiles);
    throwIfAborted(signal);

    const changed = job?.kind === 'rebuild' || scan.mode === 'incremental'
      ? scan.candidates
      : scan.candidates.filter(candidate => candidateChanged(candidate, manifestByPath.get(candidate.path)));
    const deletionDeferred = scan.mode === 'full' && scan.truncated;
    const deleted = scan.mode === 'full'
      ? deletionDeferred ? [] : manifest.filter(item => !scan.currentPaths.has(item.path)).map(item => item.path)
      : [...scan.missingPaths].filter(relativePath => manifestByPath.has(relativePath));
    if (!changed.length && !deleted.length && previousGeneration) {
      const metadata = indexMetadata(db, previousGeneration, workspace, scan, checkedAt, true, 0, 0, 0, 0, deletionDeferred);
      return attachZoektMetadata(metadata, job, workspace, databaseFile, scan, signal);
    }

    const changedPaths = changed.map(candidate => candidate.path);
    const canScopeRelationships = scan.mode === 'incremental'
      && deleted.length === 0
      && changed.length > 0
      && changed.length <= 100
      && changed.every(candidate => manifestByPath.has(candidate.path))
      && changed.every(candidate => !isRelationshipResolverSensitivePath(candidate.path));
    const relationshipImpact = canScopeRelationships
      ? relationshipImpactForPaths(db, changedPaths)
      : null;
    const relationshipNames = new Set(relationshipImpact?.relationshipNames || []);
    let relationshipScopeSafe = canScopeRelationships;

    let sourceReadFailureCount = 0;
    const generationKind = previousGeneration ? normalizeGenerationKind(job?.kind) : 'build';
    generationId = beginGeneration(db, generationKind);
    for (let offset = 0; offset < changed.length; offset += WRITE_BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = changed.slice(offset, offset + WRITE_BATCH_SIZE);
      const parsedBatch = [];
      const failedPaths = [];
      for (const candidate of batch) {
        throwIfAborted(signal);
        const parsedResult = await parseCandidate(candidate);
        if (parsedResult.parsed) {
          const parsed = parsedResult.parsed;
          parsedBatch.push({ candidate, parsed });
          if (relationshipImpact) {
            for (const symbol of parsed.symbols || []) {
              if (symbol.name) relationshipNames.add(String(symbol.name));
              if (symbol.qualifiedName) relationshipNames.add(String(symbol.qualifiedName));
            }
            for (const relation of parsed.relations || []) {
              if (relation.targetName) relationshipNames.add(String(relation.targetName));
              if (relation.targetQualifiedName) relationshipNames.add(String(relation.targetQualifiedName));
            }
          }
        } else if (parsedResult.transientError) {
          sourceReadFailureCount += 1;
          relationshipScopeSafe = false;
          if (!manifestByPath.has(candidate.path)) failedPaths.push(candidate.path);
        } else {
          failedPaths.push(candidate.path);
          relationshipScopeSafe = false;
        }
      }
      throwIfAborted(signal);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of parsedBatch) replaceFileFacts(db, generationId, item.candidate, item.parsed, PARSER_VERSION);
        for (const relativePath of failedPaths) deleteIndexedPath(db, relativePath);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
      processedFiles += parsedBatch.length;
      skippedChangedFiles += failedPaths.length;
    }
    if (deleted.length) {
      throwIfAborted(signal);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const relativePath of deleted) deleteIndexedPath(db, relativePath);
        db.exec('COMMIT');
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    }
    throwIfAborted(signal);
    db.exec('BEGIN IMMEDIATE');
    try {
      let relationshipSourceIds = null;
      if (relationshipImpact && relationshipScopeSafe) {
        const impacted = new Set(relationshipImpact.sourceFileIds);
        for (const sourceId of relationshipSourceIdsForNames(db, [...relationshipNames])) impacted.add(sourceId);
        for (const sourceId of relationshipImpactForPaths(db, changedPaths).sourceFileIds) impacted.add(sourceId);
        if (impacted.size <= 500) relationshipSourceIds = [...impacted];
      }
      resolveRelationships(db, { workspaceRoot: workspace.path, sourceFileIds: relationshipSourceIds });
      finishGeneration(db, generationId, 'committed', processedFiles + skippedChangedFiles + deleted.length);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {}
    const metadata = indexMetadata(
      db,
      currentGeneration(db),
      workspace,
      scan,
      checkedAt,
      false,
      changed.length,
      deleted.length,
      skippedChangedFiles,
      sourceReadFailureCount,
      deletionDeferred
    );
    return attachZoektMetadata(metadata, job, workspace, databaseFile, scan, signal);
  } catch (error) {
    if (db && generationId != null) {
      try { finishGeneration(db, generationId, 'failed', processedFiles, boundedErrorMessage(error)); } catch {}
    }
    throw error;
  } finally {
    try { db?.close(); } catch {}
  }
}

async function attachZoektMetadata(metadata, job, workspace, databaseFile, scan, signal) {
  if (scan.mode !== 'full') return metadata;
  if (scan.truncated || metadata.needsReconcile) {
    return {
      ...metadata,
      zoekt: {
        available: false,
        current: false,
        reason: scan.truncated
          ? 'Zoekt rebuild skipped because the repository scan was truncated.'
          : 'Zoekt rebuild skipped because source reads were incomplete.'
      }
    };
  }
  try {
    const zoekt = await rebuildZoektIndex(
      workspace,
      databaseFile,
      job?.zoektSettings || {},
      metadata,
      scan.candidates,
      { signal }
    );
    return { ...metadata, zoekt };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      ...metadata,
      zoekt: {
        available: false,
        current: false,
        reason: boundedErrorMessage(error)
      }
    };
  }
}

function scanWorkspace(workspace, maxFiles = DEFAULT_MAX_INDEX_FILES) {
  const realRoot = realRootOf(workspace.path);
  const tree = collectTextFiles(workspace.path, collectOptionsFromWorkspace(workspace, { maxEntries: maxFiles }));
  const candidates = [];
  let skippedLargeFiles = 0;
  for (const relativePath of tree.files) {
    const candidate = candidateForPath(realRoot, relativePath);
    if (!candidate) continue;
    if (candidate.tooLarge) { skippedLargeFiles += 1; continue; }
    candidates.push(candidate);
  }
  return {
    mode: 'full', candidates, currentPaths: new Set(candidates.map(item => item.path)), missingPaths: new Set(),
    discoveredFiles: tree.files.length, collectionSkippedCount: tree.skipped.length, skippedLargeFiles,
    truncated: tree.truncated, requiresFullScan: false
  };
}

function scanSelectedPaths(workspace, requestedPaths) {
  const realRoot = realRootOf(workspace.path);
  const candidates = [];
  const currentPaths = new Set();
  const missingPaths = new Set();
  let skippedLargeFiles = 0;
  for (const requested of requestedPaths) {
    const normalized = normalizeRelativePath(requested);
    if (!normalized) continue;
    const absolutePath = path.resolve(realRoot, normalized);
    if (!isPathInside(absolutePath, realRoot)) continue;
    let stat;
    try { stat = fs.statSync(absolutePath); } catch { missingPaths.add(normalized); continue; }
    if (stat.isDirectory()) {
      return { mode: 'incremental', candidates: [], currentPaths: new Set(), missingPaths: new Set(), discoveredFiles: 0, collectionSkippedCount: 0, skippedLargeFiles: 0, truncated: false, requiresFullScan: true };
    }
    if (!stat.isFile()) continue;
    currentPaths.add(normalized);
    if (stat.size > MAX_INDEXED_FILE_BYTES) { skippedLargeFiles += 1; missingPaths.add(normalized); continue; }
    candidates.push(candidateFromStat(normalized, absolutePath, stat));
  }
  return { mode: 'incremental', candidates, currentPaths, missingPaths, discoveredFiles: candidates.length, collectionSkippedCount: 0, skippedLargeFiles, truncated: false, requiresFullScan: false };
}

function candidateForPath(realRoot, relativePath) {
  try {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized) return null;
    const absolutePath = path.resolve(realRoot, normalized);
    if (!isPathInside(absolutePath, realRoot)) return null;
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_INDEXED_FILE_BYTES) return { tooLarge: true };
    return candidateFromStat(normalized, absolutePath, stat);
  } catch { return null; }
}

function candidateFromStat(relativePath, absolutePath, stat) {
  return {
    path: relativePath,
    absolutePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    language: languageForPath(relativePath),
    test: isTestPath(relativePath)
  };
}

function candidateChanged(candidate, previous) {
  if (!previous) return true;
  if (previous.sizeBytes !== candidate.size
    || previous.mtimeMs !== candidate.mtimeMs
    || previous.ctimeMs !== candidate.ctimeMs
    || previous.parserVersion !== PARSER_VERSION) return true;
  try {
    const data = fs.readFileSync(candidate.absolutePath);
    candidate.contentHash = crypto.createHash('sha256').update(data).digest('hex');
    return candidate.contentHash !== previous.contentHash;
  } catch {
    return true;
  }
}

async function parseCandidate(candidate) {
  let data;
  try {
    data = fs.readFileSync(candidate.absolutePath);
  } catch (error) {
    return { parsed: null, transientError: boundedErrorMessage(error) };
  }
  if (looksBinary(data)) return { parsed: null, skipped: 'binary' };
  try {
    const parsed = await parseSourceFile({ relativePath: candidate.path, source: data.toString('utf8') });
    candidate.contentHash ||= crypto.createHash('sha256').update(data).digest('hex');
    return { parsed };
  } catch (error) {
    return { parsed: null, transientError: boundedErrorMessage(error) };
  }
}

function indexMetadata(
  db,
  generation,
  workspace,
  scan,
  checkedAt,
  cacheHit,
  changedPathCount,
  deletedPathCount,
  skippedChangedFiles,
  sourceReadFailureCount = 0,
  deletionDeferred = false
) {
  const stats = indexStats(db);
  const needsReconcile = sourceReadFailureCount > 0 || scan.truncated;
  const freshness = sourceReadFailureCount > 0 ? 'stale' : scan.truncated ? 'partial' : 'current';
  return {
    mode: 'persistent-tree-sitter-sqlite', persistent: true, freshness, cacheHit, scanMode: scan.mode, workerIsolated: true,
    fingerprint: `generation:${Number(generation?.id || 0)}`, generation: Number(generation?.id || 0),
    builtAt: generation?.completed_at || generation?.started_at || null, checkedAt,
    newestSourceMtime: stats.newestMtimeMs ? new Date(stats.newestMtimeMs).toISOString() : null,
    sourceFileCount: stats.fileCount, discoveredFileCount: scan.mode === 'full' ? scan.discoveredFiles : stats.fileCount,
    indexedBytes: stats.indexedBytes, skippedLargeFiles: scan.skippedLargeFiles, collectionSkippedCount: scan.collectionSkippedCount,
    structuralFileCount: stats.structuralFileCount,
    structuralDegradedFileCount: stats.structuralDegradedFileCount,
    symbolCount: stats.symbolCount,
    occurrenceCount: stats.occurrenceCount,
    changedPathCount,
    deletedPathCount,
    skippedChangedFiles,
    sourceReadFailureCount,
    deletionDeferred,
    needsReconcile,
    truncated: scan.truncated,
    providers: { structural: 'tree-sitter-wasm', graph: 'sqlite', lexical: 'sqlite-fts5', neural: false },
    languageIntelligence: { structuralLanguages: structuralLanguages().length, enhancedLanguages: enhancedResolverLanguages() },
    policy: 'Persistent derived index with worker-isolated parsing, bounded incremental refresh, and periodic full reconciliation. Source remains authoritative.',
    workspace: workspace.alias
  };
}

function discardRepositoryIndex(databaseFile) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(`${databaseFile}${suffix}`, { force: true }); } catch {}
  }
}

function isRecoverableIndexError(error) {
  if (!error || error.code === 'INDEX_ABORTED' || error.code === 'INDEX_SCHEMA_FUTURE') return false;
  if (error.code === 'INDEX_INTEGRITY_FAILED') return true;
  return /(?:database disk image is malformed|database is malformed|file is not a database|database corrupt|sqlite_corrupt|sqlite_notadb)/.test(boundedErrorMessage(error).toLowerCase());
}

function normalizeWorkspace(workspace) {
  const value = workspace && typeof workspace === 'object' ? workspace : {};
  const context = value.context && typeof value.context === 'object' ? value.context : {};
  return { alias: String(value.alias || ''), path: String(value.path || ''), context: { includeRoots: Array.isArray(context.includeRoots) ? [...context.includeRoots] : Array.isArray(context.includePaths) ? [...context.includePaths] : [], excludePaths: Array.isArray(context.excludePaths) ? [...context.excludePaths] : [] } };
}

function isRelationshipResolverSensitivePath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').toLowerCase();
  const base = path.posix.basename(normalized);
  return new Set([
    'package.json', 'tsconfig.json', 'jsconfig.json', 'go.mod', 'composer.json',
    'cargo.toml', 'pyproject.toml', 'compile_commands.json'
  ]).has(base) || base.endsWith('.csproj');
}

function normalizeRequestedPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return '';
  return path.posix.normalize(normalized);
}

function normalizeJobKind(value) {
  const kind = String(value || 'refresh').toLowerCase();
  return ['build', 'refresh', 'rebuild', 'recover'].includes(kind) ? kind : 'refresh';
}

function normalizeGenerationKind(value) {
  const kind = normalizeJobKind(value);
  return kind === 'build' ? 'refresh' : kind;
}

function boundedMaxFiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_INDEX_FILES;
  return Math.max(1, Math.min(500000, Math.floor(parsed)));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error(signal.reason instanceof Error ? signal.reason.message : 'Repository Intelligence indexing was cancelled.');
  error.name = 'AbortError';
  error.code = 'INDEX_ABORTED';
  throw error;
}

function boundedErrorMessage(error) {
  return String(error instanceof Error ? error.message : error || 'Unknown error').slice(0, 2000);
}

export { DEFAULT_MAX_INDEX_FILES, MAX_INDEXED_FILE_BYTES, discardRepositoryIndex, executeRepositoryIndexJob, isRecoverableIndexError, scanWorkspace };
