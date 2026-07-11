'use strict';

function buildTaskHistory(entries = [], activity = {}, options = {}) {
  const limit = clamp(options.limit || 100, 1, 500);
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const taskId = String(entry.taskId || legacyTaskId(entry));
    if (!groups.has(taskId)) groups.set(taskId, []);
    groups.get(taskId).push(entry);
  }

  const activeTasks = activityTasks(activity);
  const activeById = new Map(activeTasks.map(task => [task.id || task.taskId, task]));
  const tasks = [...groups.entries()].map(([taskId, events]) => summarizeTask(taskId, events, activeById.get(taskId)));
  for (const active of activeTasks) {
    const taskId = active.id || active.taskId;
    if (taskId && !groups.has(taskId)) tasks.push(activeTaskFromActivity(active));
  }
  return tasks
    .sort((left, right) => Date.parse(right.completedAt || right.startedAt || 0) - Date.parse(left.completedAt || left.startedAt || 0))
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
  const completedMs = Math.max(...ordered.map(entry => (Date.parse(entry.ts || '') || startedMs) + Math.max(0, Number(entry.ms || 0))));
  const changedFiles = unique(ordered.flatMap(eventChangedFiles));
  const failures = Math.max(ordered.filter(entry => entry.ok === false).length, Number(activeTask?.failures || 0));
  const validation = validationSummary(ordered);
  return {
    id: taskId,
    status: activeTask ? activeTask.state || 'working' : failures ? 'attention' : 'completed',
    workspace: activeTask?.workspace || ordered.find(entry => entry.workspace)?.workspace || '',
    startedAt: new Date(startedMs).toISOString(),
    completedAt: activeTask ? null : new Date(completedMs).toISOString(),
    durationMs: activeTask ? Math.max(0, Date.now() - startedMs) : Math.max(0, completedMs - startedMs),
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
    events: ordered.slice(-100)
  };
}

function activeTaskFromActivity(activity) {
  const taskId = activity.id || activity.taskId;
  return {
    id: taskId,
    status: activity.state || 'working',
    workspace: activity.workspace || '',
    startedAt: new Date(activity.startedAt || Date.now()).toISOString(),
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
    events: []
  };
}

function validationSummary(events) {
  const checks = events.filter(entry => entry.tool === 'relai_run_checks');
  if (!checks.length) return 'not_run';
  if (checks.some(entry => entry.ok === false || entry.validationStatus === 'failed')) return 'failed';
  return 'passed';
}

function eventChangedFiles(entry) {
  const values = [];
  if (Array.isArray(entry.changedFiles)) values.push(...entry.changedFiles);
  if (Array.isArray(entry.sessionChangedFiles)) values.push(...entry.sessionChangedFiles);
  if (entry.filePath) values.push(entry.filePath);
  return values.map(String).filter(Boolean);
}

function legacyTaskId(entry) {
  return `legacy-${entry.ts || 'unknown'}-${entry.pid || 0}-${entry.tool || 'event'}`;
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
