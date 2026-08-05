
import { buildTaskHistory } from './taskHistory.js';
import { DEFAULT_TASK_IDLE_MS } from './toolActivity.js';
import { completeProgress, normalizeTaskProgress, sanitizeActivityEventRecord, sanitizeDisplayText, sanitizeTaskRecord } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';
import { clamp, cleanTaskId, eventIdentityKey, eventTime, eventTimestampMs, isoTimestamp, isCurrentTaskEvent, operationForTool, terminalTaskTimestamp, timestampMs, unique } from './taskEvents.js';
import { MAX_SESSIONS, clearTaskHistory, ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, readSession, removeSession, writeSession } from './taskHistoryStorage.js';
const STORE_VERSION = 3;
const MAX_SESSION_EVENTS = 200;
let activityPersistenceBound = false;

function recordTaskHistoryEvent(config, event) {
  if (!isCurrentTaskEvent(event)) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const taskId = cleanTaskId(event.taskId);
  const session = applyEvent(readSession(directory, taskId) || emptySession(taskId), event);
  writeSession(directory, session);
  pruneSessions(directory, MAX_SESSIONS);
  return publicSession(session);
}

function bindTaskHistoryActivityPersistence(onActivity, getConfig) {
  if (activityPersistenceBound || typeof onActivity !== 'function' || typeof getConfig !== 'function') return;
  activityPersistenceBound = true;
  onActivity((activity) => {
    try {
      recordTaskActivityEvent(getConfig(), activity);
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] live task history write:', error);
    }
  });
}

function recordTaskActivityEvent(config, activity = {}) {
  const task = activity.task && typeof activity.task === 'object' ? activity.task : null;
  const taskId = cleanTaskId(task?.taskId || task?.id || activity.taskId);
  if (!taskId) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const existing = readSession(directory, taskId) || emptySession(taskId);
  const event = activity.activityEvent || null;
  const events = upsertActivityEvent(existing.events || [], event);
  const startedAt = task?.startedAtIso || task?.createdAt || isoTimestamp(task?.startedAt) || existing.startedAt || null;
  const updatedAt = task?.updatedAt || isoTimestamp(task?.lastActivityAt) || event?.timestamp || new Date().toISOString();
  const existingTerminal = isTerminalTaskStatus(existing?.status);
  const existingUpdatedAt = terminalTaskTimestamp(existing);
  const incomingUpdatedAt = timestampMs(updatedAt);
  if (existingTerminal && existingUpdatedAt > incomingUpdatedAt) return publicSession(existing);
  const terminal = isTerminalTaskStatus(task?.status);
  const session = {
    ...existing,
    ...task,
    version: STORE_VERSION,
    id: taskId,
    taskId,
    sessionId: task?.sessionId || taskId,
    title: task?.title || existing.title || historicalTitle(existing),
    objective: task?.objective || existing.objective || '',
    status: task?.status || existing.status || 'planning',
    progress: task?.progress || existing.progress || { mode: 'indeterminate', label: 'Progress unavailable' },
    currentStage: task?.currentStage || existing.currentStage || '',
    currentActivity: task?.currentActivity || existing.currentActivity || event?.summary || '',
    calls: Math.max(Number(existing.calls || 0), Number(task?.toolCallCount || task?.calls || activity.taskCalls || 0)),
    toolCallCount: Math.max(Number(existing.toolCallCount || 0), Number(task?.toolCallCount || task?.calls || activity.taskCalls || 0)),
    successfulToolCallCount: Math.max(Number(existing.successfulToolCallCount || 0), Number(task?.successfulToolCallCount || 0)),
    failedToolCallCount: Math.max(Number(existing.failedToolCallCount || 0), Number(task?.failedToolCallCount || task?.failures || activity.taskFailures || 0)),
    failures: Math.max(Number(existing.failures || 0), Number(task?.failures || activity.taskFailures || 0)),
    workspace: task?.workspace || activity.workspace || existing.workspace || '',
    lastTool: task?.lastTool || task?.tool || activity.tool || existing.lastTool || '',
    operation: task?.operation || task?.lastOperation || activity.operation || existing.operation || '',
    currentOperations: Array.isArray(task?.currentOperations) ? task.currentOperations : existing.currentOperations || [],
    startedAt,
    updatedAt,
    endedAt: terminal ? (task?.completedAtIso || isoTimestamp(task?.completedAt || task?.endedAt) || updatedAt) : null,
    completedAt: terminal ? (task?.completedAtIso || isoTimestamp(task?.completedAt || task?.endedAt) || updatedAt) : null,
    durationMs: Number(task?.durationMs || existing.durationMs || 0),
    completionKnown: task?.completionKnown === true || existing.completionKnown === true,
    resultSummary: task?.resultSummary || task?.summary || existing.resultSummary || '',
    errorSummary: task?.errorSummary || existing.errorSummary || '',
    events
  };
  writeSession(directory, session);
  pruneSessions(directory, MAX_SESSIONS);
  return publicSession(session);
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
    const session = readSession(directory, id);
    if (!session) return null;
    const activeIds = options.activeTaskIds instanceof Set
      ? options.activeTaskIds
      : new Set(Array.isArray(options.activeTaskIds) ? options.activeTaskIds.map(String) : []);
    const reconciled = options.reconcileInactive === true
      ? reconcileInactiveStoredSession(session, activeIds)
      : session;
    if (reconciled !== session) writeSession(directory, reconciled);
    return sanitizeTaskRecord(reconciled);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task history session read:', error);
    return null;
  }
}

function readTaskHistory(config, activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, MAX_SESSIONS);
  const active = buildTaskHistory([], activity, { limit: MAX_SESSIONS });
  const activeIds = new Set(active.map(session => session.id).filter(Boolean));
  const directory = getTaskHistoryDir(config);
  let persisted = [];
  try {
    ensureCurrentHistory(config);
    persisted = listSessions(directory, MAX_SESSIONS).map(session => {
      const reconciled = reconcileInactiveStoredSession(session, activeIds);
      if (reconciled !== session) writeSession(directory, reconciled);
      return reconciled;
    });
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
    byId.set(task.id, existing ? overlayActiveSession(existing, task) : task);
  }
  return [...byId.values()]
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, limit)
    .map(publicSession);
}

function applyEvent(session, event) {
  const timestamp = timestampMs(event.ts) || Date.now();
  const ended = timestamp + Math.max(0, Number(event.ms || 0));
  const completion = event.ok !== false && (event.completionKnown === true || event.tool === 'relai_finish_work');
  const cancellation = event.ok !== false && event.tool === 'relai_cancel_work';
  const changedFiles = unique([
    ...(session.changedFiles || []),
    ...(Array.isArray(event.taskOwnedChangedFiles) ? event.taskOwnedChangedFiles : []),
    ...(Array.isArray(event.changedFiles) ? event.changedFiles : [])
  ].map(String).filter(Boolean));
  const lifecycleIndex = event.operationId
    ? (session.events || []).findIndex(item => item?.eventId === event.operationId || item?.operationId === event.operationId)
    : -1;
  const represented = lifecycleIndex >= 0;
  const recoverableValidationFailure = event.tool === 'relai_run_checks' && ['failed', 'not_run'].includes(String(event.validationStatus || ''));
  const failures = Math.max(
    Number(session.failures || 0),
    Number(session.failedToolCallCount || 0)
  ) + (event.ok === false && !represented && !recoverableValidationFailure ? 1 : 0);
  const validation = event.validationStatus === 'not_required'
    ? 'not_required'
    : event.tool === 'relai_run_checks'
      ? validationState(event)
      : session.validation || 'not_run';
  const startedAt = session.startedAt && timestampMs(session.startedAt) <= timestamp
    ? session.startedAt
    : new Date(timestamp).toISOString();
  const lastActivityAt = new Date(Math.max(ended, timestampMs(session.endedAt))).toISOString();

  const calls = Number(session.calls || 0) + (represented ? 0 : 1);
  const auditEvent = compactEvent(event);
  const events = represented
    ? (session.events || []).map((item, index) => index === lifecycleIndex ? { ...auditEvent, ...item } : item)
    : [...(session.events || []), auditEvent];
  const status = completion || session.completionKnown
    ? 'completed'
    : cancellation
      ? 'cancelled'
      : isTerminalTaskStatus(session.status)
        ? session.status
        : recoverableValidationFailure
          ? 'validation_failed'
          : 'planning';
  const terminal = isTerminalTaskStatus(status);

  return {
    ...session,
    version: STORE_VERSION,
    calls,
    toolCallCount: Math.max(Number(session.toolCallCount || 0), calls),
    successfulToolCallCount: Math.max(0, calls - failures),
    failedToolCallCount: failures,
    failures,
    changedFiles,
    changedFileCount: changedFiles.length,
    validation,
    committed: Boolean(session.committed || (event.tool === 'relai_git_commit' && event.ok !== false)),
    pushed: Boolean(session.pushed || (event.tool === 'relai_git_push' && event.ok !== false)),
    prDrafted: Boolean(session.prDrafted || (event.tool === 'relai_git_draft_pr' && event.ok !== false)),
    completionKnown: Boolean(session.completionKnown || completion),
    endReason: completion || session.completionKnown
      ? 'explicit_completion'
      : cancellation
        ? 'explicit_cancellation'
        : terminal
          ? session.endReason || ''
          : '',
    status,
    summary: event.taskSummary || session.summary || '',
    workspace: session.workspace || event.workspace || '',
    startedAt,
    endedAt: terminal ? lastActivityAt : null,
    completedAt: terminal ? lastActivityAt : null,
    durationMs: Math.max(0, timestampMs(lastActivityAt) - timestampMs(startedAt)),
    activeCalls: 0,
    lastTool: event.tool || session.lastTool || '',
    operation: event.operation || session.operation || operationForTool(event.tool),
    lastOutcome: event.ok === false ? 'failed' : 'succeeded',
    currentOperations: [],
    events: events.slice(-MAX_SESSION_EVENTS)
  };
}

function reconcileInactiveStoredSession(session, activeIds, timestamp = Date.now()) {
  if (!session?.id || activeIds.has(session.id) || isTerminalTaskStatus(session.status)) return session;
  const lastActivityMs = storedSessionActivityMs(session);
  if (!lastActivityMs || timestamp - lastActivityMs < DEFAULT_TASK_IDLE_MS) return session;
  const endedMs = lastActivityMs + DEFAULT_TASK_IDLE_MS;
  const startedMs = timestampMs(session.startedAt || session.createdAt) || endedMs;
  const unresolvedFailure = String(session.lastOutcome || '').toLowerCase() === 'failed';
  const status = unresolvedFailure ? 'failed' : 'cancelled';
  const terminalLabel = unresolvedFailure ? 'Failed after inactivity' : 'Cancelled after inactivity';
  const endedAt = new Date(endedMs).toISOString();
  return {
    ...session,
    state: 'ended',
    status,
    progress: normalizeTaskProgress({ ...(session.progress || {}), label: terminalLabel }, status),
    currentStage: terminalLabel,
    completionKnown: false,
    endReason: 'inactivity_window',
    terminalReason: unresolvedFailure
      ? 'Task became inactive after an unrecovered failure.'
      : 'Task was cancelled after the inactivity window elapsed.',
    activeCalls: 0,
    currentOperations: [],
    updatedAt: endedAt,
    lastActivityAt: endedMs,
    endedAt,
    completedAt: endedAt,
    durationMs: Math.max(0, endedMs - startedMs)
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

function overlayActiveSession(persisted, active) {
  const persistedTerminal = isTerminalTaskStatus(persisted?.status);
  const persistedTime = terminalTaskTimestamp(persisted);
  const activeTime = terminalTaskTimestamp(active);
  if (persistedTerminal && persistedTime >= activeTime) return persisted;
  return {
    ...persisted,
    ...active,
    calls: Math.max(Number(persisted.calls || 0), Number(active.calls || 0)),
    failures: Math.max(Number(persisted.failures || 0), Number(active.failures || 0)),
    changedFiles: persisted.changedFiles || [],
    changedFileCount: Number(persisted.changedFileCount || 0),
    validation: persisted.validation || 'not_run',
    committed: Boolean(persisted.committed),
    pushed: Boolean(persisted.pushed),
    prDrafted: Boolean(persisted.prDrafted),
    completionKnown: active.completionKnown === true || persisted.completionKnown === true,
    events: mergeActivityEvents(persisted.events || [], active.events || [])
  };
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

function mergeActivityEvents(persisted, active) {
  let merged = [...persisted];
  for (const event of active) merged = upsertActivityEvent(merged, event);
  return merged;
}

function historicalTitle(session) {
  const operation = String(session?.operation || '').trim();
  if (operation && !/^(task|request|tool call|mcp operation)$/i.test(operation)) return operation;
  const workspace = String(session?.workspace || '').trim();
  return workspace ? `Historical task in ${workspace}` : 'Historical Rel.AI task';
}

function compactEvent(event) {
  const keep = [
    'id', 'eventId', 'ts', 'timestamp', 'startedAt', 'completedAt', 'durationMs', 'pid', 'taskId',
    'operationId', 'requestId', 'serverInstanceId', 'transportType', 'clientName', 'clientVersion',
    'taskIdentityVersion', 'taskIdExplicit', 'taskHistoryEligible', 'duplicateRequest', 'eventType',
    'category', 'action', 'status', 'title', 'summary', 'currentStage', 'currentActivity', 'tool',
    'operation', 'workspace', 'target', 'result', 'metadata', 'progress', 'ok', 'ms', 'changedFiles',
    'taskOwnedChangedFiles', 'externalChangedFiles', 'validationStatus', 'validationFingerprint',
    'taskMutationGeneration', 'taskValidatedMutationGeneration', 'taskWorkspaceGeneration',
    'completionKnown', 'endReason', 'completionSource', 'taskSummary', 'message', 'error', 'path'
  ];
  const compact = Object.fromEntries(keep.filter(key => event[key] !== undefined).map(key => [key, event[key]]));
  for (const key of ['taskSummary', 'message', 'error']) {
    if (compact[key] != null) compact[key] = sanitizeDisplayText(compact[key], 500);
  }
  if (!compact.eventId && compact.operationId) compact.eventId = compact.operationId;
  return sanitizeActivityEventRecord(compact);
}

function publicSession(session) {
  if (!session || typeof session !== 'object') return session;
  const { version, principalFingerprint, ...value } = sanitizeTaskRecord(session);
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
    activeCalls: terminal ? 0 : Number(value.activeCalls || 0),
    currentOperations: terminal ? [] : Array.isArray(value.currentOperations) ? value.currentOperations : [],
    currentStage: value.currentStage || '',
    currentActivity: value.currentActivity || value.operation || ''
  };
}

function emptySession(id) {
  return {
    version: STORE_VERSION,
    id,
    taskId: id,
    sessionId: id,
    title: 'Historical Rel.AI task',
    objective: '',
    status: 'cancelled',
    progress: { mode: 'indeterminate', label: 'Progress unavailable' },
    currentStage: '',
    currentActivity: '',
    completionKnown: false,
    endReason: 'inactivity_window',
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

function validationState(event) {
  if (event.ok === false || event.validationStatus === 'failed') return 'failed';
  if (event.validationStatus === 'not_required') return 'not_required';
  return event.validationStatus === 'passed' ? 'passed' : 'not_run';
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

export { bindTaskHistoryActivityPersistence, clearTaskHistory, getTaskHistoryDir, readTaskHistory, readTaskHistorySession, readTaskHistorySessionRecord, recordTaskActivityEvent, recordTaskHistoryEvent };
