'use strict';

const { DEFAULT_TASK_IDLE_MS } = require('./toolActivity');

function buildTaskHistory(entries = [], activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, 500);
  const groups = groupTaskEntries(entries, options.legacyGapMs);
  const activeTasks = activityTasks(activity);
  const activeById = new Map(activeTasks.map(task => [task.id || task.taskId, task]));
  const tasks = [...groups.entries()].map(([taskId, events]) => summarizeTask(taskId, events, activeById.get(taskId)));
  for (const active of activeTasks) {
    const taskId = active.id || active.taskId;
    if (taskId && !groups.has(taskId)) tasks.push(activeTaskFromActivity(active));
  }
  return tasks
    .sort((left, right) => Date.parse(right.endedAt || right.completedAt || right.startedAt || 0) - Date.parse(left.endedAt || left.completedAt || left.startedAt || 0))
    .slice(0, limit);
}

function activityTasks(activity) {
  if (Array.isArray(activity?.tasks)) return activity.tasks;
  if (Array.isArray(activity?.activeTasks)) return activity.activeTasks;
  if (activity?.taskId && activity.state !== 'idle') return [activity];
  return [];
}

function summarizeTask(taskId, events, activeTask) {
  const ordered = [...events].sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0));
  const first = ordered[0] || {};
  const last = ordered.at(-1) || first;
  const startedMs = Date.parse(first.ts || '') || Number(activeTask?.startedAt) || Date.now();
  const endedMs = Math.max(...ordered.map(entry => (Date.parse(entry.ts || '') || startedMs) + Math.max(0, Number(entry.ms || 0))));
  const changedFiles = unique(ordered.flatMap(eventChangedFiles));
  const failures = Math.max(ordered.filter(entry => entry.ok === false).length, Number(activeTask?.failures || 0));
  const validation = validationSummary(ordered);
  const completionEvent = [...ordered].reverse().find(entry =>
    entry.ok !== false && (entry.completionKnown === true || entry.tool === 'relai_complete_task')
  ) || null;
  const endedAt = activeTask ? null : new Date(endedMs).toISOString();
  return {
    id: taskId,
    status: activeTask ? normalizeActiveState(activeTask.state) : completionEvent ? 'completed' : failures ? 'attention' : 'inactive',
    completionKnown: activeTask?.completionKnown === true || Boolean(completionEvent),
    endReason: activeTask ? null : completionEvent ? 'explicit_completion' : 'inactivity_window',
    summary: activeTask?.summary || completionEvent?.taskSummary || '',
    workspace: activeTask?.workspace || ordered.find(entry => entry.workspace)?.workspace || '',
    startedAt: new Date(startedMs).toISOString(),
    endedAt,
    completedAt: endedAt,
    durationMs: activeTask ? Math.max(0, Date.now() - startedMs) : Math.max(0, endedMs - startedMs),
    calls: Math.max(ordered.length, Number(activeTask?.calls || 0)),
    activeCalls: Number(activeTask?.activeCalls || 0),
    failures,
    changedFiles,
    changedFileCount: changedFiles.length,
    validation,
    committed: ordered.some(entry => entry.tool === 'relai_git_commit' && entry.ok !== false),
    pushed: ordered.some(entry => entry.tool === 'relai_git_push' && entry.ok !== false),
    prDrafted: ordered.some(entry => entry.tool === 'relai_git_create_pr' && entry.ok !== false),
    lastTool: activeTask?.lastTool || activeTask?.tool || last.tool || '',
    operation: activeTask?.operation || activeTask?.lastOperation || completionEvent?.operation || last.operation || operationForTool(last.tool),
    lastOutcome: activeTask?.lastOutcome || (last.ok === false ? 'failed' : 'succeeded'),
    currentOperations: Array.isArray(activeTask?.currentOperations) ? activeTask.currentOperations : [],
    events: ordered.slice(-100)
  };
}

function activeTaskFromActivity(activity) {
  const taskId = activity.id || activity.taskId;
  return {
    id: taskId,
    status: normalizeActiveState(activity.state),
    completionKnown: activity.completionKnown === true,
    endReason: null,
    summary: activity.summary || '',
    workspace: activity.workspace || '',
    startedAt: new Date(activity.startedAt || Date.now()).toISOString(),
    endedAt: null,
    completedAt: null,
    durationMs: Math.max(0, Date.now() - Number(activity.startedAt || Date.now())),
    calls: Number(activity.calls || activity.activeCalls || 1),
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
    events: []
  };
}

function normalizeActiveState(state) {
  if (state === 'settling') return 'waiting';
  if (state === 'working' || state === 'waiting') return state;
  return 'waiting';
}

function validationSummary(events) {
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

function groupTaskEntries(entries, legacyGapMs = DEFAULT_TASK_IDLE_MS) {
  const groups = new Map();
  const legacyByProcess = new Map();
  const gapMs = clamp(legacyGapMs, 15_000, 10 * 60_000);
  const ordered = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && typeof entry === 'object')
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
  const taskAliases = completionTaskAliases(ordered);

  for (const entry of ordered) {
    const explicitTaskId = String(entry.taskId || '').trim();
    let taskId = taskAliases.get(explicitTaskId) || explicitTaskId;
    if (!taskId) {
      const processKey = String(entry.pid || 'unknown');
      const timestamp = eventTimestamp(entry);
      let legacy = legacyByProcess.get(processKey);
      if (!legacy || timestamp < legacy.lastAt || timestamp - legacy.lastAt > gapMs) {
        legacy = {
          id: `legacy-${processKey}-${Number.isFinite(timestamp) ? timestamp : groups.size}`,
          lastAt: timestamp
        };
        legacyByProcess.set(processKey, legacy);
      } else {
        legacy.lastAt = Math.max(legacy.lastAt, timestamp);
      }
      taskId = legacy.id;
    }
    if (!groups.has(taskId)) groups.set(taskId, []);
    groups.get(taskId).push(entry);
  }
  return groups;
}

function completionTaskAliases(entries) {
  const aliases = new Map();
  for (const entry of entries) {
    if (entry?.tool !== 'relai_complete_task' || entry.ok === false) continue;
    const canonical = String(entry.validationTaskId || entry.taskId || '').trim();
    if (!canonical) continue;
    const related = Array.isArray(entry.relatedTaskIds) ? entry.relatedTaskIds : [];
    for (const taskId of [entry.taskId, ...related]) {
      const value = String(taskId || '').trim();
      if (value) aliases.set(value, canonical);
    }
  }
  return aliases;
}

function eventTimestamp(entry) {
  const value = Date.parse(entry?.ts || entry?.at || entry?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
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

module.exports = { buildTaskHistory };
