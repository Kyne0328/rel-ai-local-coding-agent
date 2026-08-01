import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStateDir } from '../statePaths.js';

const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_STATUS_MESSAGE_CHARS = 2000;
const TASK_ID_PATTERN = /^task_[A-Za-z0-9_-]{32,160}$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const VALID_STATUSES = new Set(['working', 'input_required', 'completed', 'failed', 'cancelled']);
const RUNTIME_ID = crypto.randomUUID();
const executors = new Map();

class NativeTaskUnavailableError extends Error {
  constructor() {
    super('Invalid task ID or task is not available to this client.');
    this.code = 'NATIVE_TASK_UNAVAILABLE';
  }
}

class NativeTaskRequestError extends Error {
  constructor(message) {
    super(boundedMessage(message) || 'Invalid native task request.');
    this.code = 'NATIVE_TASK_INVALID_REQUEST';
  }
}

class NativeTaskStoreError extends Error {
  constructor(reason, options = {}) {
    const corrupt = reason === 'record_corrupt';
    super(
      corrupt ? 'Native task record is corrupt.' : 'Native task storage is unavailable.',
      options.cause ? { cause: options.cause } : undefined
    );
    this.code = 'NATIVE_TASK_STORE_ERROR';
    this.reason = String(reason || 'store_unavailable');
    this.retryable = !corrupt;
    this.taskId = String(options.taskId || '');
  }
}

function createNativeTask(config, options = {}) {
  const nowMs = nowValue(options.now);
  const createdAt = new Date(nowMs).toISOString();
  const taskId = `task_${crypto.randomBytes(32).toString('base64url')}`;
  const task = {
    schemaVersion: 1,
    taskId,
    status: normalizeStatus(options.status || 'working'),
    statusMessage: boundedMessage(options.statusMessage || 'Task is running.'),
    createdAt,
    lastUpdatedAt: createdAt,
    ttlMs: normalizeTtl(options.ttlMs),
    pollIntervalMs: normalizePollInterval(options.pollIntervalMs),
    principalFingerprint: principalFingerprint(options.principal),
    origin: {
      method: String(options.method || ''),
      name: String(options.name || ''),
      logicalTaskId: String(options.logicalTaskId || '')
    },
    restartPolicy: normalizeRestartPolicy(options.restartPolicy),
    recovery: normalizeJson(options.recovery || null),
    inputRequests: normalizeInputMap(options.inputRequests),
    inputResponses: {},
    satisfiedInputKeys: [],
    cancelRequested: false,
    result: options.result == null ? null : normalizeJson(options.result),
    error: options.error == null ? null : normalizeJsonRpcError(options.error),
    internal: normalizeJson(options.internal || {})
  };
  persistTask(config, task);
  if (options.executor) attachExecutor(taskId, options.executor);
  return detailedTask(task);
}

function getNativeTask(config, taskId, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  return detailedTask(task);
}

function getNativeTaskRecord(config, taskId, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  return clone(task);
}

function updateNativeTask(config, taskId, patch = {}, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  if (TERMINAL_STATUSES.has(task.status)) return detailedTask(task);
  if (patch.status != null) task.status = normalizeStatus(patch.status);
  if (patch.statusMessage != null) task.statusMessage = boundedMessage(patch.statusMessage);
  if (patch.pollIntervalMs != null) task.pollIntervalMs = normalizePollInterval(patch.pollIntervalMs);
  if (patch.ttlMs !== undefined) task.ttlMs = normalizeTtl(patch.ttlMs);
  if (patch.inputRequests != null) task.inputRequests = normalizeInputMap(patch.inputRequests);
  if (patch.internal && typeof patch.internal === 'object') {
    task.internal = { ...task.internal, ...normalizeJson(patch.internal) };
  }
  task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
  persistTask(config, task);
  return detailedTask(task);
}

function updateNativeTaskRecovery(config, taskId, recovery, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  if (TERMINAL_STATUSES.has(task.status)) return detailedTask(task);
  task.recovery = normalizeJson(recovery || null);
  task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
  persistTask(config, task);
  return detailedTask(task);
}

function completeNativeTask(config, taskId, result, options = {}) {
  return transitionTerminal(config, taskId, 'completed', {
    result: normalizeJson(result),
    statusMessage: options.statusMessage || 'Task completed.'
  }, options);
}

function failNativeTask(config, taskId, error, options = {}) {
  return transitionTerminal(config, taskId, 'failed', {
    error: normalizeJsonRpcError(error),
    statusMessage: options.statusMessage || 'Task failed.'
  }, options);
}

function requestNativeTaskInput(config, taskId, inputRequests, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  if (TERMINAL_STATUSES.has(task.status)) return detailedTask(task);
  const next = normalizeInputMap(inputRequests);
  for (const key of Object.keys(next)) {
    if (Object.hasOwn(task.inputResponses, key) || task.satisfiedInputKeys.includes(key)) {
      throw new Error(`Input request key has already been used: ${key}`);
    }
  }
  task.inputRequests = { ...task.inputRequests, ...next };
  task.status = 'input_required';
  task.statusMessage = boundedMessage(options.statusMessage || 'Task requires client input.');
  task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
  persistTask(config, task);
  return detailedTask(task);
}

function updateNativeTaskInputs(config, taskId, inputResponses, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  if (TERMINAL_STATUSES.has(task.status)) return detailedTask(task);
  const responses = normalizeInputMap(inputResponses);
  if (task.status !== 'input_required') return detailedTask(task);
  let accepted = 0;
  for (const [key, value] of Object.entries(responses)) {
    if (!Object.hasOwn(task.inputRequests, key)) continue;
    if (task.satisfiedInputKeys.includes(key)) continue;
    task.inputResponses[key] = value;
    task.satisfiedInputKeys.push(key);
    delete task.inputRequests[key];
    accepted += 1;
  }
  if (accepted === 0) return detailedTask(task);
  task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
  if (Object.keys(task.inputRequests).length === 0) {
    task.status = 'working';
    task.statusMessage = boundedMessage(options.statusMessage || 'Task resumed after receiving input.');
  }
  persistTask(config, task);
  if (task.status === 'working') resumeExecutor(config, task);
  return detailedTask(task);
}

function cancelNativeTask(config, taskId, options = {}) {
  const task = requireTask(config, taskId, options);
  reconcileTask(config, task, options.now);
  if (TERMINAL_STATUSES.has(task.status)) return detailedTask(task);
  task.cancelRequested = true;
  task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
  persistTask(config, task);
  const executor = executors.get(task.taskId);
  if (executor?.controller && !executor.controller.signal.aborted) {
    executor.controller.abort(new Error('Task cancellation requested by the client.'));
  }
  if (options.immediate !== false) {
    task.status = 'cancelled';
    task.statusMessage = boundedMessage(options.statusMessage || 'Task cancelled.');
    task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
    persistTask(config, task);
    executors.delete(task.taskId);
  }
  return detailedTask(task);
}

function attachNativeTaskExecutor(taskId, executor = {}) {
  const id = validateTaskId(taskId);
  attachExecutor(id, executor);
  return executor.controller?.signal;
}

function nativeTaskSignal(taskId) {
  return executors.get(validateTaskId(taskId))?.controller?.signal;
}

function pruneNativeTasks(config, options = {}) {
  const directory = taskDirectory(config);
  if (!fs.existsSync(directory)) return { removed: 0, reconciled: 0, quarantined: 0 };
  let removed = 0;
  let reconciled = 0;
  let quarantined = 0;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw taskStoreError('read_failed', error);
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const taskId = entry.name.slice(0, -5);
    try {
      const task = readTask(config, taskId);
      if (!task) continue;
      if (isExpired(task, options.now)) {
        removeTask(config, task.taskId);
        removed += 1;
        continue;
      }
      const before = task.status;
      reconcileTask(config, task, options.now);
      if (task.status !== before) reconciled += 1;
    } catch (error) {
      if (error?.code === 'NATIVE_TASK_STORE_ERROR' && error.reason === 'record_corrupt') {
        if (quarantineTaskRecord(config, taskId, options.now)) quarantined += 1;
        continue;
      }
      if (error?.code === 'NATIVE_TASK_UNAVAILABLE') {
        removeUnrecognizedTaskFile(directory, entry.name);
        removed += 1;
        continue;
      }
      throw error;
    }
  }
  return { removed, reconciled, quarantined };
}

function transitionTerminal(config, taskId, status, payload, options) {
  const task = requireTask(config, taskId, options);
  if (TERMINAL_STATUSES.has(task.status)) return detailedTask(task);
  task.status = status;
  task.statusMessage = boundedMessage(payload.statusMessage);
  if (status === 'completed') task.result = payload.result;
  if (status === 'failed') task.error = payload.error;
  task.inputRequests = {};
  task.lastUpdatedAt = new Date(nowValue(options.now)).toISOString();
  persistTask(config, task);
  executors.delete(task.taskId);
  return detailedTask(task);
}

function requireTask(config, taskId, options = {}) {
  const id = validateTaskId(taskId);
  let task;
  try {
    task = readTask(config, id);
  } catch (error) {
    if (error?.code === 'NATIVE_TASK_STORE_ERROR' && error.reason === 'record_corrupt') {
      quarantineTaskRecord(config, id, options.now);
    }
    throw error;
  }
  if (!task || isExpired(task, options.now)) {
    if (task) removeTask(config, id);
    throw new NativeTaskUnavailableError();
  }
  if (options.principal !== undefined && task.principalFingerprint !== principalFingerprint(options.principal)) {
    throw new NativeTaskUnavailableError();
  }
  if (options.logicalTaskId !== undefined) {
    const expected = String(task.origin?.logicalTaskId || '');
    const actual = String(options.logicalTaskId || '');
    if (expected && expected !== actual) throw new NativeTaskUnavailableError();
  }
  return task;
}

function reconcileTask(config, task, nowSource) {
  if (TERMINAL_STATUSES.has(task.status) || task.status === 'input_required') return task;
  if (executors.has(task.taskId)) return task;
  const nowMs = nowValue(nowSource);
  if (task.restartPolicy === 'restart_reconcilable' && task.recovery?.mode === 'deadline') {
    if (nowMs >= Number(task.recovery.completeAtMs || 0)) {
      task.status = 'completed';
      task.statusMessage = boundedMessage(task.recovery.statusMessage || 'Task completed.');
      task.result = normalizeJson(task.recovery.result || {});
      task.inputRequests = {};
      task.lastUpdatedAt = new Date(nowMs).toISOString();
      persistTask(config, task);
    }
    return task;
  }
  if (task.restartPolicy === 'resumable' && task.recovery?.leaseOwner === RUNTIME_ID) return task;
  task.status = 'failed';
  task.statusMessage = 'Task execution was interrupted and must be retried.';
  task.error = {
    code: -32603,
    message: 'Task execution was interrupted by a server restart.',
    data: { retryable: true, reason: 'executor_interrupted' }
  };
  task.inputRequests = {};
  task.lastUpdatedAt = new Date(nowMs).toISOString();
  persistTask(config, task);
  return task;
}

function resumeExecutor(config, task) {
  const executor = executors.get(task.taskId);
  if (!executor?.resume || executor.resumeInFlight) {
    if (!executor && task.restartPolicy === 'non_resumable') reconcileTask(config, task);
    return;
  }
  executor.resumeInFlight = true;
  queueMicrotask(async () => {
    try {
      await executor.resume(clone(task.inputResponses));
    } finally {
      executor.resumeInFlight = false;
    }
  });
}

function attachExecutor(taskId, executor) {
  const controller = executor.controller instanceof AbortController ? executor.controller : new AbortController();
  executors.set(taskId, {
    controller,
    resume: typeof executor.resume === 'function' ? executor.resume : null,
    resumeInFlight: false
  });
}

function taskDirectory(config) {
  return path.join(getStateDir(config), 'native-tasks');
}

function taskPath(config, taskId) {
  return path.join(taskDirectory(config), `${validateTaskId(taskId)}.json`);
}

function readTask(config, taskId) {
  const file = taskPath(config, taskId);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw taskStoreError('read_failed', error, taskId);
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw taskStoreError('record_corrupt', error, taskId);
  }
  if (!parsed || parsed.schemaVersion !== 1 || parsed.taskId !== taskId) {
    throw taskStoreError('record_corrupt', null, taskId);
  }
  return parsed;
}

function persistTask(config, task) {
  const directory = taskDirectory(config);
  const target = taskPath(config, task.taskId);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw taskStoreError('write_failed', error, task.taskId);
  }
}

function removeTask(config, taskId) {
  executors.delete(taskId);
  try {
    fs.rmSync(taskPath(config, taskId), { force: true });
  } catch (error) {
    throw taskStoreError('delete_failed', error, taskId);
  }
}

function quarantineTaskRecord(config, taskId, nowSource) {
  const source = taskPath(config, taskId);
  if (!fs.existsSync(source)) return false;
  const directory = path.join(getStateDir(config), 'native-tasks-quarantine');
  const timestamp = new Date(nowValue(nowSource)).toISOString().replace(/[:.]/g, '-');
  const target = path.join(directory, `${taskId}.${timestamp}.json`);
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.renameSync(source, target);
    executors.delete(taskId);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw taskStoreError('quarantine_failed', error, taskId);
  }
}

function removeUnrecognizedTaskFile(directory, name) {
  try {
    fs.rmSync(path.join(directory, name), { force: true });
  } catch (error) {
    throw taskStoreError('delete_failed', error);
  }
}

function taskStoreError(reason, cause, taskId = '') {
  return new NativeTaskStoreError(reason, { cause: cause || undefined, taskId });
}

function detailedTask(task) {
  const result = {
    taskId: task.taskId,
    status: task.status,
    ...(task.statusMessage ? { statusMessage: task.statusMessage } : {}),
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: task.ttlMs,
    ...(task.pollIntervalMs == null ? {} : { pollIntervalMs: task.pollIntervalMs })
  };
  if (task.status === 'input_required') result.inputRequests = clone(task.inputRequests || {});
  if (task.status === 'completed') result.result = clone(task.result || {});
  if (task.status === 'failed') result.error = clone(task.error || normalizeJsonRpcError('Task failed.'));
  return result;
}

function validateTaskId(taskId) {
  const value = String(taskId || '').trim();
  if (!TASK_ID_PATTERN.test(value)) throw new NativeTaskUnavailableError();
  return value;
}

function principalFingerprint(principal) {
  return crypto.createHash('sha256').update(String(principal || 'anonymous')).digest('base64url');
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid native task status: ${status}`);
  return status;
}

function normalizeRestartPolicy(value) {
  const policy = String(value || 'non_resumable');
  if (!['resumable', 'restart_reconcilable', 'non_resumable'].includes(policy)) {
    throw new Error(`Invalid task restart policy: ${policy}`);
  }
  return policy;
}

function normalizeTtl(value) {
  if (value === null) return null;
  const number = value == null ? DEFAULT_TASK_TTL_MS : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Task ttlMs must be a positive safe integer or null.');
  return number;
}

function normalizePollInterval(value) {
  if (value == null) return DEFAULT_POLL_INTERVAL_MS;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Task pollIntervalMs must be a positive safe integer.');
  return number;
}

function normalizeInputMap(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeTaskRequestError('Task input map must be an object.');
  }
  return normalizeJson(value);
}

function normalizeJsonRpcError(error) {
  if (error && typeof error === 'object' && Number.isInteger(error.code) && typeof error.message === 'string') {
    return {
      code: error.code,
      message: boundedMessage(error.message),
      ...(error.data === undefined ? {} : { data: redactSensitiveJson(error.data) })
    };
  }
  return {
    code: -32603,
    message: boundedMessage(error instanceof Error ? error.message : String(error || 'Task failed.'))
  };
}

function normalizeJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function redactSensitiveJson(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveJson);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, field] of Object.entries(value)) {
    result[key] = /authorization|password|secret|token/i.test(key) ? '[redacted]' : redactSensitiveJson(field);
  }
  return result;
}

function boundedMessage(value) {
  const text = [...String(value || '')]
    .map(character => {
      const code = character.codePointAt(0);
      return code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim();
  return text.slice(0, MAX_STATUS_MESSAGE_CHARS);
}

function isExpired(task, nowSource) {
  if (task.ttlMs === null) return false;
  const createdAtMs = Date.parse(task.createdAt || '');
  return !Number.isFinite(createdAtMs) || nowValue(nowSource) >= createdAtMs + Number(task.ttlMs || 0);
}

function nowValue(source) {
  return typeof source === 'function' ? Number(source()) : Number.isFinite(source) ? Number(source) : Date.now();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TASK_TTL_MS,
  NativeTaskRequestError,
  NativeTaskStoreError,
  NativeTaskUnavailableError,
  TASK_ID_PATTERN,
  attachNativeTaskExecutor,
  cancelNativeTask,
  completeNativeTask,
  createNativeTask,
  detailedTask,
  failNativeTask,
  getNativeTask,
  getNativeTaskRecord,
  nativeTaskSignal,
  principalFingerprint,
  pruneNativeTasks,
  requestNativeTaskInput,
  updateNativeTask,
  updateNativeTaskInputs,
  updateNativeTaskRecovery,
  validateTaskId
};
