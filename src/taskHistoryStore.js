'use strict';

const { buildTaskHistory } = require('./taskHistory');
const { DEFAULT_TASK_IDLE_MS } = require('./toolActivity');
const {
  MAX_SESSIONS,
  clearTaskHistory,
  ensureMigrated,
  getTaskHistoryDir,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
  writeSession
} = require('./taskHistoryStorage');

const STORE_VERSION = 1;
const MAX_SESSION_EVENTS = 100;

function recordTaskHistoryEvent(config, event) {
  if (!event || typeof event !== 'object' || !isPersistableTaskEvent(event)) return null;
  const directory = getTaskHistoryDir(config);
  const canonicalId = resolveCanonicalTaskId(directory, event);
  const relatedIds = relatedTaskIds(event, canonicalId);
  const related = relatedIds.map(id => readSession(directory, id)).filter(Boolean);
  const session = applyEvent(mergeSessions(canonicalId, related), event);
  writeSession(directory, session);
  for (const id of relatedIds) {
    if (id && id !== canonicalId) removeSession(directory, id);
  }
  pruneSessions(directory, MAX_SESSIONS);
  return publicSession(session);
}

function readTaskHistorySession(config, taskId) {
  const id = cleanId(taskId);
  if (!id) return null;
  try {
    ensureMigrated(config);
    const session = readSession(getTaskHistoryDir(config), id);
    return session && isStoredLogicalSession(session) ? publicSession(session) : null;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task history session read:', error);
    return null;
  }
}

function readTaskHistory(config, activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, MAX_SESSIONS);
  let persisted;
  try {
    ensureMigrated(config);
    persisted = listSessions(getTaskHistoryDir(config), MAX_SESSIONS);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session history read:', error);
    const { readAudit } = require('./audit');
    const audit = readAudit(config, { limit: 10000, fullScan: true });
    return buildTaskHistory(audit.entries, activity, { limit });
  }
  const active = buildTaskHistory([], activity, { limit: MAX_SESSIONS });
  const activeIds = new Set(active.map(session => session.id).filter(Boolean));
  persisted = persisted.filter(session => {
    if (!isStoredSessionNoise(session, activeIds)) return true;
    removeSession(getTaskHistoryDir(config), session.id);
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

function resolveCanonicalTaskId(directory, event) {
  const explicit = cleanId(event.taskId);
  if (explicit && Number(event.taskIdentityVersion || 0) >= 2) return explicit;
  const validationTaskId = cleanId(event.validationTaskId);
  if (validationTaskId) return validationTaskId;
  if (explicit && !isFragmentedScope(event.scopeId)) return explicit;
  const candidate = findRecentCompatibleSession(directory, event);
  if (candidate) return candidate.id;
  if (explicit) return explicit;
  const timestamp = Date.parse(event.ts || '') || Date.now();
  return `legacy-${String(event.pid || 'unknown')}-${timestamp}`;
}

function findRecentCompatibleSession(directory, event) {
  if (!event.workspace || !isFragmentedScope(event.scopeId)) return null;
  const timestamp = Date.parse(event.ts || '') || Date.now();
  const strongScope = strongConversationScope(event.scopeId);
  return listSessions(directory, 24).find(session => {
    if (session.completionKnown || session.workspace !== event.workspace) return false;
    const ended = eventTime(session);
    if (!ended || timestamp < ended || timestamp - ended > DEFAULT_TASK_IDLE_MS) return false;
    const sessionStrong = (session._scopeIds || []).map(strongConversationScope).find(Boolean);
    if (strongScope && sessionStrong && strongScope !== sessionStrong) return false;
    const pids = new Set((session._pids || []).map(String));
    return !event.pid || !pids.size || pids.has(String(event.pid));
  }) || null;
}

function relatedTaskIds(event, canonicalId) {
  if (Number(event.taskIdentityVersion || 0) >= 2) return [canonicalId];
  const values = [event.taskId, ...(Array.isArray(event.relatedTaskIds) ? event.relatedTaskIds : [])]
    .map(cleanId)
    .filter(Boolean);
  return [...new Set([canonicalId, ...values])];
}

function applyEvent(session, event) {
  const timestamp = Date.parse(event.ts || '') || Date.now();
  const ended = timestamp + Math.max(0, Number(event.ms || 0));
  const completion = event.ok !== false && (event.completionKnown === true || event.tool === 'relai_complete_task');
  const changedFiles = unique([
    ...(session.changedFiles || []),
    ...(Array.isArray(event.changedFiles) ? event.changedFiles : []),
    ...(Array.isArray(event.sessionChangedFiles) ? event.sessionChangedFiles : []),
    ...(event.filePath ? [event.filePath] : [])
  ].map(String).filter(Boolean));
  const failures = Number(session.failures || 0) + (event.ok === false ? 1 : 0);
  const validation = event.validationStatus === 'not_required'
    ? 'not_required'
    : event.tool === 'relai_run_checks'
      ? validationState(event)
      : session.validation || 'not_run';
  const startedAt = session.startedAt && Date.parse(session.startedAt) <= timestamp
    ? session.startedAt
    : new Date(timestamp).toISOString();
  const endedAt = new Date(Math.max(ended, Date.parse(session.endedAt || '') || 0)).toISOString();

  return {
    ...session,
    version: STORE_VERSION,
    _taskIdentityVersion: Math.max(Number(session._taskIdentityVersion || 0), Number(event.taskIdentityVersion || 0)),
    calls: Number(session.calls || 0) + 1,
    failures,
    changedFiles,
    changedFileCount: changedFiles.length,
    validation,
    committed: Boolean(session.committed || (event.tool === 'relai_git_commit' && event.ok !== false)),
    pushed: Boolean(session.pushed || (event.tool === 'relai_git_push' && event.ok !== false)),
    // Historical events may use the removed pre-v10 PR-draft tool name.
    prDrafted: Boolean(session.prDrafted || (['relai_git_draft_pr', 'relai_git_create_pr'].includes(event.tool) && event.ok !== false)),
    completionKnown: Boolean(session.completionKnown || completion),
    endReason: completion || session.completionKnown ? 'explicit_completion' : 'inactivity_window',
    status: completion || session.completionKnown ? 'completed' : failures ? 'attention' : 'inactive',
    summary: event.taskSummary || session.summary || '',
    workspace: event.workspace || session.workspace || '',
    startedAt,
    endedAt,
    completedAt: endedAt,
    durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
    activeCalls: 0,
    lastTool: event.tool || session.lastTool || '',
    operation: event.operation || session.operation || operationForTool(event.tool),
    lastOutcome: event.ok === false ? 'failed' : 'succeeded',
    currentOperations: [],
    events: [...(session.events || []), compactEvent(event)].slice(-MAX_SESSION_EVENTS),
    _scopeIds: unique([...(session._scopeIds || []), cleanId(event.scopeId)].filter(Boolean)),
    _pids: unique([...(session._pids || []), event.pid == null ? '' : String(event.pid)].filter(Boolean))
  };
}

function mergeSessions(id, sessions) {
  const ordered = [...sessions].sort((left, right) => eventTime(left) - eventTime(right));
  if (!ordered.length) return emptySession(id);
  const first = ordered[0];
  const last = ordered.at(-1);
  const changedFiles = unique(ordered.flatMap(session => session.changedFiles || []));
  return {
    ...emptySession(id),
    ...last,
    id,
    calls: ordered.reduce((sum, session) => sum + Number(session.calls || 0), 0),
    failures: ordered.reduce((sum, session) => sum + Number(session.failures || 0), 0),
    changedFiles,
    changedFileCount: changedFiles.length,
    committed: ordered.some(session => session.committed),
    pushed: ordered.some(session => session.pushed),
    prDrafted: ordered.some(session => session.prDrafted),
    completionKnown: ordered.some(session => session.completionKnown),
    startedAt: first.startedAt,
    events: ordered.flatMap(session => session.events || [])
      .sort((left, right) => eventTime(left) - eventTime(right))
      .slice(-MAX_SESSION_EVENTS),
    _scopeIds: unique(ordered.flatMap(session => session._scopeIds || [])),
    _pids: unique(ordered.flatMap(session => session._pids || [])),
    _taskIdentityVersion: Math.max(...ordered.map(session => Number(session._taskIdentityVersion || 0)))
  };
}

function overlayActiveSession(persisted, active) {
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
    events: persisted.events || []
  };
}

function compactEvent(event) {
  const keep = [
    'id', 'ts', 'pid', 'taskId', 'scopeId', 'operationId', 'requestId', 'serverInstanceId',
    'transportType', 'transportSessionId', 'clientName', 'clientVersion', 'initializationRequestId',
    'taskIdentityVersion', 'taskIdExplicit', 'taskHistoryEligible', 'duplicateRequest', 'eventType',
    'tool', 'operation', 'workspace', 'ok', 'ms', 'changedFiles', 'sessionChangedFiles', 'filePath', 'validationStatus',
    'completionKnown', 'endReason', 'completionSource', 'taskSummary', 'validationTaskId', 'relatedTaskIds',
    'message', 'error', 'path'
  ];
  return Object.fromEntries(keep.filter(key => event[key] !== undefined).map(key => [key, event[key]]));
}

function publicSession(session) {
  if (!session || typeof session !== 'object') return session;
  const { version, _scopeIds, _pids, _taskIdentityVersion, ...value } = session;
  return value;
}

function emptySession(id) {
  return {
    version: STORE_VERSION,
    id,
    status: 'inactive',
    completionKnown: false,
    endReason: 'inactivity_window',
    summary: '',
    workspace: '',
    startedAt: null,
    endedAt: null,
    completedAt: null,
    durationMs: 0,
    calls: 0,
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
    events: [],
    _scopeIds: [],
    _pids: [],
    _taskIdentityVersion: 0
  };
}

function validationState(event) {
  if (event.ok === false || event.validationStatus === 'failed') return 'failed';
  if (event.validationStatus === 'not_required') return 'not_required';
  return event.validationStatus === 'passed' ? 'passed' : 'not_run';
}

function isFragmentedScope(value) {
  const scope = String(value || '');
  return /^mcp:(?:session|transport|fallback):/.test(scope) || /^mcp:[a-f0-9]{24}$/i.test(scope);
}

function strongConversationScope(value) {
  const match = String(value || '').match(/^mcp:conversation:[^\s]+/);
  return match ? match[0] : '';
}

function isPersistableTaskEvent(event) {
  if (!cleanId(event?.taskId) || event?.taskHistoryEligible === false || event?.eventType === 'task.start.rejected') return false;
  if (Number(event?.taskIdentityVersion || 0) >= 2 && event?.taskIdExplicit !== true) return false;
  return true;
}

function isStoredLogicalSession(session) {
  const events = Array.isArray(session?.events) ? session.events : [];
  if (!events.length) return true;
  return events.some(event => {
    if (event?.taskHistoryEligible === false || event?.eventType === 'task.start.rejected') return false;
    if (Number(event?.taskIdentityVersion || 0) < 2) return true;
    return Boolean(cleanId(event?.taskId) && event?.taskIdExplicit === true);
  });
}

function isStoredSessionNoise(session, activeIds) {
  if (!session?.id || activeIds.has(session.id)) return false;
  if (!isStoredLogicalSession(session)) return true;
  const events = Array.isArray(session.events) ? session.events : [];
  if (events.length !== 1 || session.completionKnown || Number(session.changedFileCount || 0) > 0) return false;
  const event = events[0] || {};
  if (event.eventType === 'task.start.rejected' || event.tool === 'relai_status') return true;
  if (event.tool !== 'relai_start_task') return false;
  const endedAt = eventTime(session);
  return Boolean(endedAt && Date.now() - endedAt > DEFAULT_TASK_IDLE_MS);
}

function cleanId(value) {
  return String(value || '').trim();
}

function eventTime(value) {
  const timestamp = Date.parse(value?.endedAt || value?.completedAt || value?.ts || value?.startedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function operationForTool(tool) {
  const value = String(tool || '').replace(/^relai_/, '').replaceAll('_', ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Rel.AI activity';
}

function unique(values) {
  return [...new Set(values)];
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

module.exports = {
  clearTaskHistory,
  getTaskHistoryDir,
  readTaskHistory,
  readTaskHistorySession,
  recordTaskHistoryEvent
};
