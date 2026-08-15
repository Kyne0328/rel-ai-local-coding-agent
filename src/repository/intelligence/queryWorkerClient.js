import { Worker } from 'node:worker_threads';

import { repositoryIndexPath } from './database.js';
import { repositoryIndexStatus } from './indexer.js';

const QUERY_WORKER_IDLE_EVICT_MS = 60_000;
const QUERY_WORKER_CANCEL_GRACE_MS = 250;
const clients = new Map();

function runRepositoryQuery(kind, workspace, config = {}, payload = {}, options = {}) {
  const key = repositoryIndexPath(config, workspace);
  const job = {
    kind,
    workspace: serializableWorkspace(workspace),
    config: serializableConfig(config),
    repositoryStatuses: repositoryStatusSnapshot(workspace, config),
    ...payload,
    options: serializableOptions(options)
  };
  return queryWorkerClient(key).run(job, options.signal);
}

function queryWorkerClient(key) {
  const existing = clients.get(key);
  if (existing && !existing.closed) return existing;

  const worker = new Worker(new URL('./queryWorker.js', import.meta.url));
  worker.unref();
  const queue = [];
  let active = null;
  let nextJobId = 1;
  let idleTimer = null;

  const client = {
    closed: false,
    run(job, signal) {
      if (client.closed) return Promise.reject(new Error('Repository Intelligence query worker is closed.'));
      if (signal?.aborted) return Promise.reject(queryAbortError(signal.reason));
      return new Promise((resolve, reject) => {
        const entry = {
          jobId: `query-${nextJobId++}`,
          job,
          signal,
          resolve,
          reject,
          cancelTimer: null,
          onAbort: null
        };
        entry.onAbort = () => cancelEntry(entry, signal?.reason);
        signal?.addEventListener?.('abort', entry.onAbort, { once: true });
        queue.push(entry);
        pump();
      });
    },
    terminate(reason = new Error('Repository Intelligence query worker terminated.')) {
      if (client.closed) return;
      client.closed = true;
      clearIdleTimer();
      if (clients.get(key) === client) clients.delete(key);
      const pending = [...(active ? [active] : []), ...queue.splice(0)];
      active = null;
      for (const entry of pending) settle(entry, 'reject', reason);
      worker.removeAllListeners();
      void worker.terminate().catch(() => {});
    }
  };

  function pump() {
    if (client.closed || active || queue.length === 0) {
      if (!active && queue.length === 0) scheduleIdleTimer();
      return;
    }
    clearIdleTimer();
    active = queue.shift();
    worker.ref();
    try {
      worker.postMessage({ type: 'run', jobId: active.jobId, job: active.job });
    } catch (error) {
      const failed = active;
      active = null;
      settle(failed, 'reject', error);
      if (queue.length === 0) worker.unref();
      pump();
    }
  }

  function cancelEntry(entry, reason) {
    const error = queryAbortError(reason);
    if (active === entry) {
      try { worker.postMessage({ type: 'abort', jobId: entry.jobId, reason: error.message }); } catch {}
      entry.cancelTimer = setTimeout(() => {
        if (active === entry) client.terminate(error);
      }, QUERY_WORKER_CANCEL_GRACE_MS);
      entry.cancelTimer.unref?.();
      return;
    }
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    settle(entry, 'reject', error);
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
    if (client.closed || active || queue.length) return;
    idleTimer = setTimeout(() => client.terminate(new Error('Repository Intelligence query worker idle timeout reached.')), QUERY_WORKER_IDLE_EVICT_MS);
    idleTimer.unref?.();
  }

  worker.on('message', message => {
    if (message?.type !== 'result' || !active || message.jobId !== active.jobId) return;
    const completed = active;
    active = null;
    if (message.ok) settle(completed, 'resolve', message.result);
    else settle(completed, 'reject', workerError(message.error));
    if (queue.length === 0) worker.unref();
    pump();
  });
  worker.on('error', error => client.terminate(error));
  worker.on('exit', code => {
    if (!client.closed) client.terminate(new Error(`Repository Intelligence query worker exited with code ${code}.`));
  });

  clients.set(key, client);
  return client;
}

function repositoryStatusSnapshot(workspace, config) {
  const result = {};
  const entries = [[workspace.alias, workspace], ...Object.entries(config.workspaces || {}).map(([alias, item]) => [alias, { alias, ...(item || {}) }])];
  for (const [alias, candidate] of entries) {
    if (!alias || !candidate?.path || result[alias]) continue;
    try {
      const status = repositoryIndexStatus(candidate, config);
      result[alias] = { dirty: status.dirty === true, metadata: status.metadata ? true : null };
    } catch {}
  }
  return result;
}

function serializableWorkspace(workspace = {}) {
  return {
    alias: String(workspace.alias || ''),
    path: String(workspace.path || ''),
    context: plainObject(workspace.context),
    commands: plainObject(workspace.commands),
    testCommands: plainObject(workspace.testCommands)
  };
}

function serializableConfig(config = {}) {
  const workspaces = {};
  for (const [alias, workspace] of Object.entries(config.workspaces || {})) workspaces[alias] = serializableWorkspace({ alias, ...workspace });
  return {
    ...(config.stateDir ? { stateDir: String(config.stateDir) } : {}),
    repositoryIntelligence: plainObject(config.repositoryIntelligence),
    workspaces
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

export { QUERY_WORKER_IDLE_EVICT_MS, runRepositoryQuery, shutdownRepositoryQueryWorkers };
