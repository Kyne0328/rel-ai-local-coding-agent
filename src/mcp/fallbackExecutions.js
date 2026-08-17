import * as crypto from 'node:crypto';

const DEFAULT_FALLBACK_GRACE_MS = 30_000;
const FALLBACK_RECORD_TTL_MS = 15 * 60_000;
const MAX_FALLBACK_RECORDS = 128;
const executionsByWorkId = new Map();

function startFallbackExecution({ workId, tool, workspace = '', signature = '', run, now = Date.now }) {
  const id = String(workId || '').trim();
  if (!id) throw new Error('A work_id is required for fallback execution.');
  if (typeof run !== 'function') throw new TypeError('Fallback execution requires a run function.');
  pruneFallbackExecutions(now);

  const existing = executionsByWorkId.get(id);
  if (existing?.status === 'running') {
    if (existing.signature === signature) return { record: existing, reused: true };
    const error = new Error('Another long-running operation is already active for this work session. Check relai_work status before starting another operation.');
    error.code = 'TASK_OPERATION_IN_PROGRESS';
    error.retryable = true;
    throw error;
  }

  const startedAtMs = now();
  const record = {
    operationId: `fallback_${crypto.randomUUID()}`,
    workId: id,
    tool: String(tool || ''),
    workspace: String(workspace || ''),
    signature,
    status: 'running',
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    completedAt: '',
    completedAtMs: 0,
    result: null,
    error: '',
    promise: null
  };

  record.promise = Promise.resolve()
    .then(run)
    .then(result => {
      const completedAtMs = now();
      record.status = result?.isError === true ? 'failed' : 'completed';
      record.completedAtMs = completedAtMs;
      record.completedAt = new Date(completedAtMs).toISOString();
      record.result = result || null;
      return { ok: true, result };
    }, error => {
      const completedAtMs = now();
      record.status = 'failed';
      record.completedAtMs = completedAtMs;
      record.completedAt = new Date(completedAtMs).toISOString();
      record.error = error instanceof Error ? error.message : String(error);
      return { ok: false, error };
    });

  executionsByWorkId.set(id, record);
  pruneFallbackExecutions(now);
  return { record, reused: false };
}

function fallbackExecutionStatus(workId, now = Date.now) {
  pruneFallbackExecutions(now);
  const record = executionsByWorkId.get(String(workId || '').trim());
  if (!record) return null;
  return publicFallbackRecord(record);
}

function publicFallbackRecord(record) {
  const structured = record.result?.structuredContent;
  return {
    operationId: record.operationId,
    tool: record.tool,
    workspace: record.workspace,
    status: record.status,
    startedAt: record.startedAt,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(structured && typeof structured === 'object' ? { result: structured } : {}),
    ...(record.result?.isError === true ? { isError: true } : {})
  };
}

function pruneFallbackExecutions(now = Date.now) {
  const current = Number(now());
  for (const [workId, record] of executionsByWorkId) {
    if (record.status === 'running') continue;
    const completed = Number(record.completedAtMs || record.startedAtMs || current);
    if (current - completed > FALLBACK_RECORD_TTL_MS) executionsByWorkId.delete(workId);
  }
  if (executionsByWorkId.size <= MAX_FALLBACK_RECORDS) return;
  const removable = [...executionsByWorkId.entries()]
    .filter(([, record]) => record.status !== 'running')
    .sort((left, right) => Number(left[1].completedAtMs || left[1].startedAtMs) - Number(right[1].completedAtMs || right[1].startedAtMs));
  while (executionsByWorkId.size > MAX_FALLBACK_RECORDS && removable.length) {
    executionsByWorkId.delete(removable.shift()[0]);
  }
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
}

export {
  DEFAULT_FALLBACK_GRACE_MS,
  fallbackExecutionStatus,
  fallbackSignature,
  resetFallbackExecutions,
  startFallbackExecution
};
