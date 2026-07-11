'use strict';

const crypto = require('node:crypto');

const DEFAULT_TASK_IDLE_MS = 60_000;

function createToolActivityTracker(options = {}) {
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const idleMs = resolveIdleMs(options.idleMs);
  const tasksByScope = new Map();
  const listeners = new Set();
  let activeToolCalls = 0;
  let activeConnectorCalls = 0;
  let lastTask = null;

  function beginConnectorToolCall(details = {}) {
    let finished = false;
    const startedAt = now();
    const scopeId = resolveScopeId(details);
    let task = tasksByScope.get(scopeId);
    if (!task) {
      task = createTask(scopeId, details, startedAt);
      tasksByScope.set(scopeId, task);
    }
    cancelCompletion(task);
    task.workspace = String(details.workspace || task.workspace || '');
    task.lastTool = String(details.tool || task.lastTool || '');
    task.activeCalls += 1;
    task.calls += 1;
    task.lastActivityAt = startedAt;
    activeToolCalls += 1;
    const connectorCall = details.connector !== false;
    if (connectorCall) activeConnectorCalls += 1;
    notify('started', task, {
      tool: task.lastTool,
      workspace: task.workspace
    });

    const finish = (result = {}) => {
      if (finished) return;
      finished = true;
      const finishedAt = now();
      task.activeCalls = Math.max(0, task.activeCalls - 1);
      task.failures += result.ok === false ? 1 : 0;
      task.lastTool = String(details.tool || task.lastTool || '');
      task.workspace = String(details.workspace || task.workspace || '');
      task.lastActivityAt = finishedAt;
      activeToolCalls = Math.max(0, activeToolCalls - 1);
      if (connectorCall) activeConnectorCalls = Math.max(0, activeConnectorCalls - 1);
      notify('finished', task, {
        tool: task.lastTool,
        workspace: task.workspace,
        ok: result.ok !== false,
        error: String(result.error || ''),
        durationMs: Math.max(0, finishedAt - startedAt)
      });
      if (task.activeCalls === 0) scheduleCompletion(task);
    };
    finish.taskId = task.id;
    finish.scopeId = scopeId;
    return finish;
  }

  function createTask(scopeId, details, timestamp) {
    return {
      id: crypto.randomUUID(),
      scopeId,
      activeCalls: 0,
      calls: 0,
      failures: 0,
      workspace: String(details.workspace || ''),
      lastTool: String(details.tool || ''),
      startedAt: timestamp,
      lastActivityAt: timestamp,
      completionTimer: null
    };
  }

  function resolveScopeId(details) {
    const explicit = String(details.scopeId || '').trim();
    if (explicit) return explicit;
    const workspace = String(details.workspace || '').trim();
    if (workspace) {
      const matching = [...tasksByScope.values()].filter(task => task.workspace === workspace);
      if (matching.length === 1) return matching[0].scopeId;
      const unassigned = [...tasksByScope.values()].filter(task => !task.workspace);
      if (tasksByScope.size === 1 && unassigned.length === 1) return unassigned[0].scopeId;
      return `workspace:${workspace}`;
    }
    if (tasksByScope.size === 1) return tasksByScope.keys().next().value;
    return 'connector:default';
  }

  function scheduleCompletion(task) {
    cancelCompletion(task);
    task.completionTimer = setTimer(() => completeTask(task.scopeId, task.id), idleMs);
    task.completionTimer?.unref?.();
  }

  function completeTask(scopeId, taskId) {
    const task = tasksByScope.get(scopeId);
    if (!task || task.id !== taskId || task.activeCalls > 0) return;
    task.completionTimer = null;
    tasksByScope.delete(scopeId);
    const completedAt = now();
    lastTask = {
      taskId: task.id,
      id: task.id,
      status: task.failures > 0 ? 'attention' : 'completed',
      calls: task.calls,
      failures: task.failures,
      workspace: task.workspace,
      lastTool: task.lastTool,
      startedAt: task.startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - task.startedAt)
    };
    notify('completed', task, { task: lastTask });
  }

  function cancelCompletion(task) {
    if (task.completionTimer == null) return;
    clearTimer(task.completionTimer);
    task.completionTimer = null;
  }

  function onToolActivity(listener) {
    if (typeof listener !== 'function') throw new TypeError('Tool activity listener must be a function.');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getToolActivity() {
    const tasks = [...tasksByScope.values()]
      .map(taskSnapshot)
      .sort((left, right) => left.startedAt - right.startedAt);
    const primary = tasks.find(task => task.activeCalls > 0) || tasks[0] || null;
    return {
      state: tasks.length ? (activeToolCalls > 0 ? 'working' : 'settling') : 'idle',
      activeConnectorCalls,
      activeCalls: activeToolCalls,
      activeTaskCount: tasks.length,
      tasks,
      taskId: primary?.id || lastTask?.taskId || '',
      calls: primary?.calls || 0,
      failures: primary?.failures || 0,
      workspace: tasks.length === 1 ? primary?.workspace || '' : '',
      tool: primary?.lastTool || '',
      startedAt: primary?.startedAt || null,
      lastTask
    };
  }

  function taskSnapshot(task) {
    return {
      id: task.id,
      taskId: task.id,
      scopeId: task.scopeId,
      state: task.activeCalls > 0 ? 'working' : 'settling',
      activeCalls: task.activeCalls,
      calls: task.calls,
      failures: task.failures,
      workspace: task.workspace,
      tool: task.lastTool,
      lastTool: task.lastTool,
      startedAt: task.startedAt,
      lastActivityAt: task.lastActivityAt
    };
  }

  function notify(phase, task, extras = {}) {
    const status = getToolActivity();
    const snapshot = Object.freeze({
      phase,
      activeConnectorCalls,
      activeTaskCount: status.activeTaskCount,
      tasks: status.tasks,
      taskId: task.id,
      scopeId: task.scopeId,
      taskActiveCalls: task.activeCalls,
      taskCalls: task.calls,
      taskFailures: task.failures,
      ...extras
    });
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] tool activity listener:', error);
      }
    }
  }

  function reset() {
    for (const task of tasksByScope.values()) cancelCompletion(task);
    tasksByScope.clear();
    activeToolCalls = 0;
    activeConnectorCalls = 0;
    lastTask = null;
  }

  return {
    beginConnectorToolCall,
    onToolActivity,
    getToolActivity,
    reset,
    idleMs
  };
}

function resolveIdleMs(value) {
  const configured = Number(value ?? process.env.REL_AI_MCP_TASK_IDLE_MS ?? DEFAULT_TASK_IDLE_MS);
  if (!Number.isFinite(configured)) return DEFAULT_TASK_IDLE_MS;
  return Math.min(Math.max(configured, 15_000), 10 * 60_000);
}

const defaultTracker = createToolActivityTracker();

module.exports = {
  DEFAULT_TASK_IDLE_MS,
  createToolActivityTracker,
  beginConnectorToolCall: defaultTracker.beginConnectorToolCall,
  onToolActivity: defaultTracker.onToolActivity,
  getToolActivity: defaultTracker.getToolActivity,
  resetToolActivity: defaultTracker.reset
};
