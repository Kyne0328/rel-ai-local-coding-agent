
import { DEFAULT_TASK_IDLE_MS } from './toolActivity.js';
import { completeProgress, normalizeTaskProgress, sanitizeActivityEventRecord, sanitizeTaskRecord, sanitizeTaskRecordForProjection } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';
import { canonicalTaskSnapshot, mergeTaskLifecycleSnapshots, reduceTaskLifecycleAuditEvent } from './taskLifecycle.js';
import { clamp, cleanTaskId, eventIdentityKey, eventTime, eventTimestampMs, isCurrentTaskEvent, timestampMs } from './taskEvents.js';
import { MAX_SESSIONS, clearTaskHistory as clearStoredTaskHistory, ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, readSession, removeSession, writeSession, writeSessionAsync } from './taskHistoryStorage.js';
const STORE_VERSION = 3;
const MAX_SESSION_EVENTS = 200;
const TASK_HISTORY_FLUSH_MS = 75;
const TASK_HISTORY_PRUNE_DELAY_MS = 1500;
const pendingSessions = new Map();
const pendingPrunes = new Map();
let activityPersistenceBound = false;

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

function recordWorkflowSnapshot(config, taskId, workflow, options = {}) {
  const id = cleanTaskId(taskId);
  if (!id || !workflow || typeof workflow !== 'object') return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const session = readWorkingSession(directory, id);
  if (!session) return null;
  const safe = JSON.parse(JSON.stringify(workflow));
  const next = { ...session, workflow: safe };
  persistSession(directory, next, options);
  return safe;
}
function recordWorkflowEvidence(config, taskId, receipt, options = {}) {
  const id = cleanTaskId(taskId);
  if (!id || !receipt || typeof receipt !== 'object') return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const session = readWorkingSession(directory, id);
  if (!session) return null;
  const evidence = [...(Array.isArray(session.workflowEvidence) ? session.workflowEvidence : []), receipt].slice(-100);
  const next = { ...session, workflowEvidence: evidence };
  persistSession(directory, next, options);
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
    const evidence = Array.isArray(session?.workflowEvidence) ? session.workflowEvidence : [];
    return evidence.slice(-clamp(limit, 1, 100)).map(item => ({ ...item }));
  } catch {
    return [];
  }
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
  persisted = persisted.filter(session => {
    if (!isStoredSessionNoise(session, activeIds)) return true;
    removeSession(directory, session.id);
    return false;
  });
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
    return event?.tool === 'relai_finish_work' && event?.ok !== false && !['failed', 'cancelled'].includes(String(event?.status || '').toLowerCase());
  });
}

function hasWorkflowCompletionEvidence(session = {}) {
  const workflow = session.workflow;
  if (!workflow || String(workflow.stage || '') !== 'complete') return false;
  const completion = workflow.completion;
  if (!completion || completion.hardReady !== true) return false;
  return !Array.isArray(completion.blockers) || completion.blockers.length === 0;
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
    return recoverCompletedSession(session, { endReason: 'explicit_completion', completionSource: session.completionSource || 'relai_finish_work' });
  }
  if (!isTerminalTaskStatus(session.status) && hasWorkflowCompletionEvidence(session)) {
    return recoverCompletedSession(session, { endReason: 'workflow_completion', completionSource: 'workflow' });
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
  return {
    ...value,
    taskId: value.taskId || value.id,
    sessionId: value.sessionId || value.id,
    title: value.title || historicalTitle(value),
    progress: value.progress || (value.status === 'completed' ? completeProgress() : { mode: 'indeterminate', label: 'Progress unavailable' }),
    toolCallCount: Number(value.toolCallCount ?? value.calls ?? 0),
    successfulToolCallCount: Number(value.successfulToolCallCount ?? Math.max(0, Number(value.calls || 0) - Number(value.failures || 0))),
    failedToolCallCount: Number(value.failedToolCallCount ?? value.failures ?? 0),
    activeCalls: terminal || value.status === 'inactive' ? 0 : Number(value.activeCalls || 0),
    currentOperations: terminal || value.status === 'inactive' ? [] : Array.isArray(value.currentOperations) ? value.currentOperations : [],
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
    if (!pending?.writing) pendingSessions.delete(key);
    writeSession(directory, session);
    scheduleTaskHistoryPrune(directory);
    return;
  }

  let pending = pendingSessions.get(key);
  if (!pending) {
    pending = { directory, session, timer: null, writing: false, version: 0, persistedVersion: 0, promise: Promise.resolve() };
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
  pending.promise = writeSessionAsync(pending.directory, snapshot)
    .then(() => { succeeded = true; })
    .catch(error => {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] deferred task history write:', error);
    })
    .finally(() => {
      pending.writing = false;
      if (!succeeded) {
        schedulePendingSessionFlush(key, pending, 1000);
        return;
      }
      pending.persistedVersion = version;
      scheduleTaskHistoryPrune(pending.directory);
      if (pending.version > version) schedulePendingSessionFlush(key, pending, 0);
      else pendingSessions.delete(key);
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
  while (pendingSessions.size > 0) {
    const entries = [...pendingSessions.entries()];
    for (const [key, pending] of entries) {
      if (pending.timer) {
        clearTimeout(pending.timer);
        pending.timer = null;
      }
      await flushPendingSession(key, pending);
    }
  }
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
  clearStoredTaskHistory(config);
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

function isStoredSessionNoise(session, activeIds) {
  if (!session?.id || activeIds.has(session.id)) return false;
  const events = Array.isArray(session.events) ? session.events : [];
  if (events.length !== 1 || session.completionKnown || Number(session.changedFileCount || 0) > 0) return false;
  const event = events[0] || {};
  if (event.tool !== 'relai_begin_work') return false;
  const endedAt = eventTime(session);
  return Boolean(endedAt && Date.now() - endedAt > DEFAULT_TASK_IDLE_MS);
}

export { bindTaskHistoryActivityPersistence, clearTaskHistory, flushTaskHistoryPersistence, getTaskHistoryDir, readRecentWorkflowEvidence, readTaskHistory, readTaskHistorySession, readTaskHistorySessionRecord, recordTaskActivityEvent, recordTaskHistoryEvent, recordWorkflowEvidence, recordWorkflowSnapshot, recordWorkflowState };
