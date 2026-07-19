'use strict';

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const DEFAULT_TASK_IDLE_MS = 5 * 60_000;
const activityContext = new AsyncLocalStorage();

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
    if (!task) task = reconnectWaitingTask(scopeId, details, startedAt);
    if (!task) {
      task = createTask(scopeId, details, startedAt);
      tasksByScope.set(scopeId, task);
    }
    cancelCompletion(task);

    const connectorCall = details.connector !== false;
    const operationId = crypto.randomUUID();
    const operation = {
      id: operationId,
      tool: String(details.tool || ''),
      label: String(details.operation || defaultOperation(details.tool)),
      detail: String(details.detail || ''),
      workspace: String(details.workspace || task.workspace || ''),
      startedAt
    };

    task.workspace = operation.workspace;
    task.lastTool = operation.tool;
    task.lastOperation = operation.label;
    task.lastOutcome = '';
    task.activeCalls += 1;
    task.calls += 1;
    task.lastActivityAt = startedAt;
    task.currentOperations.set(operationId, operation);
    activeToolCalls += 1;
    if (connectorCall) activeConnectorCalls += 1;

    notify('started', task, {
      tool: operation.tool,
      workspace: operation.workspace,
      operation: operation.label,
      operationId
    });

    let finish;
    const requestCompletion = (completion = {}) => {
      if (finished) throw new Error('Cannot complete a session after the tool call has finished.');
      if (task.activeCalls !== 1) {
        throw new Error('Cannot complete the session while another Rel.AI tool call is still active.');
      }
      task.completionRequest = {
        summary: String(completion.summary || '').trim(),
        validationStatus: String(completion.validationStatus || 'passed'),
        validationLevel: String(completion.validationLevel || ''),
        validationAt: String(completion.validationAt || ''),
        changedFiles: Array.isArray(completion.changedFiles) ? completion.changedFiles.map(String).filter(Boolean).slice(0, 200) : []
      };
      return { taskId: task.id, scopeId: task.scopeId };
    };
    const update = (patch = {}) => {
      if (finished) return;
      const current = task.currentOperations.get(operationId);
      if (!current) return;
      if (patch.operation != null) current.label = String(patch.operation);
      if (patch.detail != null) current.detail = String(patch.detail);
      if (patch.workspace != null) current.workspace = String(patch.workspace);
      if (patch.tool != null) current.tool = String(patch.tool);
      task.workspace = current.workspace || task.workspace;
      task.lastTool = current.tool || task.lastTool;
      task.lastOperation = current.label || task.lastOperation;
      task.lastActivityAt = now();
      finish.operation = task.lastOperation;
      notify('progress', task, {
        tool: current.tool,
        workspace: current.workspace,
        operation: current.label,
        detail: current.detail,
        operationId
      });
    };

    finish = (result = {}) => {
      if (finished) return;
      finished = true;
      const finishedAt = now();
      const current = task.currentOperations.get(operationId) || operation;
      task.currentOperations.delete(operationId);
      task.activeCalls = Math.max(0, task.activeCalls - 1);
      task.failures += result.ok === false ? 1 : 0;
      task.lastTool = current.tool || task.lastTool;
      task.workspace = current.workspace || task.workspace;
      task.lastOperation = current.label || task.lastOperation;
      task.lastOutcome = result.ok === false ? 'failed' : 'succeeded';
      task.lastActivityAt = finishedAt;
      activeToolCalls = Math.max(0, activeToolCalls - 1);
      if (connectorCall) activeConnectorCalls = Math.max(0, activeConnectorCalls - 1);
      finish.operation = task.lastOperation;

      notify('finished', task, {
        tool: task.lastTool,
        workspace: task.workspace,
        operation: task.lastOperation,
        operationId,
        ok: result.ok !== false,
        error: String(result.error || ''),
        durationMs: Math.max(0, finishedAt - startedAt)
      });
      if (result.ok === false) task.completionRequest = null;
      if (task.activeCalls === 0) {
        if (task.completionRequest) completeTask(task.scopeId, task.id);
        else scheduleInactivity(task);
      }
    };

    finish.taskId = task.id;
    finish.scopeId = scopeId;
    finish.operationId = operationId;
    finish.operation = operation.label;
    finish.update = update;
    finish.requestCompletion = requestCompletion;
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
      lastOperation: String(details.operation || defaultOperation(details.tool)),
      lastOutcome: '',
      completionRequest: null,
      startedAt: timestamp,
      lastActivityAt: timestamp,
      completionTimer: null,
      currentOperations: new Map()
    };
  }

  function reconnectWaitingTask(scopeId, details, timestamp) {
    const workspace = String(details.workspace || '').trim();
    if (!workspace) return null;
    const candidates = [...tasksByScope.values()].filter(task =>
      task.activeCalls === 0 &&
      task.workspace === workspace &&
      timestamp >= task.lastActivityAt &&
      timestamp - task.lastActivityAt <= idleMs
    );
    if (candidates.length !== 1) return null;
    const task = candidates[0];
    cancelCompletion(task);
    tasksByScope.delete(task.scopeId);
    task.scopeId = scopeId;
    tasksByScope.set(scopeId, task);
    return task;
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

  function scheduleInactivity(task) {
    cancelCompletion(task);
    task.completionTimer = setTimer(() => closeInactiveSession(task.scopeId, task.id), idleMs);
    task.completionTimer?.unref?.();
  }

  function closeInactiveSession(scopeId, taskId) {
    const task = tasksByScope.get(scopeId);
    if (!task || task.id !== taskId || task.activeCalls > 0) return;
    task.completionTimer = null;
    tasksByScope.delete(scopeId);
    const endedAt = now();
    lastTask = {
      taskId: task.id,
      id: task.id,
      status: task.failures > 0 ? 'attention' : 'inactive',
      endReason: 'inactivity_window',
      calls: task.calls,
      failures: task.failures,
      workspace: task.workspace,
      lastTool: task.lastTool,
      operation: task.lastOperation,
      lastOutcome: task.lastOutcome,
      startedAt: task.startedAt,
      endedAt,
      completedAt: endedAt,
      durationMs: Math.max(0, endedAt - task.startedAt)
    };
    notify('inactive', task, { task: lastTask, endReason: lastTask.endReason });
  }

  function completeTask(scopeId, taskId) {
    const task = tasksByScope.get(scopeId);
    if (!task || task.id !== taskId || task.activeCalls > 0 || !task.completionRequest) return;
    cancelCompletion(task);
    tasksByScope.delete(scopeId);
    const completedAt = now();
    const completion = task.completionRequest;
    lastTask = {
      taskId: task.id,
      id: task.id,
      status: 'completed',
      completionKnown: true,
      endReason: 'explicit_completion',
      summary: completion.summary,
      validationStatus: completion.validationStatus,
      validationLevel: completion.validationLevel,
      validationAt: completion.validationAt,
      changedFiles: completion.changedFiles,
      calls: task.calls,
      failures: task.failures,
      workspace: task.workspace,
      lastTool: task.lastTool,
      operation: task.lastOperation,
      lastOutcome: task.lastOutcome,
      startedAt: task.startedAt,
      endedAt: completedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - task.startedAt)
    };
    notify('completed', task, { task: lastTask, endReason: lastTask.endReason });
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
      state: tasks.length ? (activeToolCalls > 0 ? 'working' : 'waiting') : 'idle',
      completionKnown: false,
      activeConnectorCalls,
      activeCalls: activeToolCalls,
      activeTaskCount: tasks.length,
      tasks,
      taskId: primary?.id || lastTask?.taskId || '',
      calls: primary?.calls || 0,
      failures: primary?.failures || 0,
      workspace: tasks.length === 1 ? primary?.workspace || '' : '',
      tool: primary?.lastTool || '',
      operation: primary?.operation || '',
      startedAt: primary?.startedAt || null,
      lastTask
    };
  }

  function taskSnapshot(task) {
    const currentOperations = [...task.currentOperations.values()]
      .map(item => ({ ...item }))
      .sort((left, right) => left.startedAt - right.startedAt);
    const current = currentOperations[0] || null;
    return {
      id: task.id,
      taskId: task.id,
      scopeId: task.scopeId,
      state: task.activeCalls > 0 ? 'working' : 'waiting',
      completionKnown: false,
      activeCalls: task.activeCalls,
      calls: task.calls,
      failures: task.failures,
      workspace: task.workspace,
      tool: current?.tool || task.lastTool,
      lastTool: task.lastTool,
      operation: current?.label || task.lastOperation,
      lastOperation: task.lastOperation,
      lastOutcome: task.lastOutcome,
      currentOperations,
      startedAt: task.startedAt,
      lastActivityAt: task.lastActivityAt
    };
  }

  function notify(phase, task, extras = {}) {
    const status = getToolActivity();
    const snapshot = Object.freeze({
      phase,
      activeConnectorCalls,
      activeCalls: status.activeCalls,
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

function runWithToolActivity(activity, callback) {
  if (!activity || typeof callback !== 'function') return callback();
  return activityContext.run(activity, callback);
}

function updateCurrentToolActivity(details = {}) {
  const activity = activityContext.getStore();
  activity?.update?.(details);
}

function requestCurrentTaskCompletion(details = {}) {
  const activity = activityContext.getStore();
  if (!activity?.requestCompletion) {
    throw new Error('Task completion is only available inside an active Rel.AI tool call.');
  }
  return activity.requestCompletion(details);
}

function getCurrentToolActivityContext() {
  const activity = activityContext.getStore();
  if (!activity) return null;
  return {
    taskId: activity.taskId || '',
    scopeId: activity.scopeId || '',
    operationId: activity.operationId || '',
    operation: activity.operation || ''
  };
}

function defaultOperation(tool) {
  const value = String(tool || '').replace(/^relai_/, '').replaceAll('_', ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Using Rel.AI';
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
  resetToolActivity: defaultTracker.reset,
  runWithToolActivity,
  updateCurrentToolActivity,
  requestCurrentTaskCompletion,
  getCurrentToolActivityContext
};
