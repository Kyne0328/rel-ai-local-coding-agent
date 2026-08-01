import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getStateDir } from '../statePaths.js';
import { normalizePrincipalKey, principalFingerprint } from './principal.js';

const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const MAX_STATUS_MESSAGE_CHARS = 2000;
const MAX_TASK_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_ERROR_DATA_BYTES = 64 * 1024;
const MAX_INPUT_MAP_BYTES = 256 * 1024;
const MAX_INTERNAL_BYTES = 256 * 1024;
const MAX_INPUT_ENTRIES = 64;
const MAX_INPUT_UPDATES = 100;
const MAX_LOCK_WAIT_MS = 5000;
const STALE_LOCK_MS = 30_000;
const TASK_ID_PATTERN = /^task_[A-Za-z0-9_-]{32,160}$/;
const INPUT_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const VALID_STATUSES = new Set(['working', 'input_required', 'completed', 'failed', 'cancelled']);
const TASK_TRANSITIONS = Object.freeze({
  working: new Set(['working', 'input_required', 'completed', 'failed', 'cancelled']),
  input_required: new Set(['input_required', 'working', 'completed', 'failed', 'cancelled']),
  completed: new Set(['completed']),
  failed: new Set(['failed']),
  cancelled: new Set(['cancelled'])
});
const RUNTIME_ID = crypto.randomUUID();
const executors = new Map();
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

class NativeTaskUnavailableError extends Error {
  constructor() {
    super('Invalid task ID or task is not available to this client.');
    this.code = 'NATIVE_TASK_UNAVAILABLE';
  }
}

class NativeTaskRequestError extends Error {
  constructor(message, reason = 'invalid_request') {
    super(boundedMessage(message) || 'Invalid native task request.');
    this.code = 'NATIVE_TASK_INVALID_REQUEST';
    this.reason = String(reason || 'invalid_request');
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
  const status = normalizeStatus(options.status || 'working');
  if (!['working', 'input_required'].includes(status)) {
    throw new NativeTaskRequestError('A native task must be created in an active state.');
  }
  const inputRequests = normalizeInputRequests(options.inputRequests);
  if (status === 'input_required' && Object.keys(inputRequests).length === 0) {
    throw new NativeTaskRequestError('An input_required task must include at least one input request.');
  }
  if (options.result != null || options.error != null) {
    throw new NativeTaskRequestError('Final outcomes must be recorded through a terminal operation.');
  }
  const task = {
    schemaVersion: 1,
    revision: 0,
    taskId,
    status,
    statusMessage: boundedMessage(options.statusMessage || (status === 'input_required' ? 'Task requires client input.' : 'Task is running.')),
    createdAt,
    lastUpdatedAt: createdAt,
    ttlMs: normalizeTtl(options.ttlMs),
    pollIntervalMs: normalizePollInterval(options.pollIntervalMs),
    principalFingerprint: principalFingerprint(options.principal),
    origin: {
      method: boundedText(options.method, 200),
      name: boundedText(options.name, 300),
      logicalTaskId: boundedText(options.logicalTaskId, 200)
    },
    restartPolicy: normalizeRestartPolicy(options.restartPolicy),
    recovery: normalizeBoundedJson(options.recovery || null, MAX_INTERNAL_BYTES, 'Task recovery metadata', { redact: true }),
    inputRequests,
    inputResponses: {},
    satisfiedInputKeys: [],
    inputUpdateSequence: 0,
    inputUpdates: [],
    cancelRequested: false,
    cancellationRequestedAt: null,
    cancellationAcknowledgedAt: null,
    result: null,
    error: null,
    internal: normalizeBoundedJson(options.internal || {}, MAX_INTERNAL_BYTES, 'Task internal metadata', { redact: true })
  };
  if (options.executor) attachExecutor(taskId, options.executor);
  try {
    persistTask(config, task);
  } catch (error) {
    executors.delete(taskId);
    throw error;
  }
  return detailedTask(task);
}

function getNativeTask(config, taskId, options = {}) {
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    return detailedTask(task);
  });
}

function getNativeTaskRecord(config, taskId, options = {}) {
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    return clone(task);
  });
}

function updateNativeTask(config, taskId, patch = {}, options = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new NativeTaskRequestError('Task update patch must be an object.');
  }
  const allowed = new Set(['status', 'statusMessage', 'pollIntervalMs', 'ttlMs', 'internal']);
  const unknown = Object.keys(patch).filter(key => !allowed.has(key));
  if (unknown.length) throw new NativeTaskRequestError(`Unsupported task update field: ${unknown[0]}`);
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    assertActiveTask(task);
    if (patch.status != null) {
      const nextStatus = normalizeStatus(patch.status);
      if (TERMINAL_STATUSES.has(nextStatus)) {
        throw new NativeTaskRequestError('Terminal states require a dedicated completion, failure, or cancellation operation.');
      }
      assertTaskTransition(task.status, nextStatus);
      if (nextStatus === 'input_required' && Object.keys(task.inputRequests).length === 0) {
        throw new NativeTaskRequestError('Use requestNativeTaskInput before entering input_required.');
      }
      if (nextStatus === 'working' && Object.keys(task.inputRequests).length !== 0) {
        throw new NativeTaskRequestError('A task cannot resume while input requests remain outstanding.');
      }
      task.status = nextStatus;
    }
    if (patch.statusMessage != null) task.statusMessage = boundedMessage(patch.statusMessage);
    if (patch.pollIntervalMs != null) task.pollIntervalMs = normalizePollInterval(patch.pollIntervalMs);
    if (patch.ttlMs !== undefined) task.ttlMs = normalizeTtl(patch.ttlMs);
    if (patch.internal !== undefined) {
      if (!patch.internal || typeof patch.internal !== 'object' || Array.isArray(patch.internal)) {
        throw new NativeTaskRequestError('Task internal update must be an object.');
      }
      task.internal = normalizeBoundedJson(
        { ...task.internal, ...patch.internal },
        MAX_INTERNAL_BYTES,
        'Task internal metadata',
        { redact: true }
      );
    }
    touchTask(task, options.now);
    persistTask(config, task);
    return detailedTask(task);
  });
}

function updateNativeTaskRecovery(config, taskId, recovery, options = {}) {
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    assertActiveTask(task);
    task.recovery = normalizeBoundedJson(recovery || null, MAX_INTERNAL_BYTES, 'Task recovery metadata', { redact: true });
    touchTask(task, options.now);
    persistTask(config, task);
    return detailedTask(task);
  });
}

function completeNativeTask(config, taskId, result, options = {}) {
  let normalizedResult;
  try {
    normalizedResult = normalizeBoundedJson(result, MAX_RESULT_BYTES, 'Task result', { redact: true });
  } catch (error) {
    if (!(error instanceof NativeTaskRequestError) || error.reason !== 'payload_too_large') throw error;
    return transitionTerminal(config, taskId, 'failed', {
      error: {
        code: -32603,
        message: 'Task result exceeded the durable storage limit.',
        data: { reason: 'result_too_large', retryable: false }
      },
      statusMessage: 'Task failed because its result was too large.'
    }, options);
  }
  return transitionTerminal(config, taskId, 'completed', {
    result: normalizedResult,
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
  const next = normalizeInputRequests(inputRequests);
  if (Object.keys(next).length === 0) {
    throw new NativeTaskRequestError('At least one input request is required.');
  }
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    assertActiveTask(task);
    for (const key of Object.keys(next)) {
      if (Object.hasOwn(task.inputRequests, key) || task.satisfiedInputKeys.includes(key)) {
        throw new NativeTaskRequestError(`Input request key has already been used: ${key}`);
      }
    }
    task.inputRequests = normalizeInputRequests({ ...task.inputRequests, ...next });
    assertTaskTransition(task.status, 'input_required');
    task.status = 'input_required';
    task.statusMessage = boundedMessage(options.statusMessage || 'Task requires client input.');
    touchTask(task, options.now);
    persistTask(config, task);
    return detailedTask(task);
  });
}

function updateNativeTaskInputs(config, taskId, inputResponses, options = {}) {
  const responses = normalizeInputResponses(inputResponses);
  if (Object.keys(responses).length === 0) {
    throw new NativeTaskRequestError('Task input update must include at least one response.');
  }
  let acceptedRaw = null;
  let shouldResume = false;
  const result = withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    assertActiveTask(task);
    acceptedRaw = {};
    if (task.status !== 'input_required') {
      return detailedTask(task);
    }

    for (const [key, value] of Object.entries(responses)) {
      if (!Object.hasOwn(task.inputRequests, key)) continue;
      validateInputResponse(key, task.inputRequests[key], value);
      acceptedRaw[key] = value;
    }
    if (Object.keys(acceptedRaw).length === 0) return detailedTask(task);

    for (const [key, value] of Object.entries(acceptedRaw)) {
      task.inputResponses[key] = normalizeBoundedJson(value, MAX_INPUT_MAP_BYTES, `Input response ${key}`, { redact: true });
      task.satisfiedInputKeys.push(key);
      delete task.inputRequests[key];
    }
    task.inputUpdateSequence += 1;
    task.inputUpdates.push({
      sequence: task.inputUpdateSequence,
      acceptedKeys: Object.keys(acceptedRaw).sort(),
      receivedAt: new Date(nowValue(options.now)).toISOString()
    });
    if (task.inputUpdates.length > MAX_INPUT_UPDATES) {
      task.inputUpdates = task.inputUpdates.slice(-MAX_INPUT_UPDATES);
    }
    if (Object.keys(task.inputRequests).length === 0) {
      assertTaskTransition(task.status, 'working');
      task.status = 'working';
      task.statusMessage = boundedMessage(options.statusMessage || 'Task resumed after receiving input.');
      shouldResume = true;
    }
    touchTask(task, options.now);
    persistTask(config, task);
    return detailedTask(task);
  });
  if (acceptedRaw && Object.keys(acceptedRaw).length) rememberExecutorInputs(taskId, acceptedRaw);
  if (shouldResume) resumeExecutor(config, taskId);
  return result;
}

function cancelNativeTask(config, taskId, options = {}) {
  let shouldAbort = false;
  let canAcknowledgeImmediately = false;
  const requested = withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    reconcileTaskUnlocked(config, task, options.now);
    if (task.status === 'cancelled') return detailedTask(task);
    if (TERMINAL_STATUSES.has(task.status)) {
      throw terminalConflict(task.status, 'cancelled');
    }
    if (!task.cancelRequested) {
      task.cancelRequested = true;
      task.cancellationRequestedAt = new Date(nowValue(options.now)).toISOString();
      task.statusMessage = boundedMessage(options.statusMessage || 'Task cancellation requested.');
      touchTask(task, options.now);
      persistTask(config, task);
    }
    const executor = executors.get(task.taskId);
    shouldAbort = Boolean(executor?.controller && !executor.controller.signal.aborted);
    canAcknowledgeImmediately = !executor || options.executionStopped === true;
    return detailedTask(task);
  });
  if (shouldAbort) {
    executors.get(validateTaskId(taskId))?.controller.abort(new Error('Task cancellation requested by the client.'));
  }
  if (canAcknowledgeImmediately) {
    return acknowledgeNativeTaskCancellation(config, taskId, {
      ...options,
      statusMessage: options.cancelledStatusMessage || 'Task cancelled.'
    });
  }
  return requested;
}

function acknowledgeNativeTaskCancellation(config, taskId, options = {}) {
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    if (task.status === 'cancelled') return detailedTask(task);
    if (task.status === 'completed' || task.status === 'failed') return detailedTask(task);
    if (!task.cancelRequested) {
      throw new NativeTaskRequestError('Task cancellation has not been requested.');
    }
    assertTaskTransition(task.status, 'cancelled');
    task.status = 'cancelled';
    task.statusMessage = boundedMessage(options.statusMessage || 'Task cancelled.');
    task.cancellationAcknowledgedAt = new Date(nowValue(options.now)).toISOString();
    task.inputRequests = {};
    task.result = null;
    task.error = null;
    touchTask(task, options.now);
    persistTask(config, task);
    executors.delete(task.taskId);
    return detailedTask(task);
  });
}

function attachNativeTaskExecutor(taskId, executor = {}) {
  const id = validateTaskId(taskId);
  attachExecutor(id, executor);
  return executors.get(id)?.controller.signal;
}

function nativeTaskSignal(taskId) {
  return executors.get(validateTaskId(taskId))?.controller?.signal;
}

function pruneNativeTasks(config, options = {}) {
  const directory = taskDirectory(config);
  if (!fs.existsSync(directory)) return { removed: 0, reconciled: 0, quarantined: 0, artifactsRemoved: 0 };
  let removed = 0;
  let reconciled = 0;
  let quarantined = 0;
  let artifactsRemoved = 0;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw taskStoreError('read_failed', error);
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) {
      if (isStaleStoreArtifact(directory, entry.name, options.now)) {
        removeUnrecognizedTaskFile(directory, entry.name);
        artifactsRemoved += 1;
      }
      continue;
    }
    const taskId = entry.name.slice(0, -5);
    try {
      withTaskLock(config, taskId, () => {
        const task = readTask(config, taskId);
        if (!task) return;
        if (isExpired(task, options.now)) {
          removeTask(config, task.taskId);
          removed += 1;
          return;
        }
        const beforeStatus = task.status;
        const beforeRevision = task.revision;
        reconcileTaskUnlocked(config, task, options.now);
        if (task.status !== beforeStatus || task.revision !== beforeRevision) reconciled += 1;
      });
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
  return { removed, reconciled, quarantined, artifactsRemoved };
}

function transitionTerminal(config, taskId, status, payload, options = {}) {
  return withTaskLock(config, taskId, () => {
    const task = requireTaskUnlocked(config, taskId, options);
    if (TERMINAL_STATUSES.has(task.status)) {
      if (task.status === status && sameTerminalOutcome(task, status, payload)) return detailedTask(task);
      throw terminalConflict(task.status, status);
    }
    assertTaskTransition(task.status, status);
    task.status = status;
    task.statusMessage = boundedMessage(payload.statusMessage);
    task.inputRequests = {};
    task.result = status === 'completed' ? payload.result : null;
    task.error = status === 'failed' ? payload.error : null;
    if (status === 'cancelled') {
      task.cancelRequested = true;
      task.cancellationRequestedAt ||= new Date(nowValue(options.now)).toISOString();
      task.cancellationAcknowledgedAt = new Date(nowValue(options.now)).toISOString();
    }
    touchTask(task, options.now);
    persistTask(config, task);
    executors.delete(task.taskId);
    return detailedTask(task);
  });
}

function sameTerminalOutcome(task, status, payload) {
  if (status === 'completed') return stableJson(task.result) === stableJson(payload.result);
  if (status === 'failed') return stableJson(task.error) === stableJson(payload.error);
  return status === 'cancelled';
}

function terminalConflict(current, requested) {
  return new NativeTaskRequestError(
    `Task already reached terminal state ${current}; it cannot become ${requested}.`,
    'terminal_conflict'
  );
}

function requireTaskUnlocked(config, taskId, options = {}) {
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
  if (options.principal !== undefined && !safeEqual(task.principalFingerprint, principalFingerprint(options.principal))) {
    throw new NativeTaskUnavailableError();
  }
  if (options.logicalTaskId !== undefined) {
    const expected = String(task.origin?.logicalTaskId || '');
    const actual = String(options.logicalTaskId || '');
    if (expected && expected !== actual) throw new NativeTaskUnavailableError();
  }
  return task;
}

function reconcileTaskUnlocked(config, task, nowSource) {
  if (TERMINAL_STATUSES.has(task.status) || task.status === 'input_required') return task;
  if (executors.has(task.taskId)) return task;
  const nowMs = nowValue(nowSource);
  if (task.cancelRequested) {
    assertTaskTransition(task.status, 'cancelled');
    task.status = 'cancelled';
    task.statusMessage = 'Task cancelled after execution stopped.';
    task.cancellationAcknowledgedAt = new Date(nowMs).toISOString();
    task.inputRequests = {};
    touchTask(task, nowMs);
    persistTask(config, task);
    return task;
  }
  if (task.restartPolicy === 'restart_reconcilable' && task.recovery?.mode === 'deadline') {
    if (nowMs >= Number(task.recovery.completeAtMs || 0)) {
      try {
        task.result = normalizeBoundedJson(task.recovery.result || {}, MAX_RESULT_BYTES, 'Task result', { redact: true });
        task.error = null;
        task.status = 'completed';
        task.statusMessage = boundedMessage(task.recovery.statusMessage || 'Task completed.');
      } catch (_error) {
        task.status = 'failed';
        task.statusMessage = 'Task failed because its result was too large.';
        task.result = null;
        task.error = {
          code: -32603,
          message: 'Task result exceeded the durable storage limit.',
          data: { reason: 'result_too_large', retryable: false }
        };
      }
      task.inputRequests = {};
      touchTask(task, nowMs);
      persistTask(config, task);
    }
    return task;
  }
  if (task.restartPolicy === 'resumable' && task.recovery?.leaseOwner === RUNTIME_ID) return task;
  task.status = 'failed';
  task.statusMessage = 'Task execution was interrupted and must be retried.';
  task.result = null;
  task.error = {
    code: -32603,
    message: 'Task execution was interrupted by a server restart.',
    data: { retryable: true, reason: 'executor_interrupted' }
  };
  task.inputRequests = {};
  touchTask(task, nowMs);
  persistTask(config, task);
  return task;
}

function rememberExecutorInputs(taskId, responses) {
  const executor = executors.get(validateTaskId(taskId));
  if (!executor) return;
  executor.rawInputResponses = { ...executor.rawInputResponses, ...clone(responses) };
}

function resumeExecutor(config, taskId) {
  const executor = executors.get(validateTaskId(taskId));
  if (!executor?.resume || executor.resumeInFlight || executor.controller.signal.aborted) return;
  executor.resumeInFlight = true;
  const persisted = getNativeTaskRecord(config, taskId).inputResponses || {};
  const responses = { ...persisted, ...executor.rawInputResponses };
  queueMicrotask(async () => {
    try {
      await executor.resume(clone(responses));
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
    resumeInFlight: false,
    rawInputResponses: {}
  });
}

function withTaskLock(config, taskId, operation) {
  const id = validateTaskId(taskId);
  const directory = taskDirectory(config);
  const lockPath = path.join(directory, `${id}.lock`);
  const deadline = Date.now() + MAX_LOCK_WAIT_MS;
  let descriptor = null;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    while (descriptor == null) {
      try {
        descriptor = fs.openSync(lockPath, 'wx', 0o600);
        fs.writeFileSync(descriptor, `${process.pid}:${RUNTIME_ID}\n`);
        fs.fsyncSync(descriptor);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        removeStaleLock(lockPath);
        if (Date.now() >= deadline) throw taskStoreError('lock_timeout', error, id);
        Atomics.wait(sleepArray, 0, 0, 10);
      }
    }
    return operation();
  } catch (error) {
    if (error?.code === 'NATIVE_TASK_STORE_ERROR' || error?.code === 'NATIVE_TASK_UNAVAILABLE' || error?.code === 'NATIVE_TASK_INVALID_REQUEST') {
      throw error;
    }
    throw taskStoreError('lock_failed', error, id);
  } finally {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.rmSync(lockPath, { force: true }); } catch {}
    }
  }
}

function removeStaleLock(lockPath) {
  try {
    const stats = fs.statSync(lockPath);
    if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) fs.rmSync(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
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
    return normalizeStoredTask(parsed, taskId);
  } catch (error) {
    if (error?.code === 'NATIVE_TASK_STORE_ERROR') throw error;
    throw taskStoreError('record_corrupt', error, taskId);
  }
}

function normalizeStoredTask(parsed, taskId) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schemaVersion !== 1 || parsed.taskId !== taskId) {
    throw taskStoreError('record_corrupt', null, taskId);
  }
  const status = normalizeStatus(parsed.status);
  if (!Number.isFinite(Date.parse(parsed.createdAt || '')) || !Number.isFinite(Date.parse(parsed.lastUpdatedAt || ''))) {
    throw taskStoreError('record_corrupt', null, taskId);
  }
  const fingerprint = String(parsed.principalFingerprint || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(fingerprint)) throw taskStoreError('record_corrupt', null, taskId);
  const inputRequests = normalizeInputRequests(parsed.inputRequests || {});
  const inputResponses = normalizeInputResponses(parsed.inputResponses || {});
  const satisfiedInputKeys = Array.isArray(parsed.satisfiedInputKeys)
    ? [...new Set(parsed.satisfiedInputKeys.map(key => validateInputKey(key)))].slice(0, MAX_INPUT_ENTRIES)
    : [];
  const inputUpdates = Array.isArray(parsed.inputUpdates)
    ? parsed.inputUpdates.slice(-MAX_INPUT_UPDATES).map((entry, index) => normalizeInputUpdate(entry, index + 1))
    : [];
  if (status === 'input_required' && Object.keys(inputRequests).length === 0) {
    throw taskStoreError('record_corrupt', null, taskId);
  }
  return {
    schemaVersion: 1,
    revision: normalizeRevision(parsed.revision),
    taskId,
    status,
    statusMessage: boundedMessage(parsed.statusMessage),
    createdAt: new Date(parsed.createdAt).toISOString(),
    lastUpdatedAt: new Date(parsed.lastUpdatedAt).toISOString(),
    ttlMs: normalizeTtl(parsed.ttlMs),
    pollIntervalMs: normalizePollInterval(parsed.pollIntervalMs),
    principalFingerprint: fingerprint,
    origin: {
      method: boundedText(parsed.origin?.method, 200),
      name: boundedText(parsed.origin?.name, 300),
      logicalTaskId: boundedText(parsed.origin?.logicalTaskId, 200)
    },
    restartPolicy: normalizeRestartPolicy(parsed.restartPolicy),
    recovery: normalizeBoundedJson(parsed.recovery || null, MAX_INTERNAL_BYTES, 'Task recovery metadata', { redact: true }),
    inputRequests,
    inputResponses,
    satisfiedInputKeys,
    inputUpdateSequence: Math.max(normalizeRevision(parsed.inputUpdateSequence), inputUpdates.at(-1)?.sequence || 0),
    inputUpdates,
    cancelRequested: parsed.cancelRequested === true,
    cancellationRequestedAt: normalizeOptionalTimestamp(parsed.cancellationRequestedAt),
    cancellationAcknowledgedAt: normalizeOptionalTimestamp(parsed.cancellationAcknowledgedAt),
    result: status === 'completed'
      ? normalizeBoundedJson(parsed.result || {}, MAX_RESULT_BYTES, 'Task result', { redact: true })
      : null,
    error: status === 'failed' ? normalizeJsonRpcError(parsed.error || 'Task failed.') : null,
    internal: normalizeBoundedJson(parsed.internal || {}, MAX_INTERNAL_BYTES, 'Task internal metadata', { redact: true })
  };
}

function persistTask(config, task) {
  const directory = taskDirectory(config);
  const target = taskPath(config, task.taskId);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  task.revision = normalizeRevision(task.revision) + 1;
  const serialized = `${JSON.stringify(task, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TASK_RECORD_BYTES) {
    task.revision -= 1;
    throw new NativeTaskRequestError('Native task record exceeds the durable storage limit.', 'payload_too_large');
  }
  let descriptor = null;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
    syncDirectory(directory);
  } catch (error) {
    task.revision -= 1;
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.rmSync(temporary, { force: true }); } catch {}
    if (error?.code === 'NATIVE_TASK_INVALID_REQUEST') throw error;
    throw taskStoreError('write_failed', error, task.taskId);
  }
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error;
  } finally {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch {}
    }
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

function isStaleStoreArtifact(directory, name, nowSource) {
  if (!/\.(?:tmp|lock)$/.test(name)) return false;
  try {
    const stats = fs.statSync(path.join(directory, name));
    return nowValue(nowSource) - stats.mtimeMs > STALE_LOCK_MS;
  } catch (error) {
    return error?.code === 'ENOENT';
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

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (!VALID_STATUSES.has(status)) throw new NativeTaskRequestError(`Invalid native task status: ${status}`);
  return status;
}

function assertTaskTransition(current, next) {
  const from = normalizeStatus(current);
  const to = normalizeStatus(next);
  if (!TASK_TRANSITIONS[from]?.has(to)) {
    throw new NativeTaskRequestError(`Invalid native task transition: ${from} -> ${to}`, 'invalid_transition');
  }
  return to;
}

function assertActiveTask(task) {
  if (TERMINAL_STATUSES.has(task.status)) throw terminalConflict(task.status, task.status);
}

function normalizeRestartPolicy(value) {
  const policy = String(value || 'non_resumable');
  if (!['resumable', 'restart_reconcilable', 'non_resumable'].includes(policy)) {
    throw new NativeTaskRequestError(`Invalid task restart policy: ${policy}`);
  }
  return policy;
}

function normalizeTtl(value) {
  if (value === null) return null;
  const number = value == null ? DEFAULT_TASK_TTL_MS : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new NativeTaskRequestError('Task ttlMs must be a positive safe integer or null.');
  }
  return number;
}

function normalizePollInterval(value) {
  if (value == null) return DEFAULT_POLL_INTERVAL_MS;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new NativeTaskRequestError('Task pollIntervalMs must be a positive safe integer.');
  }
  return number;
}

function normalizeRevision(value) {
  const number = Number(value || 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new NativeTaskRequestError('Task revision is invalid.');
  return number;
}

function normalizeInputRequests(value) {
  const entries = normalizeInputObject(value, 'Task input requests');
  const result = {};
  for (const [key, descriptor] of Object.entries(entries)) {
    validateInputKey(key);
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new NativeTaskRequestError(`Input request ${key} must be an object.`);
    }
    result[key] = sanitizeInputRequest(descriptor);
  }
  return normalizeBoundedJson(result, MAX_INPUT_MAP_BYTES, 'Task input requests');
}

function sanitizeInputRequest(descriptor) {
  const cloned = normalizeBoundedJson(descriptor, MAX_INPUT_MAP_BYTES, 'Task input request');
  const result = {};
  for (const [key, value] of Object.entries(cloned)) {
    result[key] = key === 'schema' || key === 'responseSchema'
      ? value
      : redactSensitiveJson(value, key);
  }
  return result;
}

function normalizeInputResponses(value) {
  const entries = normalizeInputObject(value, 'Task input responses');
  const result = {};
  for (const [key, response] of Object.entries(entries)) {
    validateInputKey(key);
    result[key] = normalizeBoundedJson(response, MAX_INPUT_MAP_BYTES, `Input response ${key}`);
  }
  return normalizeBoundedJson(result, MAX_INPUT_MAP_BYTES, 'Task input responses');
}

function normalizeInputObject(value, label) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeTaskRequestError('Task input map must be an object.');
  }
  if (Object.keys(value).length > MAX_INPUT_ENTRIES) {
    throw new NativeTaskRequestError(`${label} contains too many entries.`, 'payload_too_large');
  }
  return value;
}

function validateInputKey(value) {
  const key = String(value || '');
  if (!INPUT_KEY_PATTERN.test(key)) throw new NativeTaskRequestError('Task input key is invalid.');
  return key;
}

function normalizeInputUpdate(entry, fallbackSequence) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new NativeTaskRequestError('Task input update audit entry is invalid.');
  }
  const sequence = normalizeRevision(entry.sequence || fallbackSequence);
  const acceptedKeys = Array.isArray(entry.acceptedKeys)
    ? [...new Set(entry.acceptedKeys.map(validateInputKey))].sort().slice(0, MAX_INPUT_ENTRIES)
    : [];
  const receivedAt = normalizeOptionalTimestamp(entry.receivedAt);
  if (!receivedAt) throw new NativeTaskRequestError('Task input update timestamp is invalid.');
  return { sequence, acceptedKeys, receivedAt };
}

function validateInputResponse(key, request, value) {
  const schema = request?.responseSchema ?? request?.schema;
  if (schema === undefined) return;
  validateJsonSchemaValue(value, schema, `Input response ${key}`, 0);
}

function validateJsonSchemaValue(value, schema, label, depth) {
  if (depth > 12) throw new NativeTaskRequestError(`${label} schema is too deeply nested.`);
  if (schema === true || schema == null) return;
  if (schema === false) throw new NativeTaskRequestError(`${label} is not accepted by its schema.`);
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    throw new NativeTaskRequestError(`${label} schema must be an object or boolean.`);
  }
  if (Object.hasOwn(schema, 'const') && stableJson(value) !== stableJson(schema.const)) {
    throw new NativeTaskRequestError(`${label} does not match the required constant.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => stableJson(candidate) === stableJson(value))) {
    throw new NativeTaskRequestError(`${label} is not one of the allowed values.`);
  }
  if (schema.type != null) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowedTypes.some(type => matchesJsonType(value, type))) {
      throw new NativeTaskRequestError(`${label} must have type ${allowedTypes.join(' or ')}.`);
    }
  }
  if (typeof value === 'string') {
    if (Number.isSafeInteger(schema.minLength) && [...value].length < schema.minLength) {
      throw new NativeTaskRequestError(`${label} is shorter than allowed.`);
    }
    if (Number.isSafeInteger(schema.maxLength) && [...value].length > schema.maxLength) {
      throw new NativeTaskRequestError(`${label} is longer than allowed.`);
    }
    if (typeof schema.pattern === 'string') {
      let expression;
      try { expression = new RegExp(schema.pattern, 'u'); } catch { throw new NativeTaskRequestError(`${label} schema pattern is invalid.`); }
      if (!expression.test(value)) throw new NativeTaskRequestError(`${label} does not match the required pattern.`);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) throw new NativeTaskRequestError(`${label} is below the minimum.`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) throw new NativeTaskRequestError(`${label} is above the maximum.`);
  }
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => validateJsonSchemaValue(item, schema.items, `${label}[${index}]`, depth + 1));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const requiredKey of required) {
      if (!Object.hasOwn(value, requiredKey)) throw new NativeTaskRequestError(`${label} is missing required field ${requiredKey}.`);
    }
    const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? schema.properties
      : {};
    for (const [property, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, property)) {
        validateJsonSchemaValue(value[property], propertySchema, `${label}.${property}`, depth + 1);
      }
    }
    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find(property => !Object.hasOwn(properties, property));
      if (unknown) throw new NativeTaskRequestError(`${label} contains unsupported field ${unknown}.`);
    }
  }
}

function matchesJsonType(value, type) {
  switch (String(type)) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'object': return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isSafeInteger(value);
    case 'string': return typeof value === 'string';
    default: throw new NativeTaskRequestError(`Unsupported input schema type: ${type}`);
  }
}

function normalizeJsonRpcError(error) {
  if (error && typeof error === 'object' && Number.isInteger(error.code) && typeof error.message === 'string') {
    return normalizeBoundedJson({
      code: error.code,
      message: sanitizeErrorMessage(error.message),
      ...(error.data === undefined ? {} : {
        data: normalizeBoundedJson(error.data, MAX_ERROR_DATA_BYTES, 'Task error data', { redact: true })
      })
    }, MAX_ERROR_DATA_BYTES + MAX_STATUS_MESSAGE_CHARS, 'Task error', { redact: true });
  }
  return {
    code: -32603,
    message: error instanceof Error ? 'Task execution failed.' : sanitizeErrorMessage(String(error || 'Task failed.'))
  };
}

function normalizeBoundedJson(value, maxBytes, label, options = {}) {
  let serialized;
  try {
    serialized = JSON.stringify(value === undefined ? null : value);
  } catch {
    throw new NativeTaskRequestError(`${label} must be JSON-serializable.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new NativeTaskRequestError(`${label} exceeds the storage limit.`, 'payload_too_large');
  }
  const parsed = JSON.parse(serialized);
  const normalized = options.redact ? redactSensitiveJson(parsed) : parsed;
  const normalizedBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (normalizedBytes > maxBytes) throw new NativeTaskRequestError(`${label} exceeds the storage limit.`, 'payload_too_large');
  return normalized;
}

function redactSensitiveJson(value, keyHint = '') {
  if (/authorization|cookie|password|passphrase|private.?key|secret|token/i.test(keyHint)) return '[redacted]';
  if (Array.isArray(value)) return value.map(item => redactSensitiveJson(item));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, field] of Object.entries(value)) result[key] = redactSensitiveJson(field, key);
  return result;
}

function sanitizeErrorMessage(value) {
  return boundedMessage(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, match => `${match.split(/[:=]/, 1)[0]}=[redacted]`)
    .replace(/[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s]*/g, '[path]')
    .replace(/\/(?:home|Users)\/[^\s]+/g, '[path]');
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

function boundedText(value, maxChars) {
  return boundedMessage(value).slice(0, maxChars);
}

function normalizeOptionalTimestamp(value) {
  if (value == null || value === '') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new NativeTaskRequestError('Task timestamp is invalid.');
  return new Date(timestamp).toISOString();
}

function touchTask(task, nowSource) {
  task.lastUpdatedAt = new Date(nowValue(nowSource)).toISOString();
}

function isExpired(task, nowSource) {
  if (task.ttlMs === null) return false;
  const createdAtMs = Date.parse(task.createdAt || '');
  return !Number.isFinite(createdAtMs) || nowValue(nowSource) >= createdAtMs + Number(task.ttlMs || 0);
}

function nowValue(source) {
  return typeof source === 'function' ? Number(source()) : Number.isFinite(source) ? Number(source) : Date.now();
}

function stableJson(value) {
  return JSON.stringify(canonicalJson(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalJson(value[key]);
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TASK_TTL_MS,
  MAX_RESULT_BYTES,
  NativeTaskRequestError,
  NativeTaskStoreError,
  NativeTaskUnavailableError,
  TASK_ID_PATTERN,
  TASK_TRANSITIONS,
  acknowledgeNativeTaskCancellation,
  assertTaskTransition,
  attachNativeTaskExecutor,
  cancelNativeTask,
  completeNativeTask,
  createNativeTask,
  detailedTask,
  failNativeTask,
  getNativeTask,
  getNativeTaskRecord,
  nativeTaskSignal,
  normalizePrincipalKey,
  principalFingerprint,
  pruneNativeTasks,
  requestNativeTaskInput,
  updateNativeTask,
  updateNativeTaskInputs,
  updateNativeTaskRecovery,
  validateTaskId
};
