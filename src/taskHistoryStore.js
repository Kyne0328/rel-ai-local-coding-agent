
import { DEFAULT_TASK_IDLE_MS } from './toolActivity.js';
import { completeProgress, normalizeTaskProgress, sanitizeActivityEventRecord, sanitizeDisplayText, sanitizeTaskRecord, sanitizeTaskRecordForProjection } from './taskObservability.js';
import { isTerminalTaskStatus } from './taskState.js';
import { canonicalTaskSnapshot, mergeTaskLifecycleSnapshots, reduceTaskLifecycleAuditEvent } from './taskLifecycle.js';
import { DEFAULT_TASK_STALE_MS } from './taskTiming.js';
import { clamp, cleanTaskId, eventIdentityKey, eventTime, eventTimestampMs, isCurrentTaskEvent, timestampMs } from './taskEvents.js';
import { MAX_SESSIONS, clearTaskHistory as clearStoredTaskHistory, ensureCurrentHistory, getTaskHistoryDir, listSessions, pruneSessions, readSession, removeSession, writeSession, writeSessionAsync } from './taskHistoryStorage.js';
import { OPERATION_IDS as OP } from './tools/operationIds.js';
import { matchingRelevanceTerms, relevanceTerms } from './context/relevance.js';
const STORE_VERSION = 3;
const MAX_SESSION_EVENTS = 200;
const TASK_HISTORY_FLUSH_MS = 75;
const TASK_HISTORY_PRUNE_DELAY_MS = 1500;
const TASK_HISTORY_RETRY_BASE_MS = 1000;
const TASK_HISTORY_RETRY_MAX_MS = 15_000;
const pendingSessions = new Map();
const pendingFlushTimers = new Map();
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

function recordTaskBackgroundOperation(config, taskId, operation, options = {}) {
  const id = cleanTaskId(taskId);
  if (!id) return null;
  ensureCurrentHistory(config);
  const directory = getTaskHistoryDir(config);
  const session = readWorkingSession(directory, id);
  if (!session) return null;
  const next = { ...session };
  if (operation && typeof operation === 'object') next.backgroundOperation = operation;
  else delete next.backgroundOperation;
  persistSession(directory, next, options);
  return sanitizeTaskRecord({ status: 'planning', backgroundOperation: next.backgroundOperation })?.backgroundOperation || null;
}

function readTaskBackgroundOperation(config, taskId) {
  const id = cleanTaskId(taskId);
  if (!id) return null;
  try {
    ensureCurrentHistory(config);
    const operation = readWorkingSession(getTaskHistoryDir(config), id)?.backgroundOperation;
    return sanitizeTaskRecord({ status: 'planning', backgroundOperation: operation })?.backgroundOperation || null;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task background operation read:', error);
    return null;
  }
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
      if (isStoredSessionNoise(current, activeIds)) {
        discardStoredSession(directory, current.id);
        return null;
      }
      const reconciled = reconcileInactiveStoredSession(current, activeIds);
      if (reconciled !== current) persistSession(directory, reconciled, { defer: true });
      return reconciled;
    }).filter(Boolean);
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

function readRelevantTaskEpisodes(config, workspace, query, options = {}) {
  const workspaceAlias = String(workspace?.alias || workspace || '').trim();
  const queryTerms = relevanceTerms(query);
  if (!workspaceAlias || !queryTerms.length) return [];
  const excludeTaskId = cleanTaskId(options.excludeTaskId);
  const limit = clamp(options.limit || 3, 1, 5);
  const scanLimit = clamp(options.scanLimit || 80, limit, MAX_SESSIONS);
  return readTaskHistory(config, {}, { limit: MAX_SESSIONS })
    .filter(session => String(session.workspace || '') === workspaceAlias)
    .slice(0, scanLimit)
    .map((session, index) => ({ session, index, score: taskEpisodeScore(session, workspaceAlias, queryTerms, excludeTaskId) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(item => compactTaskEpisode(item.session));
}

function taskEpisodeScore(session, workspaceAlias, queryTerms, excludeTaskId) {
  if (!session || String(session.workspace || '') !== workspaceAlias) return 0;
  if (excludeTaskId && cleanTaskId(session.id) === excludeTaskId) return 0;
  if (session.status !== 'completed' || session.completionKnown !== true) return 0;
  const primary = matchingRelevanceTerms(queryTerms, `${session.objective || ''} ${session.title || ''}`);
  const secondary = matchingRelevanceTerms(queryTerms, `${session.resultSummary || ''} ${session.summary || ''} ${(session.changedFiles || []).join(' ')}`);
  return (primary.length * 3) + secondary.length;
}

function compactTaskEpisode(session) {
  const changes = uniqueStrings(session.changedFiles).slice(0, 8);
  const goal = compactText(session.objective || session.title, 300);
  const outcome = compactText(session.resultSummary || session.summary, 600);
  return {
    ...(goal ? { goal } : {}),
    ...(outcome ? { outcome } : {}),
    ...(changes.length ? { changes } : {}),
    ...(String(session.validation || '').trim() ? { validation: String(session.validation).trim() } : {})
  };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

function compactText(value, limit) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
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

function isStoredSessionNoise(session, activeIds, timestamp = Date.now()) {
  if (!session?.id || activeIds.has(session.id) || isTerminalTaskStatus(session.status)) return false;
  if (session.completionKnown === true || Number(session.changedFileCount || 0) > 0 || Number(session.activeCalls || 0) > 0) return false;
  const events = Array.isArray(session.events) ? session.events : [];
  if (events.length !== 1 || String(events[0]?.tool || '') !== OP.WORK_BEGIN) return false;
  const lastActivityMs = storedSessionActivityMs(session);
  return Boolean(lastActivityMs && timestamp - lastActivityMs >= DEFAULT_TASK_STALE_MS);
}

function discardStoredSession(directory, id) {
  const key = pendingSessionKey(directory, id);
  pendingSessions.delete(key);
  if (!pendingSessionEntriesForDirectory(directory).length) clearPendingDirectoryFlush(directory);
  removeSession(directory, id);
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
  const publicStatus = value.status;
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

function pendingSessionEntriesForDirectory(directory) {
  const prefix = `${directory}\u0000`;
  return [...pendingSessions.entries()].filter(([key]) => key.startsWith(prefix));
}

function pendingSessionsForDirectory(directory) {
  return pendingSessionEntriesForDirectory(directory)
    .map(([, entry]) => entry.session)
    .filter(Boolean);
}

function persistSession(directory, session, options = {}) {
  if (!session?.id) return;
  const key = pendingSessionKey(directory, session.id);
  if (options.defer !== true) {
    const pending = pendingSessions.get(key);
    if (pending?.writing) {
      pending.session = session;
      pending.version += 1;
      schedulePendingDirectoryFlush(directory, 0);
      return;
    }
    pendingSessions.delete(key);
    if (!pendingSessionEntriesForDirectory(directory).length) clearPendingDirectoryFlush(directory);
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
    pending = { directory, session, writing: false, version: 0, persistedVersion: 0, retryCount: 0, promise: Promise.resolve(true) };
    pendingSessions.set(key, pending);
  }
  pending.session = session;
  pending.version += 1;
  schedulePendingDirectoryFlush(directory);
}

function schedulePendingDirectoryFlush(directory, delay = TASK_HISTORY_FLUSH_MS) {
  if (pendingFlushTimers.has(directory)) return;
  const timer = setTimeout(() => {
    pendingFlushTimers.delete(directory);
    void flushPendingDirectory(directory);
  }, delay);
  timer.unref?.();
  pendingFlushTimers.set(directory, timer);
}

function clearPendingDirectoryFlush(directory) {
  const timer = pendingFlushTimers.get(directory);
  if (!timer) return;
  clearTimeout(timer);
  pendingFlushTimers.delete(directory);
}

async function flushPendingDirectory(directory) {
  for (const [key, pending] of pendingSessionEntriesForDirectory(directory)) {
    const succeeded = await flushPendingSession(key, pending);
    if (!succeeded) {
      const retryDelay = Math.min(TASK_HISTORY_RETRY_MAX_MS, TASK_HISTORY_RETRY_BASE_MS * (2 ** Math.min(pending.retryCount - 1, 4)));
      schedulePendingDirectoryFlush(directory, retryDelay);
      return false;
    }
  }
  if (pendingSessionEntriesForDirectory(directory).length) schedulePendingDirectoryFlush(directory, 0);
  return true;
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
        if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] deferred task history write:', failure);
        return;
      }
      pending.retryCount = 0;
      pending.persistedVersion = version;
      scheduleTaskHistoryPrune(pending.directory);
      if (pending.version <= version) pendingSessions.delete(key);
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
  for (const directory of [...pendingFlushTimers.keys()]) clearPendingDirectoryFlush(directory);
  const failed = new Set();
  const failedDirectories = new Set();
  while (pendingSessions.size > 0) {
    const entries = [...pendingSessions.entries()]
      .filter(([key, pending]) => !failed.has(key) && !failedDirectories.has(pending.directory));
    if (!entries.length) break;
    for (const [key, pending] of entries) {
      if (failedDirectories.has(pending.directory)) continue;
      const succeeded = await flushPendingSession(key, pending);
      if (!succeeded) {
        failed.add(key);
        failedDirectories.add(pending.directory);
      }
    }
  }
  for (const directory of failedDirectories) {
    const retryCount = Math.max(1, ...pendingSessionEntriesForDirectory(directory).map(([, pending]) => Number(pending.retryCount || 0)));
    const retryDelay = Math.min(TASK_HISTORY_RETRY_MAX_MS, TASK_HISTORY_RETRY_BASE_MS * (2 ** Math.min(retryCount - 1, 4)));
    schedulePendingDirectoryFlush(directory, retryDelay);
  }
  return { ok: failed.size === 0, failed: failed.size, pending: pendingSessions.size };
}

function taskHistoryPersistenceSnapshot() {
  return {
    healthy: !taskHistoryPersistenceState.lastError,
    pending: pendingSessions.size,
    scheduledFlushes: pendingFlushTimers.size,
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
  for (const [key] of [...pendingSessions.entries()]) {
    if (!key.startsWith(prefix)) continue;
    pendingSessions.delete(key);
  }
  clearPendingDirectoryFlush(directory);
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
    commitHead: '',
    commitHeads: [],
    pushed: false,
    prDrafted: false,
    lastTool: '',
    operation: '',
    lastOutcome: '',
    currentOperations: [],
    events: []
  };
}

export { bindTaskHistoryActivityPersistence, clearTaskHistory, flushTaskHistoryPersistence, getTaskHistoryDir, readRecentWorkflowEvidence, readRelevantTaskEpisodes, readTaskBackgroundOperation, readTaskHistory, readTaskHistorySession, readTaskHistorySessionRecord, recordTaskActivityEvent, recordTaskBackgroundOperation, recordTaskHistoryEvent, recordVolatileWorkflowEvidence, recordWorkflowEvidence, recordWorkflowEvidenceBatch, recordWorkflowState, taskHistoryPersistenceSnapshot };
