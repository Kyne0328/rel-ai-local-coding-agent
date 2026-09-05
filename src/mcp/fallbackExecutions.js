import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJsonFile, writeJsonAtomic } from '../durableState.js';
import { getStateDir } from '../statePaths.js';
import { readTaskBackgroundOperation, recordTaskBackgroundOperation } from '../taskHistoryStore.js';
import { sanitizeTaskRecord } from '../taskObservability.js';

const DEFAULT_FALLBACK_GRACE_MS = 1_000;
const FALLBACK_RECORD_TTL_MS = 15 * 60_000;
const MAX_FALLBACK_RECORDS = 128;
const REPLAYABLE_FALLBACK_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const executionsByWorkId = new Map();
const executionsByOperationId = new Map();

function startFallbackExecution({ config = null, workId = '', scopeId = '', tool, workspace = '', signature = '', run, now = Date.now }) {
  const work = String(workId || '').trim();
  const id = work || String(scopeId || '').trim();
  if (!id) throw new Error('Fallback execution requires a durable work_id or authorized workspace execution scope.');
  if (typeof run !== 'function') throw new TypeError('Fallback execution requires a run function.');
  pruneFallbackExecutions(now);

  let existing = executionsByWorkId.get(id) || null;
  if (!existing && config) {
    const persisted = recoverPersistedFallback(config, id, now);
    if (persisted && REPLAYABLE_FALLBACK_STATUSES.has(persisted.status)) existing = hydratePersistedRecord(persisted);
  }
  if (existing?.status === 'running') {
    if (existing.signature === signature) return { record: existing, reused: true };
    const error = new Error('Another long-running operation is already active for this work session. Check relai_work status before starting another operation.');
    error.code = 'TASK_OPERATION_IN_PROGRESS';
    error.retryable = true;
    throw error;
  }
  if (existing && existing.signature === signature && REPLAYABLE_FALLBACK_STATUSES.has(existing.status)) {
    return { record: existing, reused: true };
  }

  const startedAtMs = timeValue(now);
  const startedAt = new Date(startedAtMs).toISOString();
  const controller = new AbortController();
  const record = {
    operationId: `fallback_${crypto.randomUUID()}`,
    executionKey: id,
    workId: work,
    tool: String(tool || ''),
    workspace: String(workspace || ''),
    signature,
    status: 'running',
    startedAt,
    startedAtMs,
    updatedAt: startedAt,
    completedAt: '',
    completedAtMs: 0,
    revision: 1,
    result: null,
    persistedResult: null,
    isError: false,
    error: '',
    controller,
    promise: null
  };

  record.promise = Promise.resolve()
    .then(() => run(controller.signal))
    .then(result => {
      if (controller.signal.aborted) {
        settleCancelledRecord(record, now, controller.signal.reason);
        persistFallbackRecord(config, record);
        return { ok: false, cancelled: true, error: controller.signal.reason };
      }
      settleRecord(record, result?.isError === true ? 'failed' : 'completed', now);
      record.result = result || null;
      record.isError = result?.isError === true;
      persistFallbackRecord(config, record);
      return { ok: true, result };
    }, error => {
      if (controller.signal.aborted) {
        settleCancelledRecord(record, now, controller.signal.reason || error);
        persistFallbackRecord(config, record);
        return { ok: false, cancelled: true, error: controller.signal.reason || error };
      }
      settleRecord(record, 'failed', now);
      record.error = error instanceof Error ? error.message : String(error);
      persistFallbackRecord(config, record);
      return { ok: false, error };
    });

  executionsByWorkId.set(id, record);
  executionsByOperationId.set(record.operationId, record);
  persistFallbackRecord(config, record);
  pruneFallbackExecutions(now);
  return { record, reused: false };
}

function cancelFallbackExecution(workId, options = {}) {
  const id = String(workId || '').trim();
  if (!id) return { cancelled: false, duplicate: false, record: null };
  const now = options.now || Date.now;
  const reason = options.reason instanceof Error
    ? options.reason
    : new Error(String(options.reason || 'Work session cancelled by request.'));
  let record = executionsByWorkId.get(id) || null;
  if (!record && options.config) {
    const persisted = readPersistedFallback(options.config, id);
    if (!persisted) return { cancelled: false, duplicate: false, record: null };
    if (persisted.status !== 'running') return { cancelled: false, duplicate: true, record: persisted };
    const cancelled = {
      ...persisted,
      status: 'cancelled',
      updatedAt: new Date(timeValue(now)).toISOString(),
      completedAt: new Date(timeValue(now)).toISOString(),
      revision: Math.max(1, Number(persisted.revision || 1)) + 1,
      error: reason.message
    };
    persistFallbackSnapshot(options.config, { ...cancelled, workId: String(cancelled.workId || id) });
    return { cancelled: true, duplicate: false, record: cancelled };
  }
  if (record.status !== 'running') return { cancelled: false, duplicate: true, record: publicFallbackRecord(record, now) };
  if (!record.controller.signal.aborted) record.controller.abort(reason);
  settleCancelledRecord(record, now, reason);
  persistFallbackRecord(options.config, record);
  return { cancelled: true, duplicate: false, record: publicFallbackRecord(record, now) };
}

function fallbackExecutionStatus(reference, options = {}) {
  const now = options.now || Date.now;
  pruneFallbackExecutions(now);
  const id = String(reference || '').trim();
  const record = executionsByOperationId.get(id) || executionsByWorkId.get(id);
  if (record) return publicFallbackRecord(record, now);
  if (!options.config || !id) return null;
  const persisted = recoverPersistedFallback(options.config, id, now);
  if (!persisted) return null;
  const hydrated = hydratePersistedRecord(persisted);
  if (hydrated.operationId) executionsByOperationId.set(hydrated.operationId, hydrated);
  if (hydrated.executionKey || hydrated.workId) executionsByWorkId.set(hydrated.executionKey || hydrated.workId, hydrated);
  return publicFallbackRecord(hydrated, now);
}

function publicFallbackRecord(record, now = Date.now) {
  if (!record) return null;
  const structured = record.result?.structuredContent || record.persistedResult || record.result?.result || null;
  const running = record.status === 'running';
  return {
    operationId: record.operationId,
    tool: record.tool,
    workspace: record.workspace,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt || record.startedAt,
    revision: Math.max(1, Number(record.revision || 1)),
    ...(running ? { pollAfterMs: fallbackPollAfterMs(record, now) } : {}),
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(structured && typeof structured === 'object' ? { result: structured } : {}),
    ...((record.result?.isError === true || record.isError === true) ? { isError: true } : {})
  };
}

function fallbackPollAfterMs(record, now = Date.now) {
  const current = timeValue(now);
  const started = Number(record.startedAtMs || Date.parse(record.startedAt) || current);
  const elapsed = Math.max(0, current - started);
  if (elapsed < 10_000) return 1_000;
  if (elapsed < 60_000) return 2_000;
  return 5_000;
}

function recoverPersistedFallback(config, reference, now = Date.now) {
  const persisted = readPersistedFallback(config, reference);
  if (!persisted) return null;
  if (persisted.status !== 'running') return persisted;
  const timestamp = timeValue(now);
  const interrupted = {
    ...persisted,
    status: 'interrupted',
    updatedAt: new Date(timestamp).toISOString(),
    completedAt: new Date(timestamp).toISOString(),
    revision: Math.max(1, Number(persisted.revision || 1)) + 1,
    error: 'Background operation was interrupted because the Rel.AI runtime restarted.'
  };
  persistFallbackSnapshot(config, interrupted);
  return interrupted;
}

function hydratePersistedRecord(record) {
  return {
    operationId: String(record.operationId || ''),
    executionKey: String(record.executionKey || record.workId || record.operationId || ''),
    workId: String(record.workId || ''),
    tool: String(record.tool || ''),
    workspace: String(record.workspace || ''),
    signature: String(record.signature || ''),
    status: String(record.status || ''),
    startedAt: String(record.startedAt || ''),
    startedAtMs: Date.parse(record.startedAt) || 0,
    updatedAt: String(record.updatedAt || record.startedAt || ''),
    completedAt: String(record.completedAt || ''),
    completedAtMs: Date.parse(record.completedAt) || 0,
    revision: Math.max(1, Number(record.revision || 1)),
    result: null,
    persistedResult: record.result && typeof record.result === 'object' ? record.result : null,
    isError: record.isError === true,
    error: String(record.error || ''),
    controller: null,
    promise: null
  };
}

function persistentFallbackRecord(record) {
  const structured = record.result?.structuredContent || record.persistedResult || null;
  return {
    operationId: record.operationId,
    executionKey: record.executionKey || record.workId || record.operationId,
    workId: record.workId,
    tool: record.tool,
    workspace: record.workspace,
    signature: record.signature,
    status: record.status,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt || record.startedAt,
    revision: Math.max(1, Number(record.revision || 1)),
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(structured && typeof structured === 'object' ? { result: structured } : {}),
    ...((record.result?.isError === true || record.isError === true) ? { isError: true } : {})
  };
}

function readPersistedFallback(config, reference) {
  const id = String(reference || '').trim();
  try {
    if (id.startsWith('fallback_')) {
      return readJsonFile(tasklessFallbackFile(config, id), {
        validate: value => Boolean(value && typeof value === 'object' && value.operationId === id)
      });
    }
    return readTaskBackgroundOperation(config, id);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] fallback operation read:', error);
    return null;
  }
}

function persistFallbackRecord(config, record) {
  if (!config || !record) return;
  persistFallbackSnapshot(config, persistentFallbackRecord(record));
}

function persistFallbackSnapshot(config, record) {
  try {
    if (record.workId) {
      recordTaskBackgroundOperation(config, record.workId, record);
      return;
    }
    const file = tasklessFallbackFile(config, record.operationId);
    const sanitized = sanitizeTaskRecord({ status: 'planning', backgroundOperation: record })?.backgroundOperation || {};
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeJsonAtomic(file, sanitized, { mode: 0o600 });
    pruneTasklessFallbackFiles(config);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] fallback operation persistence:', error);
  }
}

function tasklessFallbackFile(config, operationId) {
  const id = String(operationId || '').trim();
  if (!/^fallback_[A-Za-z0-9_-]{20,160}$/.test(id)) throw new Error('Invalid fallback operationId.');
  return path.join(getStateDir(config), 'fallback-executions', `${id}.json`);
}

function pruneTasklessFallbackFiles(config) {
  const root = path.join(getStateDir(config), 'fallback-executions');
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  const cutoff = Date.now() - FALLBACK_RECORD_TTL_MS;
  const files = entries.filter(entry => entry.isFile() && /^fallback_[A-Za-z0-9_-]{20,160}\.json$/.test(entry.name)).map(entry => {
    const file = path.join(root, entry.name);
    try { return { file, mtimeMs: fs.statSync(file).mtimeMs }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs);
  files.forEach((entry, index) => {
    if (entry.mtimeMs >= cutoff && index < MAX_FALLBACK_RECORDS) return;
    try { fs.rmSync(entry.file, { force: true }); } catch {}
  });
}

function settleRecord(record, status, now = Date.now) {
  const completedAtMs = timeValue(now);
  record.status = status;
  record.completedAtMs = completedAtMs;
  record.completedAt = new Date(completedAtMs).toISOString();
  record.updatedAt = record.completedAt;
  record.revision = Math.max(1, Number(record.revision || 1)) + 1;
}

function settleCancelledRecord(record, now = Date.now, reason = null) {
  if (record.status !== 'cancelled') settleRecord(record, 'cancelled', now);
  record.error = reason instanceof Error ? reason.message : String(reason || record.error || 'Work session cancelled by request.');
}

function pruneFallbackExecutions(now = Date.now) {
  const current = timeValue(now);
  for (const [workId, record] of executionsByWorkId) {
    if (record.status === 'running') continue;
    const completed = Number(record.completedAtMs || record.startedAtMs || current);
    if (current - completed > FALLBACK_RECORD_TTL_MS) {
      executionsByWorkId.delete(workId);
      if (record.operationId) executionsByOperationId.delete(record.operationId);
    }
  }
  if (executionsByWorkId.size <= MAX_FALLBACK_RECORDS) return;
  const removable = [...executionsByWorkId.entries()]
    .filter(([, record]) => record.status !== 'running')
    .sort((left, right) => Number(left[1].completedAtMs || left[1].startedAtMs) - Number(right[1].completedAtMs || right[1].startedAtMs));
  while (executionsByWorkId.size > MAX_FALLBACK_RECORDS && removable.length) {
    executionsByWorkId.delete(removable.shift()[0]);
  }
}

function timeValue(now = Date.now) {
  const value = typeof now === 'function' ? now() : now;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function fallbackSignature(tool, args = {}) {
  return crypto.createHash('sha256').update(stableJson([String(tool || ''), args])).digest('base64url');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function resetFallbackExecutions() {
  executionsByWorkId.clear();
  executionsByOperationId.clear();
}

export {
  DEFAULT_FALLBACK_GRACE_MS,
  cancelFallbackExecution,
  fallbackExecutionStatus,
  fallbackSignature,
  resetFallbackExecutions,
  startFallbackExecution
};
