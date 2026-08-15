import { Worker } from 'node:worker_threads';

import { repositoryIndexPath } from './database.js';
import { repositoryIndexStatus } from './indexer.js';

const QUERY_WORKER_IDLE_EVICT_MS = 60_000;
const QUERY_WORKER_CANCEL_GRACE_MS = 250;
const QUERY_WORKER_COUNT = 2;
const clients = new Map();

function runRepositoryQuery(kind, workspace, config = {}, payload = {}, options = {}) {
  const key = repositoryIndexPath(config, workspace);
  const includePeerState = needsPeerRepositoryState(kind, payload);
  const job = {
    kind,
    workspace: serializableWorkspace(workspace),
    config: serializableConfig(config, { includeWorkspaces: includePeerState }),
    ...(includePeerState ? { repositoryStatuses: repositoryStatusSnapshot(workspace, config) } : {}),
    ...payload,
    options: serializableOptions(options)
  };
  return queryWorkerClient(key).run(job, options.signal);
}

function needsPeerRepositoryState(kind, payload = {}) {
  if (kind === 'cachedContext' || kind === 'cachedSummary') return true;
  return kind === 'codeInspect' && String(payload?.args?.action || '').toLowerCase() === 'architecture';
}

function queryWorkerClient(key) {
  const existing = clients.get(key);
  if (existing && !existing.closed) return existing;

  const queue = [];
  const slots = [];
  let nextJobId = 1;
  let idleTimer = null;

  const client = {
    closed: false,
    run(job, signal) {
      if (client.closed) return Promise.reject(new Error('Repository Intelligence query worker pool is closed.'));
      if (signal?.aborted) return Promise.reject(queryAbortError(signal.reason));
      return new Promise((resolve, reject) => {
        const entry = {
          jobId: `query-${nextJobId++}`,
          job,
          signal,
          resolve,
          reject,
          slot: null,
          cancelTimer: null,
          onAbort: null
        };
        entry.onAbort = () => cancelEntry(entry, signal?.reason);
        signal?.addEventListener?.('abort', entry.onAbort, { once: true });
        queue.push(entry);
        pump();
      });
    },
    terminate(reason = new Error('Repository Intelligence query worker pool terminated.')) {
      if (client.closed) return;
      client.closed = true;
      clearIdleTimer();
      if (clients.get(key) === client) clients.delete(key);
      const pending = queue.splice(0);
      for (const slot of slots) {
        if (slot.active) pending.push(slot.active);
        slot.active = null;
        disposeWorker(slot.worker);
        slot.worker = null;
      }
      for (const entry of pending) settle(entry, 'reject', reason);
    }
  };

  function createWorker(slot) {
    const worker = new Worker(new URL('./queryWorker.js', import.meta.url));
    worker.unref();
    worker.on('message', message => {
      if (slot.worker !== worker || message?.type !== 'result' || !slot.active || message.jobId !== slot.active.jobId) return;
      const completed = slot.active;
      slot.active = null;
      completed.slot = null;
      if (message.ok) settle(completed, 'resolve', message.result);
      else settle(completed, 'reject', workerError(message.error));
      worker.unref();
      pump();
    });
    worker.on('error', error => replaceWorker(slot, worker, error));
    worker.on('exit', code => {
      if (!client.closed && slot.worker === worker) {
        replaceWorker(slot, worker, new Error(`Repository Intelligence query worker exited with code ${code}.`));
      }
    });
    return worker;
  }

  function replaceWorker(slot, worker, reason) {
    if (slot.worker !== worker) return;
    const active = slot.active;
    slot.active = null;
    if (active) {
      active.slot = null;
      settle(active, 'reject', reason);
    }
    slot.worker = null;
    disposeWorker(worker);
    pump();
  }

  function pump() {
    if (client.closed) return;
    clearIdleTimer();
    while (queue.length) {
      let slot = slots.find(item => !item.active && item.worker);
      if (!slot) {
        slot = slots.find(item => !item.active && !item.worker);
        if (slot) slot.worker = createWorker(slot);
      }
      if (!slot) break;
      const entry = queue.shift();
      if (entry.signal?.aborted) {
        settle(entry, 'reject', queryAbortError(entry.signal.reason));
        continue;
      }
      slot.active = entry;
      entry.slot = slot;
      slot.worker.ref();
      try {
        slot.worker.postMessage({ type: 'run', jobId: entry.jobId, job: entry.job });
      } catch (error) {
        replaceWorker(slot, slot.worker, error);
      }
    }
    if (!queue.length && slots.every(slot => !slot.active)) scheduleIdleTimer();
  }

  function cancelEntry(entry, reason) {
    const error = queryAbortError(reason);
    const slot = entry.slot;
    if (slot?.active === entry) {
      try { slot.worker?.postMessage({ type: 'abort', jobId: entry.jobId, reason: error.message }); } catch {}
      entry.cancelTimer = setTimeout(() => {
        if (slot.active === entry && slot.worker) replaceWorker(slot, slot.worker, error);
      }, QUERY_WORKER_CANCEL_GRACE_MS);
      entry.cancelTimer.unref?.();
      return;
    }
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    settle(entry, 'reject', error);
    pump();
  }

  function settle(entry, mode, value) {
    if (!entry) return;
    if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    entry.signal?.removeEventListener?.('abort', entry.onAbort);
    if (mode === 'resolve') entry.resolve(value);
    else entry.reject(value);
  }

  function clearIdleTimer() {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  function scheduleIdleTimer() {
    clearIdleTimer();
    if (client.closed || queue.length || slots.some(slot => slot.active)) return;
    for (const slot of slots) slot.worker?.unref();
    idleTimer = setTimeout(
      () => client.terminate(new Error('Repository Intelligence query worker pool idle timeout reached.')),
      QUERY_WORKER_IDLE_EVICT_MS
    );
    idleTimer.unref?.();
  }

  for (let index = 0; index < QUERY_WORKER_COUNT; index += 1) {
    slots.push({ index, worker: null, active: null });
  }

  clients.set(key, client);
  scheduleIdleTimer();
  return client;
}

function disposeWorker(worker) {
  if (!worker) return;
  worker.removeAllListeners();
  void worker.terminate().catch(() => {});
}

function repositoryStatusSnapshot(workspace, config) {
  const result = {};
  const entries = [[workspace.alias, workspace], ...Object.entries(config.workspaces || {}).map(([alias, item]) => [alias, { alias, ...(item || {}) }])];
  for (const [alias, candidate] of entries) {
    if (!alias || !candidate?.path || result[alias]) continue;
    try {
      const status = repositoryIndexStatus(candidate, config);
      const metadata = status.metadata;
      result[alias] = {
        dirty: status.dirty === true,
        metadata: metadata ? {
          generation: Number(metadata.generation || 0),
          freshness: String(metadata.freshness || ''),
          truncated: metadata.truncated === true,
          needsReconcile: metadata.needsReconcile === true
        } : null
      };
    } catch {}
  }
  return result;
}

function serializableWorkspace(workspace = {}) {
  return {
    alias: String(workspace.alias || ''),
    path: String(workspace.path || ''),
    sourceAlias: String(workspace.sourceAlias || ''),
    taskSandbox: workspace.taskSandbox === true,
    context: plainObject(workspace.context),
    commands: plainObject(workspace.commands),
    testCommands: plainObject(workspace.testCommands)
  };
}

function serializableConfig(config = {}, options = {}) {
  const workspaces = {};
  if (options.includeWorkspaces === true) {
    for (const [alias, workspace] of Object.entries(config.workspaces || {})) workspaces[alias] = serializableWorkspace({ alias, ...workspace });
  }
  return {
    ...(config.stateDir ? { stateDir: String(config.stateDir) } : {}),
    repositoryIntelligence: plainObject(config.repositoryIntelligence),
    ...(options.includeWorkspaces === true ? { workspaces } : {})
  };
}

function serializableOptions(options = {}) {
  return {
    ...(options.graphDiffusion === false ? { graphDiffusion: false } : {}),
    ...(options.maxResults != null ? { maxResults: Number(options.maxResults) } : {}),
    ...(options.maxNodes != null ? { maxNodes: Number(options.maxNodes) } : {}),
    ...(options.maxEdges != null ? { maxEdges: Number(options.maxEdges) } : {})
  };
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item == null || ['string', 'number', 'boolean'].includes(typeof item) || Array.isArray(item) || typeof item === 'object'));
}

function workerError(details = {}) {
  const error = new Error(String(details.message || 'Repository Intelligence query worker failed.'));
  error.name = String(details.name || 'Error');
  if (details.code) error.code = String(details.code);
  if (details.stack) error.stack = String(details.stack);
  return error;
}

function queryAbortError(reason) {
  const error = reason instanceof Error ? new Error(reason.message) : new Error('Repository Intelligence query cancelled.');
  error.name = 'AbortError';
  error.code = 'QUERY_ABORTED';
  return error;
}

function shutdownRepositoryQueryWorkers() {
  for (const client of [...clients.values()]) client.terminate(new Error('Repository Intelligence is shutting down.'));
  clients.clear();
}

export { QUERY_WORKER_COUNT, QUERY_WORKER_IDLE_EVICT_MS, runRepositoryQuery, shutdownRepositoryQueryWorkers };
