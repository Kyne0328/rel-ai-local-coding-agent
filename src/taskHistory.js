
import { clamp, eventIdentityKey, eventTimestampMs, isCurrentTaskEvent, operationForTool, terminalTaskTimestamp, timestampMs, unique } from './taskEvents.js';
import { completeProgress, sanitizeTaskRecord } from './taskObservability.js';
import { normalizeLiveTaskStatus } from './taskState.js';
function buildTaskHistory(entries = [], activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, 500);
  const groups = groupTaskEntries(entries);
  const activeTasks = activityTasks(activity);
  const activeById = new Map(activeTasks.map(task => [task.id || task.taskId, task]));
  const representedTaskIds = new Set();
  const tasks = [...groups.entries()].map(([taskId, events]) => {
    representedTaskIds.add(taskId);
    return summarizeTask(taskId, events, activeById.get(taskId));
  });
  for (const active of activeTasks) {
    const taskId = active.id || active.taskId;
    if (taskId && !representedTaskIds.has(taskId)) tasks.push(activeTaskFromActivity(active));
  }
  return tasks
    .sort((left, right) => terminalTaskTimestamp(right) - terminalTaskTimestamp(left))
    .slice(0, limit)
    .map(sanitizeTaskRecord);
}

function activityTasks(activity) {
  if (Array.isArray(activity?.tasks)) return activity.tasks;
  if (Array.isArray(activity?.activeTasks)) return activity.activeTasks;
  if (activity?.taskId && activity.state !== 'idle') return [activity];
  return [];
}

function summarizeTask(taskId, events, activeTask) {
  const ordered = [...events].sort((a, b) => eventTimestampMs(a) - eventTimestampMs(b));
  const first = ordered[0] || {};
  const last = ordered.at(-1) || first;
  const startedMs = eventTimestampMs(first) || timestampMs(activeTask?.startedAt) || Date.now();
  const endedMs = Math.max(...ordered.map(entry => (eventTimestampMs(entry) || startedMs) + Math.max(0, Number(entry.ms || 0))));
  const changedFiles = unique(ordered.flatMap(eventChangedFiles));
  const failures = Math.max(ordered.filter(entry => entry.ok === false).length, Number(activeTask?.failures || 0));
  const validation = validationSummary(ordered);
  const completionEvent = [...ordered].reverse().find(entry =>
    entry.ok !== false && (entry.completionKnown === true || entry.tool === 'relai_finish_work')
  ) || null;
  const cancellationEvent = [...ordered].reverse().find(entry => entry.ok !== false && entry.tool === 'relai_cancel_work') || null;
  const terminalFailure = [...ordered].reverse().find(entry => entry.endReason === 'terminal_failure' || entry.terminal === true) || null;
  const terminal = Boolean(completionEvent || cancellationEvent || terminalFailure);
  const endedAt = activeTask || !terminal ? null : new Date(endedMs).toISOString();
  return {
    id: taskId,
    taskId,
    sessionId: taskId,
    title: activeTask?.title || titleFromEvents(ordered),
    objective: activeTask?.objective || '',
    status: activeTask?.status || (activeTask ? normalizeLiveTaskStatus(activeTask.state, activeTask) : completionEvent ? 'completed' : cancellationEvent ? 'cancelled' : terminalFailure ? 'failed' : 'inactive'),
    progress: activeTask?.progress || (completionEvent ? completeProgress() : { mode: 'indeterminate', label: 'Progress unavailable' }),
    currentStage: activeTask?.currentStage || '',
    currentActivity: activeTask?.currentActivity || activeTask?.operation || last.operation || '',
    completionKnown: activeTask?.completionKnown === true || Boolean(completionEvent),
    endReason: activeTask ? null : completionEvent ? 'explicit_completion' : cancellationEvent ? 'explicit_cancellation' : terminalFailure ? 'terminal_failure' : '',
    summary: activeTask?.summary || completionEvent?.taskSummary || '',
    workspace: activeTask?.workspace || ordered.find(entry => entry.workspace)?.workspace || '',
    startedAt: new Date(startedMs).toISOString(),
    endedAt,
    completedAt: endedAt,
    durationMs: activeTask || !terminal ? Math.max(0, Date.now() - startedMs) : Math.max(0, endedMs - startedMs),
    calls: Math.max(ordered.length, Number(activeTask?.calls || 0)),
    toolCallCount: Math.max(ordered.length, Number(activeTask?.toolCallCount || activeTask?.calls || 0)),
    successfulToolCallCount: Number(activeTask?.successfulToolCallCount || Math.max(0, ordered.filter(entry => entry.ok !== false).length)),
    failedToolCallCount: Math.max(failures, Number(activeTask?.failedToolCallCount || 0)),
    activeCalls: Number(activeTask?.activeCalls || 0),
    failures,
    changedFiles,
    changedFileCount: changedFiles.length,
    validation,
    committed: ordered.some(entry => entry.tool === 'relai_git_commit' && entry.ok !== false),
    pushed: ordered.some(entry => entry.tool === 'relai_git_push' && entry.ok !== false),
    prDrafted: ordered.some(entry => entry.tool === 'relai_git_draft_pr' && entry.ok !== false),
    lastTool: activeTask?.lastTool || activeTask?.tool || last.tool || '',
    operation: activeTask?.operation || activeTask?.lastOperation || completionEvent?.operation || last.operation || operationForTool(last.tool),
    lastOutcome: activeTask?.lastOutcome || (last.ok === false ? 'failed' : 'succeeded'),
    currentOperations: Array.isArray(activeTask?.currentOperations) ? activeTask.currentOperations : [],
    events: mergeEvents(ordered, activeTask?.events || []).slice(-200)
  };
}

function activeTaskFromActivity(activity) {
  const taskId = activity.id || activity.taskId;
  const startedAt = activity.startedAtIso || activity.createdAt || new Date(activity.startedAt || Date.now()).toISOString();
  return {
    id: taskId,
    taskId,
    sessionId: activity.sessionId || taskId,
    title: activity.title || operationForTool(activity.lastTool || activity.tool) || 'Rel.AI workspace task',
    objective: activity.objective || '',
    status: activity.status || normalizeLiveTaskStatus(activity.state, activity),
    progress: activity.progress || { mode: 'indeterminate', label: 'Progress unavailable' },
    currentStage: activity.currentStage || '',
    currentActivity: activity.currentActivity || activity.operation || activity.lastOperation || '',
    completionKnown: activity.completionKnown === true,
    endReason: null,
    summary: activity.summary || '',
    workspace: activity.workspace || '',
    startedAt,
    endedAt: null,
    completedAt: null,
    durationMs: Math.max(0, Date.now() - Date.parse(startedAt)),
    calls: Number(activity.calls || activity.activeCalls || 1),
    toolCallCount: Number(activity.toolCallCount || activity.calls || activity.activeCalls || 1),
    successfulToolCallCount: Number(activity.successfulToolCallCount || 0),
    failedToolCallCount: Number(activity.failedToolCallCount || activity.failures || 0),
    activeCalls: Number(activity.activeCalls || 0),
    failures: Number(activity.failures || 0),
    changedFiles: [],
    changedFileCount: 0,
    validation: 'not_run',
    committed: false,
    pushed: false,
    prDrafted: false,
    lastTool: activity.lastTool || activity.tool || '',
    operation: activity.operation || activity.lastOperation || operationForTool(activity.lastTool || activity.tool),
    lastOutcome: activity.lastOutcome || '',
    currentOperations: Array.isArray(activity.currentOperations) ? activity.currentOperations : [],
    events: Array.isArray(activity.events) ? activity.events : []
  };
}


function titleFromEvents(events) {
  const operation = [...events].reverse().find(event => event.operation)?.operation;
  if (operation && !/^(task|request|tool call|mcp operation)$/i.test(operation)) return operation;
  const workspace = events.find(event => event.workspace)?.workspace;
  return workspace ? `Historical task in ${workspace}` : 'Historical Rel.AI task';
}

function mergeEvents(auditEvents, activityEvents) {
  const events = [];
  const ids = new Map();
  for (const event of [...auditEvents, ...(Array.isArray(activityEvents) ? activityEvents : [])]) {
    const id = eventIdentityKey(event, events.length);
    if (ids.has(id)) events[ids.get(id)] = { ...events[ids.get(id)], ...event };
    else {
      ids.set(id, events.length);
      events.push(event);
    }
  }
  return events.sort((left, right) => Number(left?.sequence || 0) - Number(right?.sequence || 0) || eventTimestampMs(left) - eventTimestampMs(right));
}

function validationSummary(events) {
  const explicit = [...events].reverse().find(entry => entry.validationStatus === 'not_required');
  if (explicit) return 'not_required';
  const checks = events.filter(entry => entry.tool === 'relai_run_checks');
  if (!checks.length) return 'not_run';
  const latest = checks.at(-1);
  if (latest.ok === false || latest.validationStatus === 'failed') return 'failed';
  if (latest.validationStatus === 'not_run') return 'not_run';
  return latest.validationStatus === 'passed' ? 'passed' : 'not_run';
}

function eventChangedFiles(entry) {
  const values = [];
  if (Array.isArray(entry.changedFiles)) values.push(...entry.changedFiles);
  if (Array.isArray(entry.sessionChangedFiles)) values.push(...entry.sessionChangedFiles);
  if (entry.filePath) values.push(entry.filePath);
  return values.map(String).filter(Boolean);
}

function groupTaskEntries(entries) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isCurrentTaskEvent(entry)) continue;
    const taskId = String(entry.taskId).trim();
    if (!groups.has(taskId)) groups.set(taskId, []);
    groups.get(taskId).push(entry);
  }
  return groups;
}

export { buildTaskHistory };
