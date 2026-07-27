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
  const tasksById = new Map();
  const listeners = new Set();
  let activeToolCalls = 0;
  let activeConnectorCalls = 0;
  let lastTask = null;

  function beginConnectorToolCall(details = {}) {
    if (details.trackTask === false) return beginObservedToolCall(details);
    let finished = false;
    const startedAt = now();
    const scopeId = resolveScopeId(details);
    const requestedTaskId = normalizeTaskId(details.taskId);
    let task;

    if (details.createTask === true) {
      task = createTask(scopeId, details, startedAt);
      tasksById.set(task.id, task);
    } else {
      if (!requestedTaskId) {
        throw taskError('TASK_ID_REQUIRED', 'Task-scoped tool calls require the exact task_id returned by relai_start_task.');
      }
      task = tasksById.get(requestedTaskId);
      if (!task) {
        task = createTask(scopeId, details, startedAt, requestedTaskId);
        tasksById.set(task.id, task);
      } else if (scopeId) {
        task.scopeId = scopeId;
      }
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
      if (finished) throw taskError('INVALID_TASK_STATE', 'Cannot complete a task after the tool call has finished.');
      if (task.completionRequest) {
        return { taskId: task.id, scopeId: task.scopeId, duplicate: true };
      }
      const conflicting = [...task.currentOperations.values()].filter(item =>
        item.id !== operationId && item.tool !== 'relai_complete_task'
      );
      if (conflicting.length > 0) {
        throw taskError(
          'TASK_COMPLETION_IN_PROGRESS',
          'Cannot complete this task while another operation for the same task is still active.',
          { retryable: true }
        );
      }
      task.completionRequest = {
        summary: String(completion.summary || '').trim(),
        validationStatus: String(completion.validationStatus || 'passed'),
        validationLevel: String(completion.validationLevel || ''),
        validationAt: String(completion.validationAt || ''),
        changedFiles: Array.isArray(completion.changedFiles) ? completion.changedFiles.map(String).filter(Boolean).slice(0, 200) : []
      };
      notify('completion_requested', task, {
        tool: operation.tool,
        workspace: operation.workspace,
        operation: operation.label,
        operationId
      });
      return { taskId: task.id, scopeId: task.scopeId, duplicate: false };
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
      if (result.ok === false && current.tool === 'relai_complete_task') task.completionRequest = null;
      if (task.activeCalls === 0) {
        if (task.completionRequest) completeTask(task.id);
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

  function beginObservedToolCall(details = {}) {
    let finished = false;
    const startedAt = now();
    const connectorCall = details.connector !== false;
    const scopeId = resolveScopeId(details);
    const operationId = crypto.randomUUID();
    const operation = {
      id: operationId,
      tool: String(details.tool || ''),
      label: String(details.operation || defaultOperation(details.tool)),
      detail: String(details.detail || ''),
      workspace: String(details.workspace || ''),
      startedAt
    };

    activeToolCalls += 1;
    if (connectorCall) activeConnectorCalls += 1;
    notifyObserved('started', {
      scopeId,
      tool: operation.tool,
      workspace: operation.workspace,
      operation: operation.label,
      operationId
    });

    let finish;
    const update = (patch = {}) => {
      if (finished) return;
      if (patch.operation != null) operation.label = String(patch.operation);
      if (patch.detail != null) operation.detail = String(patch.detail);
      if (patch.workspace != null) operation.workspace = String(patch.workspace);
      if (patch.tool != null) operation.tool = String(patch.tool);
      finish.operation = operation.label;
      notifyObserved('progress', {
        scopeId,
        tool: operation.tool,
        workspace: operation.workspace,
        operation: operation.label,
        detail: operation.detail,
        operationId
      });
    };

    finish = (result = {}) => {
      if (finished) return;
      finished = true;
      const finishedAt = now();
      activeToolCalls = Math.max(0, activeToolCalls - 1);
      if (connectorCall) activeConnectorCalls = Math.max(0, activeConnectorCalls - 1);
      finish.operation = operation.label;
      notifyObserved('finished', {
        scopeId,
        tool: operation.tool,
        workspace: operation.workspace,
        operation: operation.label,
        operationId,
        ok: result.ok !== false,
        error: String(result.error || ''),
        durationMs: Math.max(0, finishedAt - startedAt)
      });
    };

    finish.taskId = '';
    finish.scopeId = scopeId;
    finish.operationId = operationId;
    finish.operation = operation.label;
    finish.update = update;
    finish.requestCompletion = () => {
      throw taskError('TASK_ID_REQUIRED', 'Task completion requires an explicit task_id returned by relai_start_task.');
    };
    return finish;
  }

  function createTask(scopeId, details, timestamp, requestedTaskId = '') {
    const id = requestedTaskId || crypto.randomUUID();
    return {
      id,
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

  function removeTask(task) {
    tasksById.delete(task.id);
  }

  function resolveScopeId(details) {
    const explicit = String(details.scopeId || '').trim();
    if (explicit) return explicit;
    const workspace = String(details.workspace || '').trim();
    if (workspace) return `workspace:${workspace}`;
    return 'connector:default';
  }

  function scheduleInactivity(task) {
    cancelCompletion(task);
    task.completionTimer = setTimer(() => closeInactiveSession(task.id), idleMs);
    task.completionTimer?.unref?.();
  }

  function closeInactiveSession(taskId) {
    const task = tasksById.get(taskId);
    if (!task || task.activeCalls > 0) return;
    task.completionTimer = null;
    removeTask(task);
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

  function completeTask(taskId) {
    const task = tasksById.get(taskId);
    if (!task || task.activeCalls > 0 || !task.completionRequest) return;
    cancelCompletion(task);
    removeTask(task);
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
    const tasks = [...tasksById.values()]
      .map(taskSnapshot)
      .sort((left, right) => left.startedAt - right.startedAt);
    const primary = tasks.find(task => task.activeCalls > 0) || tasks[0] || null;
    return {
      state: activeToolCalls > 0 ? 'working' : tasks.length ? 'waiting' : 'idle',
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
    emitActivity({
      phase,
      taskId: task.id,
      scopeId: task.scopeId,
      taskActiveCalls: task.activeCalls,
      taskCalls: task.calls,
      taskFailures: task.failures,
      ...extras
    });
  }

  function notifyObserved(phase, extras = {}) {
    emitActivity({
      phase,
      taskId: '',
      taskActiveCalls: 0,
      taskCalls: 0,
      taskFailures: 0,
      ...extras
    });
  }

  function emitActivity(extras = {}) {
    const status = getToolActivity();
    const snapshot = Object.freeze({
      activeConnectorCalls,
      activeCalls: status.activeCalls,
      activeTaskCount: status.activeTaskCount,
      tasks: status.tasks,
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
    for (const task of tasksById.values()) cancelCompletion(task);
    tasksById.clear();
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
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Task completion is only available inside an active Rel.AI tool call.');
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

function taskError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.source = 'rel-ai-mcp';
  error.operation = 'task_resolution';
  error.retryable = details.retryable === true;
  error.requiresUserConfirmation = false;
  error.allowedAlternatives = [
    'Call relai_start_task once for each independent task.',
    'Pass the returned task_id on every subsequent task-scoped tool call.'
  ];
  if (Number.isFinite(details.candidateCount)) error.candidateCount = Number(details.candidateCount);
  return error;
}

function normalizeTaskId(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  const hasControlCharacter = [...id].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (id.length > 200 || hasControlCharacter) {
    throw taskError('TASK_NOT_FOUND', 'The supplied task_id is invalid.');
  }
  return id;
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
  getCurrentToolActivityContext,
  taskError,
  normalizeTaskId
};
