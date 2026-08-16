
import { DEFAULT_TASK_IDLE_MS } from './toolActivity.js';
import { completeProgress, normalizeTaskProgress, sanitizeActivityEventRecord, sanitizeDisplayText, sanitizeTaskRecord, sanitizeTaskRecordForProjection } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';
import { canonicalTaskSnapshot, mergeTaskLifecycleSnapshots, reduceTaskLifecycleAuditEvent } from './taskLifecycle.js';
import { clamp, cleanTaskId, eventIdentityKey, eventTime, eventTimestampMs, isCurrentTaskEvent, timestampMs } from './taskEvents.js';
import { MAX_SESSIONS, clearTaskHistory as clearStoredTaskHistory, ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, readSession, writeSession, writeSessionAsync } from './taskHistoryStorage.js';
import { OPERATION_IDS as OP } from './tools/operationIds.js';
const STORE_VERSION = 3;
const MAX_SESSION_EVENTS = 200;
const TASK_HISTORY_FLUSH_MS = 75;
const TASK_HISTORY_PRUNE_DELAY_MS = 1500;
const TASK_HISTORY_RETRY_BASE_MS = 1000;
const TASK_HISTORY_RETRY_MAX_MS = 15_000;
const pendingSessions = new Map();
const pendingPrunes = new Map();
const volatileWorkflowEvidence = new Map();
const MAX_VOLATILE_TASKS = 200;
let activityPersistenceBound = false;
let taskHistoryPersistenceState = { lastError: '', lastFailureAt: null, retryCount: 0 };

function recordTaskHistoryEvent(config, event) {
  if (!isCurrentTaskEvent(event)) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const taskId = cleanTaskId(event.taskId);
  const session = reduceTaskLifecycleAuditEvent(readWorkingSession(directory, taskId) || emptySession(taskId), event);
  persistSession(directory, session);
  return publicSession(session);
}

function bindTaskHistoryActivityPersistence(onActivity, getConfig) {
  if (activityPersistenceBound || typeof onActivity !== 'function' || typeof getConfig !== 'function') return;
  activityPersistenceBound = true;
  onActivity((activity) => {
    if (activity?.phase === 'progress') return;
    try {
      recordTaskActivityEvent(getConfig(), activity, { defer: true });
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] live task history stage:', error);
    }
  });
}

function recordTaskActivityEvent(config, activity = {}, options = {}) {
  const task = activity.task && typeof activity.task === 'object' ? activity.task : null;
  const taskId = cleanTaskId(task?.taskId || task?.id || activity.taskId);
  if (!taskId) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const existing = readWorkingSession(directory, taskId) || emptySession(taskId);
  const event = activity.activityEvent || null;
  const live = canonicalTaskSnapshot({
    ...task,
    id: taskId,
    taskId,
    sessionId: task?.sessionId || taskId,
    workspace: task?.workspace || activity.workspace || existing.workspace || '',
    lastTool: task?.lastTool || task?.tool || activity.tool || existing.lastTool || '',
    operation: task?.operation || task?.lastOperation || activity.operation || existing.operation || '',
    currentActivity: task?.currentActivity || event?.summary || existing.currentActivity || '',
    events: upsertActivityEvent(existing.events || [], event)
  });
  const session = mergeTaskLifecycleSnapshots(existing, live);
  persistSession(directory, session, options);
  return publicSession(session);
}

function recordWorkflowEvidence(config, taskId, receipt, options = {}) {
  const recorded = recordWorkflowEvidenceBatch(config, taskId, [receipt], options);
  return recorded.length ? receipt : null;
}

function recordWorkflowEvidenceBatch(config, taskId, receipts, options = {}) {
  const id = cleanTaskId(taskId);
  const validReceipts = (Array.isArray(receipts) ? receipts : [])
    .filter(receipt => receipt && typeof receipt === 'object');
  if (!id || !validReceipts.length) return [];
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const session = readWorkingSession(directory, id);
  if (!session) return [];
  const evidence = [...(Array.isArray(session.workflowEvidence) ? session.workflowEvidence : []), ...validReceipts].slice(-100);
  const next = { ...session, workflowEvidence: evidence };
  persistSession(directory, next, options);
  return validReceipts;
}

function recordVolatileWorkflowEvidence(taskId, receipt) {
  const id = cleanTaskId(taskId);
  if (!id || !receipt || typeof receipt !== 'object') return null;
  const evidence = [...(volatileWorkflowEvidence.get(id) || []), receipt].slice(-100);
  volatileWorkflowEvidence.delete(id);
  volatileWorkflowEvidence.set(id, evidence);
  while (volatileWorkflowEvidence.size > MAX_VOLATILE_TASKS) {
    volatileWorkflowEvidence.delete(volatileWorkflowEvidence.keys().next().value);
  }
  return receipt;
}

function recordWorkflowState(config, taskId, { receipt = null, workflow = null } = {}, options = {}) {
  const id = cleanTaskId(taskId);
  if (!id || (!receipt && !workflow)) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const session = readWorkingSession(directory, id);
  if (!session) return null;
  const next = { ...session };
  if (receipt && typeof receipt === 'object') next.workflowEvidence = [...(Array.isArray(session.workflowEvidence) ? session.workflowEvidence : []), receipt].slice(-100);
  if (workflow && typeof workflow === 'object') next.workflow = JSON.parse(JSON.stringify(workflow));
  persistSession(directory, next, options);
  return workflow || receipt;
}

function readRecentWorkflowEvidence(config, taskId, limit = 50) {
  const id = cleanTaskId(taskId);
  if (!id) return [];
  try {
    ensureCurrentHistory(config);
    const session = readWorkingSession(getTaskHistoryDir(config), id);
    const durableEvidence = Array.isArray(session?.workflowEvidence) ? session.workflowEvidence : [];
    const volatileEvidence = volatileWorkflowEvidence.get(id) || [];
    return [...durableEvidence, ...volatileEvidence]
      .slice(-clamp(limit, 1, 100))
      .map(item => ({ ...item }));
  } catch {
    return [];
  }
}

function recordTaskRecoveryState(config, taskId, recovery = null) {
  const id = cleanTaskId(taskId);
  if (!id) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const session = readWorkingSession(directory, id);
  if (!session) return null;

  if (!recovery) {
    if (!session.sandboxRecovery) return publicSession(session);
    const previousMessage = String(session.sandboxRecovery?.message || '');
    const next = { ...session };
    delete next.sandboxRecovery;
    if (String(next.errorSummary || '') === previousMessage) next.errorSummary = '';
    if (!isTerminalTaskStatus(next.status) && next.status === 'blocked' && next.resumeStatus === 'blocked') {
      next.status = 'planning';
      next.resumeStatus = 'planning';
      next.currentStage = 'Planning';
      next.currentActivity = 'Private task conflict resolved.';
    }
    persistSession(directory, canonicalTaskSnapshot(next));
    return publicSession(next);
  }

  const at = Number.isFinite(Date.parse(String(recovery.at || '')))
    ? new Date(Date.parse(String(recovery.at))).toISOString()
    : new Date().toISOString();
  const recoveryChangedFiles = [...new Set((Array.isArray(recovery.changedFiles) ? recovery.changedFiles : [])
    .map(value => String(value || '').trim().replaceAll('\\', '/'))
    .filter(Boolean))].slice(0, 100);
  const changedFiles = [...new Set([
    ...(Array.isArray(session.changedFiles) ? session.changedFiles : []),
    ...recoveryChangedFiles
  ].map(value => String(value || '').trim().replaceAll('\\', '/')).filter(Boolean))].slice(0, 200);
  const message = sanitizeDisplayText(
    recovery.message || 'Private task changes conflict with newer visible workspace changes.',
    500
  );
  const sandboxRecovery = {
    state: 'conflict',
    code: sanitizeDisplayText(recovery.code || 'TASK_SANDBOX_PROMOTION_CONFLICT', 120),
    message,
    changedFiles: recoveryChangedFiles,
    at
  };
  const terminal = isTerminalTaskStatus(session.status);
  const next = canonicalTaskSnapshot({
    ...session,
    ...(terminal ? {} : {
      status: 'blocked',
      state: 'waiting',
      resumeStatus: 'blocked',
      currentStage: 'Conflict resolution required',
      currentActivity: message,
      activeCalls: 0,
      currentOperations: [],
      inactiveAt: null,
      endedAt: null,
      completedAt: null,
      cancelledAt: null
    }),
    repairable: true,
    errorSummary: message,
    sandboxRecovery,
    changedFiles,
    changedFileCount: changedFiles.length,
    updatedAt: at,
    lastActivityAt: at
  });
  persistSession(directory, next);
  return publicSession(next);
}

function readTaskHistorySession(config, taskId) {
  const session = readTaskHistorySessionRecord(config, taskId);
  return session ? publicSession(session) : null;
}

function readTaskHistorySessionRecord(config, taskId, options = {}) {
  const id = cleanTaskId(taskId);
  if (!id) return null;
  try {
    ensureCurrentHistory(config);
    const directory = getTaskHistoryDir(config);
    const session = readWorkingSession(directory, id);
    if (!session) return null;
    const activeIds = options.activeTaskIds instanceof Set
      ? options.activeTaskIds
      : new Set(Array.isArray(options.activeTaskIds) ? options.activeTaskIds.map(String) : []);
    const reconciled = options.reconcileInactive === true
      ? reconcileInactiveStoredSession(session, activeIds)
      : session;
    if (reconciled !== session) persistSession(directory, reconciled, { defer: true });
    return sanitizeTaskRecord(reconciled);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task history session read:', error);
    return null;
  }
}

function readTaskHistory(config, activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, MAX_SESSIONS);
  const active = (Array.isArray(activity?.tasks) ? activity.tasks : [])
    .map(canonicalTaskSnapshot)
    .slice(0, MAX_SESSIONS);
  const activeIds = new Set(active.filter(session => session.status !== 'inactive').map(session => session.id).filter(Boolean));
  const directory = getTaskHistoryDir(config);
  let persisted = [];
  try {
    ensureCurrentHistory(config);
    persisted = listSessions(directory, MAX_SESSIONS).map(session => {
      const current = readPendingSession(directory, session.id) || session;
      const reconciled = reconcileInactiveStoredSession(current, activeIds);
      if (reconciled !== current) persistSession(directory, reconciled, { defer: true });
      return reconciled;
    });
    const persistedIds = new Set(persisted.map(session => session.id));
    for (const session of pendingSessionsForDirectory(directory)) {
      if (!persistedIds.has(session.id)) persisted.push(session);
    }
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session history read:', error);
  }
  const byId = new Map(persisted.map(session => [session.id, session]));
  for (const task of active) {
    const existing = byId.get(task.id);
    if (existing && task.status === 'inactive') continue;
    byId.set(task.id, existing ? mergeTaskLifecycleSnapshots(existing, task) : task);
  }
  return [...byId.values()]
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, limit)
    .map(publicSession);
}

function hasExplicitCompletionEvidence(session = {}) {
  if (session.completionKnown === true || String(session.endReason || '') === 'explicit_completion') return true;
  return (Array.isArray(session.events) ? session.events : []).some(event => {
    if (event?.completionKnown === true || String(event?.endReason || '') === 'explicit_completion') return true;
    return event?.tool === OP.WORK_FINISH && event?.ok !== false && !['failed', 'cancelled'].includes(String(event?.status || '').toLowerCase());
  });
}

function recoverCompletedSession(session, options = {}) {
  const completedMs = storedSessionActivityMs(session) || timestampMs(session?.updatedAt) || Date.now();
  const completedAt = new Date(completedMs).toISOString();
  return {
    ...session,
    state: 'ended',
    status: 'completed',
    completionKnown: true,
    endReason: String(session.endReason || '') || options.endReason || 'explicit_completion',
    completionSource: String(session.completionSource || '') || options.completionSource || '',
    progress: completeProgress(session.progress?.label || 'Complete'),
    currentStage: 'Completed',
    activeCalls: 0,
    currentOperations: [],
    inactiveAt: null,
    endedAt: session.endedAt || completedAt,
    completedAt: session.completedAt || completedAt,
    updatedAt: session.updatedAt || completedAt
  };
}

function reconcileInactiveStoredSession(session, activeIds, timestamp = Date.now()) {
  if (!session?.id || activeIds.has(session.id)) return session;
  if (!isTerminalTaskStatus(session.status) && hasExplicitCompletionEvidence(session)) {
    return recoverCompletedSession(session, { endReason: 'explicit_completion', completionSource: session.completionSource || 'relai_work:finish' });
  }
  if (isTerminalTaskStatus(session.status) || session.status === 'inactive') return session;
  const lastActivityMs = storedSessionActivityMs(session);
  if (!lastActivityMs || timestamp - lastActivityMs < DEFAULT_TASK_IDLE_MS) return session;
  const inactiveMs = lastActivityMs + DEFAULT_TASK_IDLE_MS;
  const inactiveAt = new Date(inactiveMs).toISOString();
  return {
    ...session,
    state: 'inactive',
    status: 'inactive',
    resumeStatus: session.resumeStatus || session.status,
    progress: normalizeTaskProgress(session.progress || { mode: 'indeterminate', label: 'Ready to resume' }, 'inactive'),
    currentStage: 'Inactive',
    completionKnown: false,
    endReason: '',
    terminalReason: '',
    activeCalls: 0,
    currentOperations: [],
    updatedAt: inactiveAt,
    inactiveAt,
    lastActivityAt: lastActivityMs,
    endedAt: null,
    completedAt: null,
    cancelledAt: null
  };
}

function storedSessionActivityMs(session) {
  const eventTimes = Array.isArray(session?.events)
    ? session.events.flatMap(event => [
        timestampMs(event?.completedAt),
        timestampMs(event?.timestamp),
        timestampMs(event?.ts),
        timestampMs(event?.startedAt)
      ])
    : [];
  return Math.max(
    0,
    timestampMs(session?.lastActivityAt),
    timestampMs(session?.updatedAt),
    timestampMs(session?.endedAt),
    timestampMs(session?.completedAt),
    ...eventTimes
  );
}

function upsertActivityEvent(events, event) {
  if (!event?.eventId) return [...events].slice(-MAX_SESSION_EVENTS);
  const next = [...events];
  const eventId = eventIdentityKey(event);
  const index = next.findIndex(item => eventIdentityKey(item) === eventId);
  const sanitized = sanitizeActivityEventRecord(event);
  if (index >= 0) next[index] = { ...next[index], ...sanitized };
  else next.push(sanitized);
  return next.sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0) || eventTimestampMs(left) - eventTimestampMs(right)).slice(-MAX_SESSION_EVENTS);
}

function historicalTitle(session) {
  const operation = String(session?.operation || '').trim();
  if (operation && !/^(task|request|tool call|mcp operation)$/i.test(operation)) return operation;
  const workspace = String(session?.workspace || '').trim();
  return workspace ? `Historical task in ${workspace}` : 'Historical Rel.AI task';
}

function publicSession(session) {
  if (!session || typeof session !== 'object') return session;
  const { version, principalFingerprint, ...value } = sanitizeTaskRecordForProjection(session);
  const terminal = isTerminalTaskStatus(value.status);
  const publicStatus = !terminal && value.sandboxRecovery?.state === 'conflict' ? 'blocked' : value.status;
  return {
    ...value,
    status: publicStatus,
    taskId: value.taskId || value.id,
    sessionId: value.sessionId || value.id,
    title: value.title || historicalTitle(value),
    progress: value.progress || (value.status === 'completed' ? completeProgress() : { mode: 'indeterminate', label: 'Progress unavailable' }),
    toolCallCount: Number(value.toolCallCount ?? value.calls ?? 0),
    successfulToolCallCount: Number(value.successfulToolCallCount ?? Math.max(0, Number(value.calls || 0) - Number(value.failures || 0))),
    failedToolCallCount: Number(value.failedToolCallCount ?? value.failures ?? 0),
    activeCalls: terminal || publicStatus === 'inactive' || publicStatus === 'blocked' ? 0 : Number(value.activeCalls || 0),
    currentOperations: terminal || publicStatus === 'inactive' || publicStatus === 'blocked' ? [] : Array.isArray(value.currentOperations) ? value.currentOperations : [],
    currentStage: value.currentStage || '',
    currentActivity: value.currentActivity || value.operation || ''
  };
}

function pendingSessionKey(directory, id) {
  return `${directory}\u0000${id}`;
}

function readPendingSession(directory, id) {
  return pendingSessions.get(pendingSessionKey(directory, id))?.session || null;
}

function readWorkingSession(directory, id) {
  return readPendingSession(directory, id) || readSession(directory, id);
}

function pendingSessionsForDirectory(directory) {
  const prefix = `${directory}\u0000`;
  return [...pendingSessions.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, entry]) => entry.session)
    .filter(Boolean);
}

function persistSession(directory, session, options = {}) {
  if (!session?.id) return;
  const key = pendingSessionKey(directory, session.id);
  if (options.defer !== true) {
    const pending = pendingSessions.get(key);
    if (pending?.timer) clearTimeout(pending.timer);
    if (pending?.writing) {
      pending.session = session;
      pending.version += 1;
      return;
    }
    pendingSessions.delete(key);
    try {
      writeSession(directory, session);
      recordTaskHistoryPersistenceSuccess();
    } catch (error) {
      recordTaskHistoryPersistenceFailure(error, 1);
      throw error;
    }
    scheduleTaskHistoryPrune(directory);
    return;
  }

  let pending = pendingSessions.get(key);
  if (!pending) {
    pending = { directory, session, timer: null, writing: false, version: 0, persistedVersion: 0, retryCount: 0, promise: Promise.resolve(true) };
    pendingSessions.set(key, pending);
  }
  pending.session = session;
  pending.version += 1;
  schedulePendingSessionFlush(key, pending);
}

function schedulePendingSessionFlush(key, pending, delay = TASK_HISTORY_FLUSH_MS) {
  if (pending.timer || pending.writing) return;
  pending.timer = setTimeout(() => {
    pending.timer = null;
    void flushPendingSession(key, pending);
  }, delay);
  pending.timer.unref?.();
}

async function flushPendingSession(key, pending) {
  if (pending.writing) return pending.promise;
  pending.writing = true;
  const version = pending.version;
  const snapshot = pending.session;
  let succeeded = false;
  let failure = null;
  pending.promise = writeSessionAsync(pending.directory, snapshot)
    .then(() => {
      succeeded = true;
      return true;
    })
    .catch(error => {
      failure = error;
      return false;
    })
    .finally(() => {
      pending.writing = false;
      if (!succeeded) {
        pending.retryCount += 1;
        recordTaskHistoryPersistenceFailure(failure, pending.retryCount);
        const retryDelay = Math.min(TASK_HISTORY_RETRY_MAX_MS, TASK_HISTORY_RETRY_BASE_MS * (2 ** Math.min(pending.retryCount - 1, 4)));
        schedulePendingSessionFlush(key, pending, retryDelay);
        if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] deferred task history write:', failure);
        return;
      }
      pending.retryCount = 0;
      pending.persistedVersion = version;
      scheduleTaskHistoryPrune(pending.directory);
      if (pending.version > version) schedulePendingSessionFlush(key, pending, 0);
      else pendingSessions.delete(key);
      recordTaskHistoryPersistenceSuccess();
    });
  return pending.promise;
}

function scheduleTaskHistoryPrune(directory) {
  if (pendingPrunes.has(directory)) return;
  const timer = setTimeout(() => {
    pendingPrunes.delete(directory);
    try { pruneSessions(directory, MAX_SESSIONS); }
    catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task history prune:', error); }
  }, TASK_HISTORY_PRUNE_DELAY_MS);
  timer.unref?.();
  pendingPrunes.set(directory, timer);
}

async function flushTaskHistoryPersistence() {
  const failed = new Set();
  while (pendingSessions.size > 0) {
    const entries = [...pendingSessions.entries()].filter(([key]) => !failed.has(key));
    if (!entries.length) break;
    for (const [key, pending] of entries) {
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = null;
      }
      const succeeded = await flushPendingSession(key, pending);
      if (!succeeded) failed.add(key);
    }
  }
  return { ok: failed.size === 0, failed: failed.size, pending: pendingSessions.size };
}

function taskHistoryPersistenceSnapshot() {
  return {
    healthy: !taskHistoryPersistenceState.lastError,
    pending: pendingSessions.size,
    retryCount: taskHistoryPersistenceState.retryCount,
    lastFailureAt: taskHistoryPersistenceState.lastFailureAt,
    lastError: taskHistoryPersistenceState.lastError
  };
}

function recordTaskHistoryPersistenceFailure(error, retryCount) {
  taskHistoryPersistenceState = {
    lastError: sanitizeDisplayText(error instanceof Error ? error.message : String(error || 'Task history persistence failed.'), 500),
    lastFailureAt: new Date().toISOString(),
    retryCount: Math.max(1, Number(retryCount || 1))
  };
}

function recordTaskHistoryPersistenceSuccess() {
  if ([...pendingSessions.values()].some(pending => Number(pending.retryCount || 0) > 0)) return;
  taskHistoryPersistenceState = { lastError: '', lastFailureAt: null, retryCount: 0 };
}

function clearTaskHistory(config) {
  const directory = getTaskHistoryDir(config);
  const prefix = `${directory}\u0000`;
  for (const [key, pending] of [...pendingSessions.entries()]) {
    if (!key.startsWith(prefix)) continue;
    if (pending.timer) clearTimeout(pending.timer);
    pendingSessions.delete(key);
  }
  const pruneTimer = pendingPrunes.get(directory);
  if (pruneTimer) clearTimeout(pruneTimer);
  pendingPrunes.delete(directory);
  volatileWorkflowEvidence.clear();
  clearStoredTaskHistory(config);
  recordTaskHistoryPersistenceSuccess();
}

function emptySession(id) {
  return {
    version: STORE_VERSION,
    id,
    taskId: id,
    sessionId: id,
    title: 'Historical Rel.AI task',
    objective: '',
    status: 'planning',
    progress: { mode: 'indeterminate', label: 'Progress unavailable' },
    currentStage: '',
    currentActivity: '',
    completionKnown: false,
    endReason: '',
    summary: '',
    workspace: '',
    startedAt: null,
    endedAt: null,
    completedAt: null,
    durationMs: 0,
    calls: 0,
    toolCallCount: 0,
    successfulToolCallCount: 0,
    failedToolCallCount: 0,
    activeCalls: 0,
    failures: 0,
    changedFiles: [],
    changedFileCount: 0,
    validation: 'not_run',
    committed: false,
    pushed: false,
    prDrafted: false,
    lastTool: '',
    operation: '',
    lastOutcome: '',
    currentOperations: [],
    events: []
  };
}

export { bindTaskHistoryActivityPersistence, clearTaskHistory, flushTaskHistoryPersistence, getTaskHistoryDir, readRecentWorkflowEvidence, readTaskHistory, readTaskHistorySession, readTaskHistorySessionRecord, recordTaskActivityEvent, recordTaskHistoryEvent, recordTaskRecoveryState, recordVolatileWorkflowEvidence, recordWorkflowEvidence, recordWorkflowEvidenceBatch, recordWorkflowState, taskHistoryPersistenceSnapshot };
