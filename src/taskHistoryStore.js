'use strict';

const { buildTaskHistory } = require('./taskHistory');
const { DEFAULT_TASK_IDLE_MS } = require('./toolActivity');
const { clamp, cleanTaskId, eventTime, isCurrentTaskEvent, operationForTool, unique } = require('./taskEvents');
const {
  MAX_SESSIONS,
  clearTaskHistory,
  ensureCurrentHistory,
  getTaskHistoryDir,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
  writeSession
} = require('./taskHistoryStorage');

const STORE_VERSION = 2;
const MAX_SESSION_EVENTS = 100;

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

function readTaskHistorySession(config, taskId) {
  const id = cleanTaskId(taskId);
  if (!id) return null;
  try {
    ensureCurrentHistory(config);
    const session = readSession(getTaskHistoryDir(config), id);
    return session ? publicSession(session) : null;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] task history session read:', error);
    return null;
  }
}

function readTaskHistory(config, activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, MAX_SESSIONS);
  let persisted = [];
  try {
    ensureCurrentHistory(config);
    persisted = listSessions(getTaskHistoryDir(config), MAX_SESSIONS);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] session history read:', error);
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
    calls: Number(session.calls || 0) + 1,
    failures,
    changedFiles,
    changedFileCount: changedFiles.length,
    validation,
    committed: Boolean(session.committed || (event.tool === 'relai_git_commit' && event.ok !== false)),
    pushed: Boolean(session.pushed || (event.tool === 'relai_git_push' && event.ok !== false)),
    prDrafted: Boolean(session.prDrafted || (event.tool === 'relai_git_draft_pr' && event.ok !== false)),
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
    events: [...(session.events || []), compactEvent(event)].slice(-MAX_SESSION_EVENTS)
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
    'id', 'ts', 'pid', 'taskId', 'operationId', 'requestId', 'serverInstanceId',
    'transportType', 'clientName', 'clientVersion', 'taskIdentityVersion', 'taskIdExplicit',
    'taskHistoryEligible', 'duplicateRequest', 'eventType', 'tool', 'operation', 'workspace',
    'ok', 'ms', 'changedFiles', 'sessionChangedFiles', 'filePath', 'validationStatus',
    'completionKnown', 'endReason', 'completionSource', 'taskSummary', 'message', 'error', 'path'
  ];
  return Object.fromEntries(keep.filter(key => event[key] !== undefined).map(key => [key, event[key]]));
}

function publicSession(session) {
  if (!session || typeof session !== 'object') return session;
  const { version, ...value } = session;
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
  if (event.tool !== 'relai_start_task') return false;
  const endedAt = eventTime(session);
  return Boolean(endedAt && Date.now() - endedAt > DEFAULT_TASK_IDLE_MS);
}

module.exports = {
  clearTaskHistory,
  getTaskHistoryDir,
  readTaskHistory,
  readTaskHistorySession,
  recordTaskHistoryEvent
};
