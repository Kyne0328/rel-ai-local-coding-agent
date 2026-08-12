import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { collectOptionsFromWorkspace, createCollectionPathFilter, isPathInside, realRootOf } from '../../safety.js';
import { repositoryIndexPath } from './database.js';
import { DEFAULT_MAX_INDEX_FILES, MAX_INDEXED_FILE_BYTES, scanWorkspace } from './indexBuild.js';

const RECONCILE_INTERVAL_MS = 30000;
const MAX_INCREMENTAL_PATHS = 1000;
const MAX_COALESCED_PASSES = 3;
const WORKER_CANCEL_GRACE_MS = 250;
const WORKER_IDLE_EVICT_MS = 60_000;
const activeBuilds = new Map();
const runtimeStates = new Map();
const workerClients = new Map();

async function ensureRepositoryIndex(workspace, config = {}, options = {}) {
  throwIfAborted(options.signal);
  const databaseFile = repositoryIndexPath(config, workspace);
  const state = runtimeState(databaseFile);
  if (options.watch !== false) ensureWorkspaceWatcher(workspace, databaseFile, state);
  const now = Date.now();
  if (state.metadata && !state.dirty && now - state.lastFullScanAt < RECONCILE_INTERVAL_MS && options.force !== true) {
    return decorateMetadata(state, { ...state.metadata, cacheHit: true, checkedAt: new Date().toISOString() });
  }

  const existing = activeBuilds.get(databaseFile);
  if (existing) return waitForBuild(existing, options.signal);

  const record = { promise: null, waiters: 0, settled: false, cancel: reason => state.currentCancel?.(reason) };
  record.promise = runCoalescedIndexing(workspace, config, databaseFile, state, options)
    .finally(() => {
      record.settled = true;
      if (activeBuilds.get(databaseFile) === record) activeBuilds.delete(databaseFile);
    });
  activeBuilds.set(databaseFile, record);
  return waitForBuild(record, options.signal);
}

async function rebuildRepositoryIndex(workspace, config = {}, options = {}) {
  const databaseFile = repositoryIndexPath(config, workspace);
  await cancelAndDrain(databaseFile, 'Repository Intelligence rebuild requested.');
  const state = runtimeState(databaseFile);
  state.dirty = true;
  state.fullScanRequired = true;
  return ensureRepositoryIndex(workspace, config, { ...options, force: true, mode: 'rebuild' });
}

async function recoverRepositoryIndex(workspace, config = {}, options = {}) {
  const databaseFile = repositoryIndexPath(config, workspace);
  await cancelAndDrain(databaseFile, 'Repository Intelligence recovery requested.');
  const state = runtimeState(databaseFile);
  state.dirty = true;
  state.fullScanRequired = true;
  return ensureRepositoryIndex(workspace, config, { ...options, force: true, mode: 'recover' });
}

function noteRepositoryMutation(workspace, config = {}, paths = []) {
  const state = runtimeState(repositoryIndexPath(config, workspace));
  state.changeRevision += 1;
  state.dirty = true;
  const normalized = normalizePaths(paths);
  if (!normalized.length) {
    state.fullScanRequired = true;
    return;
  }
  for (const relativePath of normalized) state.pendingPaths.add(relativePath);
  if (state.pendingPaths.size > MAX_INCREMENTAL_PATHS) {
    state.pendingPaths.clear();
    state.fullScanRequired = true;
  }
}

function repositoryIndexStatus(workspace, config = {}) {
  const databaseFile = repositoryIndexPath(config, workspace);
  const state = runtimeStates.get(databaseFile);
  if (!state) {
    return { status: 'idle', dirty: true, active: false, watching: false, pendingPathCount: 0, lastError: null, lastFullScanAt: null, lastReconciledAt: null, metadata: null };
  }
  return {
    status: state.status,
    dirty: state.dirty,
    active: activeBuilds.has(databaseFile),
    watching: Boolean(state.watcher),
    pendingPathCount: state.pendingPaths.size,
    lastError: state.lastError,
    lastFullScanAt: isoTime(state.lastFullScanAt),
    lastReconciledAt: isoTime(state.lastReconciledAt),
    metadata: state.metadata ? decorateMetadata(state, state.metadata) : null
  };
}

function cancelRepositoryIndex(workspace, config = {}, reason = 'Repository Intelligence indexing cancelled.') {
  const databaseFile = repositoryIndexPath(config, workspace);
  const record = activeBuilds.get(databaseFile);
  if (!record || record.settled) return false;
  record.cancel(reason);
  return true;
}

function evictIdleRepositoryWorkers(reason = 'Repository Intelligence idle worker evicted.') {
  const evictionError = reason instanceof Error ? reason : new Error(String(reason));
  let evicted = 0;
  for (const client of [...workerClients.values()]) {
    if (!client.closed && client.isIdle()) {
      client.terminate(evictionError);
      evicted += 1;
    }
  }
  return evicted;
}

function shutdownRepositoryIndexes() {
  const shutdownError = abortError('Repository Intelligence is shutting down.');
  for (const record of activeBuilds.values()) record.cancel(shutdownError.message);
  for (const client of workerClients.values()) client.terminate(shutdownError);
  for (const state of runtimeStates.values()) {
    try { state.watcher?.close(); } catch {}
    state.watcher = null;
  }
  runtimeStates.clear();
  activeBuilds.clear();
  workerClients.clear();
}

async function runCoalescedIndexing(workspace, config, databaseFile, state, options) {
  let metadata = state.metadata;
  let mode = normalizeMode(options.mode);
  try {
    for (let pass = 0; pass < MAX_COALESCED_PASSES; pass += 1) {
      throwIfAborted(options.signal);
      const revisionAtStart = state.changeRevision;
      const selection = consumeRefreshSelection(state, mode, options.force === true);
      state.status = statusForMode(mode, metadata);
      state.lastError = null;
      const execution = runIndexWorker({
        kind: mode,
        workspace: serializableWorkspace(workspace),
        databaseFile,
        maxFiles: boundedMaxFiles(options.maxFiles || config?.repositoryIntelligence?.maxFiles),
        paths: selection.paths
      });
      state.currentCancel = execution.cancel;
      try {
        metadata = await execution.promise;
      } finally {
        if (state.currentCancel === execution.cancel) state.currentCancel = null;
      }
      state.metadata = metadata;
      state.lastReconciledAt = Date.now();
      if (metadata.scanMode === 'full') state.lastFullScanAt = state.lastReconciledAt;
      const changedDuringBuild = state.changeRevision !== revisionAtStart;
      state.dirty = changedDuringBuild;
      if (!changedDuringBuild) break;
      mode = 'refresh';
    }
    state.status = 'ready';
    if (state.dirty && metadata) metadata = { ...metadata, freshness: 'stale' };
    state.metadata = metadata;
    return decorateMetadata(state, metadata);
  } catch (error) {
    state.dirty = true;
    if (error?.code === 'INDEX_ABORTED' || error?.name === 'AbortError') {
      state.status = state.metadata ? 'ready' : 'idle';
    } else {
      state.status = 'degraded';
      state.lastError = boundedErrorMessage(error);
    }
    throw error;
  }
}

function consumeRefreshSelection(state, mode, force) {
  const periodicFullScanDue = !state.lastFullScanAt || Date.now() - state.lastFullScanAt >= RECONCILE_INTERVAL_MS;
  const full = force || mode === 'rebuild' || mode === 'recover' || state.fullScanRequired || periodicFullScanDue || state.pendingPaths.size === 0;
  const paths = full ? null : [...state.pendingPaths].slice(0, MAX_INCREMENTAL_PATHS);
  state.pendingPaths.clear();
  state.fullScanRequired = false;
  return { paths };
}

function runIndexWorker(job) {
  return repositoryWorkerClient(job.databaseFile).run(job);
}

function repositoryWorkerClient(databaseFile) {
  const existing = workerClients.get(databaseFile);
  if (existing && !existing.closed) return existing;

  const worker = new Worker(new URL('./indexWorker.js', import.meta.url));
  worker.unref();
  const pending = new Map();
  let nextJobId = 1;
  let idleTimer = null;
  const clearIdleTermination = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };
  const scheduleIdleTermination = () => {
    clearIdleTermination();
    if (client.closed || pending.size > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!client.closed && pending.size === 0) client.terminate(new Error('Repository Intelligence worker idle timeout reached.'));
    }, WORKER_IDLE_EVICT_MS);
    idleTimer.unref?.();
  };
  const client = {
    closed: false,
    isIdle() { return pending.size === 0; },
    run(job) {
      if (client.closed) return failedExecution(new Error('Repository Intelligence worker is closed.'));
      clearIdleTermination();
      const jobId = `index-${nextJobId++}`;
      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
      const entry = { resolve: resolvePromise, reject: rejectPromise, cancelTimer: null, cancelled: false };
      pending.set(jobId, entry);
      worker.ref();
      try {
        worker.postMessage({ type: 'run', jobId, job });
      } catch (error) {
        pending.delete(jobId);
        if (pending.size === 0) { worker.unref(); scheduleIdleTermination(); }
        rejectPromise(error);
      }
      return {
        promise,
        cancel(reason = 'Repository Intelligence worker cancelled.') {
          const current = pending.get(jobId);
          if (!current || current.cancelled) return;
          current.cancelled = true;
          try { worker.postMessage({ type: 'abort', jobId, reason: String(reason) }); } catch {}
          current.cancelTimer = setTimeout(() => {
            if (pending.has(jobId)) client.terminate(abortError(String(reason)));
          }, WORKER_CANCEL_GRACE_MS);
          current.cancelTimer.unref?.();
        }
      };
    },
    terminate(reason = new Error('Repository Intelligence worker terminated.')) {
      if (client.closed) return;
      client.closed = true;
      clearIdleTermination();
      if (workerClients.get(databaseFile) === client) workerClients.delete(databaseFile);
      for (const entry of pending.values()) {
        if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
        entry.reject(reason);
      }
      pending.clear();
      worker.removeAllListeners();
      void worker.terminate().catch(() => {});
    }
  };

  worker.on('message', message => {
    if (message?.type !== 'result') return;
    const entry = pending.get(message.jobId);
    if (!entry) return;
    pending.delete(message.jobId);
    if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    if (pending.size === 0) { worker.unref(); scheduleIdleTermination(); }
    if (message.ok) entry.resolve(message.result);
    else entry.reject(workerError(message.error));
  });
  worker.on('error', error => client.terminate(error));
  worker.on('exit', code => {
    if (!client.closed) client.terminate(new Error(`Repository Intelligence worker exited with code ${code}.`));
  });
  workerClients.set(databaseFile, client);
  return client;
}

function failedExecution(error) {
  return { promise: Promise.reject(error), cancel() {} };
}

function waitForBuild(record, signal) {
  throwIfAborted(signal);
  record.waiters += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    record.waiters = Math.max(0, record.waiters - 1);
    if (record.waiters === 0 && !record.settled) record.cancel('All Repository Intelligence callers cancelled.');
  };
  if (!signal) return record.promise.finally(release);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener?.('abort', onAbort);
      release();
      reject(abortError(signal.reason instanceof Error ? signal.reason.message : 'Repository Intelligence request cancelled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    record.promise.then(
      value => { signal.removeEventListener?.('abort', onAbort); release(); resolve(value); },
      error => { signal.removeEventListener?.('abort', onAbort); release(); reject(error); }
    );
  });
}

async function cancelAndDrain(databaseFile, reason) {
  const existing = activeBuilds.get(databaseFile);
  if (!existing || existing.settled) return;
  existing.cancel(reason);
  try { await existing.promise; } catch {}
}

function ensureWorkspaceWatcher(workspace, databaseFile, state) {
  if (state.watcher) return;
  const root = realRootOf(workspace.path);
  const indexRoot = path.dirname(databaseFile);
  let shouldCollect = createCollectionPathFilter(root, collectOptionsFromWorkspace(workspace));
  try {
    state.watcher = fs.watch(root, { recursive: true, persistent: false }, (eventType, filename) => {
      const normalized = normalizeWatchPath(filename);
      if (normalized === '.relaiignore') {
        shouldCollect = createCollectionPathFilter(root, collectOptionsFromWorkspace(workspace));
      } else if (normalized && shouldIgnoreWatchPath(root, indexRoot, normalized, shouldCollect)) {
        return;
      }
      state.changeRevision += 1;
      state.dirty = true;
      if (!normalized || eventType === 'rename' || normalized === '.relaiignore') {
        state.pendingPaths.clear();
        state.fullScanRequired = true;
        return;
      }
      state.pendingPaths.add(normalized);
      if (state.pendingPaths.size > MAX_INCREMENTAL_PATHS) {
        state.pendingPaths.clear();
        state.fullScanRequired = true;
      }
    });
    state.watcher.on('error', error => {
      state.dirty = true;
      state.fullScanRequired = true;
      state.lastError = boundedErrorMessage(error);
      try { state.watcher?.close(); } catch {}
      state.watcher = null;
    });
  } catch (error) {
    state.watcher = null;
    state.lastError = boundedErrorMessage(error);
  }
}

function shouldIgnoreWatchPath(root, indexRoot, filename, shouldCollect) {
  const normalized = normalizeWatchPath(filename);
  if (!normalized) return false;
  if (typeof shouldCollect === 'function' && !shouldCollect(normalized)) return true;
  return isPathInside(path.resolve(root, normalized), indexRoot);
}

function runtimeState(databaseFile) {
  let state = runtimeStates.get(databaseFile);
  if (!state) {
    state = { metadata: null, dirty: true, changeRevision: 0, lastReconciledAt: 0, lastFullScanAt: 0, watcher: null, pendingPaths: new Set(), fullScanRequired: true, status: 'idle', lastError: null, currentCancel: null };
    runtimeStates.set(databaseFile, state);
  }
  return state;
}

function decorateMetadata(state, metadata) {
  if (!metadata) return metadata;
  return { ...metadata, runtimeStatus: state.status, pendingRefresh: state.dirty, lastError: state.lastError };
}

function serializableWorkspace(workspace) {
  const context = workspace?.context && typeof workspace.context === 'object' ? workspace.context : {};
  return {
    alias: String(workspace?.alias || ''),
    path: String(workspace?.path || ''),
    context: {
      includeRoots: Array.isArray(context.includeRoots) ? context.includeRoots : Array.isArray(context.includePaths) ? context.includePaths : [],
      excludePaths: Array.isArray(context.excludePaths) ? context.excludePaths : []
    }
  };
}

function normalizePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map(normalizeWatchPath).filter(Boolean))];
}

function normalizeWatchPath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function normalizeMode(value) {
  const mode = String(value || 'refresh').toLowerCase();
  return ['refresh', 'rebuild', 'recover'].includes(mode) ? mode : 'refresh';
}

function statusForMode(mode, metadata) {
  if (mode === 'recover') return 'recovering';
  if (mode === 'rebuild') return 'rebuilding';
  return metadata ? 'refreshing' : 'building';
}

function boundedMaxFiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_INDEX_FILES;
  return Math.max(1, Math.min(500000, Math.floor(parsed)));
}

function workerError(details = {}) {
  const error = new Error(String(details.message || 'Repository Intelligence worker failed.'));
  error.name = String(details.name || 'Error');
  if (details.code) error.code = String(details.code);
  if (details.stack) error.stack = String(details.stack);
  return error;
}

function abortError(message) {
  const error = new Error(String(message || 'Repository Intelligence indexing was cancelled.'));
  error.name = 'AbortError';
  error.code = 'INDEX_ABORTED';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal.reason instanceof Error ? signal.reason.message : 'Repository Intelligence request cancelled.');
}

function boundedErrorMessage(error) {
  return String(error instanceof Error ? error.message : error || 'Unknown error').slice(0, 2000);
}

function isoTime(value) {
  return Number(value) > 0 ? new Date(Number(value)).toISOString() : null;
}

export {
  DEFAULT_MAX_INDEX_FILES,
  MAX_INDEXED_FILE_BYTES,
  WORKER_IDLE_EVICT_MS,
  cancelRepositoryIndex,
  evictIdleRepositoryWorkers,
  ensureRepositoryIndex,
  noteRepositoryMutation,
  rebuildRepositoryIndex,
  recoverRepositoryIndex,
  repositoryIndexStatus,
  scanWorkspace,
  shutdownRepositoryIndexes
};
