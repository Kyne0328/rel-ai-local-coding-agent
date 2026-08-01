
import * as crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  buildToolActivityDetails,
  completeProgress,
  createActivityEvent,
  deriveTaskTitle,
  normalizeTaskProgress,
  sanitizeActivityEventRecord,
  sanitizeActivityMetadata,
  sanitizeCompletionSummary,
  sanitizeDisplayText,
  sanitizeTaskRecord
} from './taskObservability.js';
import { isTerminalTaskStatus, normalizeHistoricalTaskStatus } from './taskState.js';
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
    const initialActivity = buildToolActivityDetails(
      String(details.tool || ''),
      details.input || {},
      null,
      null,
      { operation: details.operation, phase: 'running', metadata: details.metadata }
    );
    const operation = {
      id: operationId,
      tool: String(details.tool || ''),
      label: String(details.operation || initialActivity.title || defaultOperation(details.tool)),
      detail: String(details.detail || initialActivity.summary || ''),
      workspace: String(details.workspace || task.workspace || ''),
      startedAt,
      activity: createActivityEvent({
        eventId: operationId,
        operationId,
        taskId: task.id,
        sequence: ++task.sequence,
        startedAt,
        ...initialActivity,
        tool: { name: String(details.tool || ''), operation: String(details.operation || initialActivity.title || '') }
      })
    };

    if (task.titleSource === 'fallback' && details.tool !== 'relai_start_task') {
      task.title = deriveTaskTitle({
        tool: details.tool,
        operation: details.operation,
        workspace: details.workspace,
        ...(details.input || {})
      });
      task.titleSource = 'operation';
    }
    task.workspace = operation.workspace;
    task.correlation = mergeCorrelation(task.correlation, details.correlation, operation.workspace);
    task.lastTool = operation.tool;
    task.lastOperation = operation.label;
    task.lastOutcome = '';
    task.activeCalls += 1;
    task.calls += 1;
    task.lastActivityAt = startedAt;
    task.updatedAt = startedAt;
    const controlCall = operation.tool === 'relai_cancel_task';
    if (!controlCall) {
      task.status = initialActivity.category === 'validation' ? 'validating' : 'running';
      task.currentStage = initialActivity.currentStage || operation.label;
      task.currentActivity = initialActivity.currentActivity || operation.detail;
      task.progress = normalizeTaskProgress(initialActivity.progress, task.status);
    }
    task.currentOperations.set(operationId, operation);
    task.events.push(operation.activity);
    if (task.events.length > 200) task.events.splice(0, task.events.length - 200);
    activeToolCalls += 1;
    if (connectorCall) activeConnectorCalls += 1;

    notify('started', task, {
      tool: operation.tool,
      workspace: operation.workspace,
      operation: operation.label,
      operationId,
      activityEvent: cloneActivityEvent(operation.activity)
    });

    let finish;
    const requestCompletion = (completion = {}) => {
      if (finished) throw taskError('INVALID_TASK_STATE', 'Cannot complete a task after the tool call has finished.');
      if (isTerminalTaskStatus(task.status)) throw taskError('INVALID_TASK_STATE', 'Cannot complete a terminal task.');
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
        summary: sanitizeCompletionSummary(completion.summary, 2000),
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
      if (!current || isTerminalTaskStatus(task.status)) return;
      if (patch.operation != null) current.label = sanitizeDisplayText(patch.operation, 200);
      if (patch.detail != null) current.detail = sanitizeDisplayText(patch.detail, 500);
      if (patch.summary != null) current.detail = sanitizeDisplayText(patch.summary, 500);
      if (patch.workspace != null) current.workspace = sanitizeDisplayText(patch.workspace, 200);
      if (patch.tool != null) current.tool = sanitizeDisplayText(patch.tool, 200);
      applyActivityPatch(current.activity, patch.activity && typeof patch.activity === 'object' ? patch.activity : patch);
      task.workspace = current.workspace || task.workspace;
      task.lastTool = current.tool || task.lastTool;
      task.lastOperation = current.label || task.lastOperation;
      task.lastActivityAt = now();
      task.updatedAt = task.lastActivityAt;
      task.currentStage = sanitizeDisplayText(patch.currentStage || current.activity?.title || task.currentStage || 'Running tool', 500);
      task.currentActivity = sanitizeDisplayText(patch.currentActivity || current.activity?.summary || current.detail || task.currentActivity || '', 500);
      if (patch.status) {
        const nextStatus = patch.status === 'blocked' ? 'waiting_for_approval' : normalizeHistoricalTaskStatus(patch.status, task);
        if (!isTerminalTaskStatus(task.status)) task.status = nextStatus;
      }
      if (patch.progress) task.progress = normalizeTaskProgress(patch.progress, task.status);
      finish.operation = task.lastOperation;
      notify('progress', task, {
        tool: current.tool,
        workspace: current.workspace,
        operation: current.label,
        detail: current.detail,
        operationId,
        activityEvent: cloneActivityEvent(current.activity)
      });
    };

    finish = (result = {}) => {
      if (finished) return;
      finished = true;
      const finishedAt = now();
      const current = task.currentOperations.get(operationId) || operation;
      const terminalBeforeFinish = isTerminalTaskStatus(task.status);
      task.currentOperations.delete(operationId);
      task.activeCalls = Math.max(0, task.activeCalls - 1);
      task.lastTool = current.tool || task.lastTool;
      task.workspace = current.workspace || task.workspace;
      task.lastOperation = current.label || task.lastOperation;
      task.lastActivityAt = finishedAt;
      task.updatedAt = finishedAt;
      const completionActivity = result.activity && typeof result.activity === 'object'
        ? result.activity
        : buildToolActivityDetails(current.tool, {}, null, result.ok === false ? { message: result.error } : null, {
            operation: current.label,
            phase: 'complete'
          });
      applyActivityPatch(current.activity, completionActivity);
      current.activity.status = terminalBeforeFinish && task.status === 'cancelled' && current.tool !== 'relai_cancel_task'
        ? 'cancelled'
        : result.ok === false
          ? (completionActivity.status || 'failed')
          : (completionActivity.status === 'blocked' ? 'blocked' : 'succeeded');
      const blockedResult = current.activity.status === 'blocked';
      const validationStatus = String(current.activity?.metadata?.validationStatus || '');
      const recoverableValidationFailure = current.tool === 'relai_run_checks' && ['failed', 'not_run'].includes(validationStatus);
      if (!terminalBeforeFinish && result.ok === false && !blockedResult && !recoverableValidationFailure) task.failures += 1;
      if (!terminalBeforeFinish) task.lastOutcome = blockedResult ? 'blocked' : result.ok === false ? 'failed' : 'succeeded';
      current.activity.completedAt = new Date(finishedAt).toISOString();
      current.activity.durationMs = Math.max(0, finishedAt - startedAt);
      const queueWaitMs = Number(current.activity?.metadata?.waitMs || 0);
      if (queueWaitMs > 0 && !/waited\s/i.test(current.activity.summary || '')) {
        current.activity.summary = `${current.activity.summary || 'Operation completed.'} Waited ${formatWait(queueWaitMs)} for the workspace execution queue.`;
      }
      if (!terminalBeforeFinish) {
        task.currentStage = completionActivity.currentStage || task.currentStage;
        task.currentActivity = completionActivity.currentActivity || current.activity.summary || task.currentActivity;
        task.progress = normalizeTaskProgress(completionActivity.progress || task.progress, task.status);
        task.successes += result.ok === false ? 0 : 1;
        task.errorSummary = result.ok === false && !blockedResult
          ? sanitizeDisplayText(result.error || current.activity.error?.message || '', 500)
          : '';
      }
      if (!terminalBeforeFinish && task.activeCalls === 0 && !task.completionRequest) {
        if (recoverableValidationFailure) {
          task.status = 'validation_failed';
          task.currentStage = 'Validation failed';
          task.progress = normalizeTaskProgress({
            ...task.progress,
            percentage: Math.min(99, Number(task.progress?.percentage ?? 99)),
            label: 'Fix issues and revalidate'
          }, task.status);
        } else if (current.activity.status === 'blocked') {
          const blockedCode = String(current.activity?.error?.code || current.activity?.metadata?.errorCode || '');
          const validationRequired = /VALIDATION_REQUIRED|TASK_PERSISTENCE_CONFLICT/.test(blockedCode);
          task.status = validationRequired ? 'blocked' : 'waiting_for_approval';
          task.currentStage = validationRequired ? 'Validation required' : 'Waiting for approval';
          task.progress = {
            mode: 'indeterminate',
            label: validationRequired ? 'Final validation required' : 'Approval required'
          };
        } else {
          task.status = 'planning';
          const preserveWorkflowProgress = task.progress?.mode === 'determinate';
          if (!preserveWorkflowProgress) {
            task.currentStage = 'Planning next step';
            task.progress = { mode: 'indeterminate', label: 'Waiting for the next task step' };
          }
        }
      }
      activeToolCalls = Math.max(0, activeToolCalls - 1);
      if (connectorCall) activeConnectorCalls = Math.max(0, activeConnectorCalls - 1);
      finish.operation = task.lastOperation;
      if (terminalBeforeFinish) lastTask = buildTerminalTaskSnapshot(task);

      notify('finished', task, {
        tool: task.lastTool,
        workspace: task.workspace,
        operation: task.lastOperation,
        operationId,
        ok: result.ok !== false,
        error: String(result.error || ''),
        durationMs: Math.max(0, finishedAt - startedAt),
        activityEvent: cloneActivityEvent(current.activity)
      });
      if (result.ok === false && current.tool === 'relai_complete_task') task.completionRequest = null;
      if (task.activeCalls === 0) {
        if (isTerminalTaskStatus(task.status)) {
          lastTask = buildTerminalTaskSnapshot(task);
          removeTask(task);
        } else if (task.completionRequest) completeTask(task.id);
        else scheduleInactivity(task);
      }
    };

    finish.taskId = task.id;
    finish.scopeId = scopeId;
    finish.operationId = operationId;
    finish.operation = operation.label;
    finish.update = update;
    finish.requestCompletion = requestCompletion;
    finish.signal = task.abortController.signal;
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
    const explicitTitle = String(details.title || '').trim();
    return {
      id,
      scopeId,
      title: deriveTaskTitle({
        title: explicitTitle,
        objective: details.objective,
        tool: details.tool,
        operation: details.operation,
        workspace: details.workspace,
        ...(details.input || {})
      }),
      titleSource: explicitTitle ? 'explicit' : details.objective ? 'objective' : details.tool === 'relai_start_task' ? 'fallback' : 'operation',
      objective: sanitizeDisplayText(details.objective, 500),
      correlation: compactCorrelation(details.correlation, details.workspace),
      status: 'planning',
      progress: { mode: 'indeterminate', label: 'Planning task' },
      currentStage: 'Planning',
      currentActivity: String(details.operation || ''),
      activeCalls: 0,
      calls: 0,
      successes: 0,
      failures: 0,
      sequence: 0,
      events: [],
      errorSummary: '',
      workspace: String(details.workspace || ''),
      lastTool: String(details.tool || ''),
      lastOperation: String(details.operation || defaultOperation(details.tool)),
      lastOutcome: '',
      completionRequest: null,
      abortController: new AbortController(),
      endReason: '',
      terminalReason: '',
      endedAt: null,
      cancelledAt: null,
      cancellationInitiator: '',
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      completionTimer: null,
      currentOperations: new Map()
    };
  }

  function removeTask(task) {
    tasksById.delete(task.id);
  }

  function cancelTask(taskId, details = {}) {
    const id = normalizeTaskId(taskId);
    const task = tasksById.get(id);
    if (!task) {
      if (lastTask?.taskId === id && lastTask.status === 'cancelled') {
        return cancellationResult(lastTask, true);
      }
      throw taskError('TASK_NOT_FOUND', 'The supplied task_id is not an active cancellable task.');
    }
    if (task.status === 'cancelled') return cancellationResult(buildTerminalTaskSnapshot(task), true);
    if (isTerminalTaskStatus(task.status)) throw taskError('INVALID_TASK_STATE', `Task ${id} is already ${task.status}.`);

    cancelCompletion(task);
    const endedAt = now();
    const reason = sanitizeDisplayText(details.reason || 'Task cancelled by request.', 500) || 'Task cancelled by request.';
    task.status = 'cancelled';
    task.endReason = 'explicit_cancellation';
    task.terminalReason = reason;
    task.endedAt = endedAt;
    task.cancelledAt = endedAt;
    task.cancellationInitiator = sanitizeDisplayText(details.initiator || 'client', 80) || 'client';
    task.currentStage = 'Cancelled';
    task.currentActivity = reason;
    task.lastOutcome = 'cancelled';
    task.lastActivityAt = endedAt;
    task.updatedAt = endedAt;
    task.completionRequest = null;
    for (const operation of task.currentOperations.values()) {
      if (operation.tool === 'relai_cancel_task') continue;
      operation.activity.status = 'cancelled';
      operation.activity.summary = sanitizeDisplayText(`${operation.activity.summary || operation.label || 'Operation'} Cancelled: ${reason}`, 500);
      operation.activity.completedAt = new Date(endedAt).toISOString();
      operation.activity.durationMs = Math.max(0, endedAt - operation.startedAt);
    }
    if (!task.abortController.signal.aborted) task.abortController.abort(new Error(reason));
    lastTask = buildTerminalTaskSnapshot(task);
    notify('cancelled', task, {
      task: lastTask,
      endReason: task.endReason,
      terminalReason: reason,
      initiator: task.cancellationInitiator
    });
    if (task.activeCalls === 0) removeTask(task);
    return cancellationResult(lastTask, false);
  }

  function cancellationResult(task, duplicate) {
    return {
      taskId: task.taskId || task.id,
      status: 'cancelled',
      duplicate,
      endReason: task.endReason || 'explicit_cancellation',
      terminalReason: task.terminalReason || task.currentActivity || 'Task cancelled.',
      endedAt: task.endedAt || null,
      cancelledAt: task.cancelledAt || task.endedAt || null,
      progress: normalizeTaskProgress(task.progress, 'cancelled')
    };
  }

  function buildTerminalTaskSnapshot(task) {
    const endedAt = Number(task.endedAt || now());
    return sanitizeTaskRecord({
      ...taskSnapshot(task),
      state: 'ended',
      status: task.status,
      completionKnown: task.status === 'completed',
      endReason: task.endReason || (task.status === 'cancelled' ? 'explicit_cancellation' : 'terminal'),
      terminalReason: task.terminalReason || task.currentActivity,
      cancellationInitiator: task.cancellationInitiator || undefined,
      endedAt,
      cancelledAt: task.cancelledAt || undefined,
      completedAt: task.status === 'completed' ? endedAt : undefined,
      updatedAt: new Date(task.updatedAt || endedAt).toISOString(),
      durationMs: Math.max(0, endedAt - task.startedAt)
    });
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
    const unresolvedFailure = task.lastOutcome === 'failed';
    const status = unresolvedFailure ? 'failed' : 'cancelled';
    lastTask = sanitizeTaskRecord({
      taskId: task.id,
      sessionId: task.id,
      id: task.id,
      title: task.title,
      objective: task.objective,
      status,
      progress: normalizeTaskProgress(task.progress, status),
      currentStage: unresolvedFailure ? 'Failed after inactivity' : 'Cancelled after inactivity',
      currentActivity: task.currentActivity,
      endReason: 'inactivity_window',
      calls: task.calls,
      toolCallCount: task.calls,
      successfulToolCallCount: task.successes,
      failedToolCallCount: task.failures,
      failures: task.failures,
      workspace: task.workspace,
      lastTool: task.lastTool,
      operation: task.lastOperation,
      lastOutcome: task.lastOutcome,
      errorSummary: task.errorSummary,
      correlation: { ...task.correlation },
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt,
      startedAtIso: new Date(task.startedAt).toISOString(),
      updatedAt: new Date(endedAt).toISOString(),
      endedAt,
      completedAt: endedAt,
      completedAtIso: new Date(endedAt).toISOString(),
      durationMs: Math.max(0, endedAt - task.startedAt),
      terminalReason: unresolvedFailure ? 'Task became inactive after an unrecovered failure.' : 'Task was cancelled after the inactivity window elapsed.',
      events: task.events.map(cloneActivityEvent)
    });
    notify(status, task, { task: lastTask, endReason: lastTask.endReason });
  }

  function completeTask(taskId) {
    const task = tasksById.get(taskId);
    if (!task || task.activeCalls > 0 || !task.completionRequest) return;
    cancelCompletion(task);
    removeTask(task);
    const completedAt = now();
    const completion = task.completionRequest;
    const status = 'completed';
    lastTask = sanitizeTaskRecord({
      taskId: task.id,
      sessionId: task.id,
      id: task.id,
      title: task.title,
      objective: task.objective,
      status,
      progress: completeProgress('Task completed'),
      currentStage: 'Completed',
      currentActivity: completion.summary || task.currentActivity,
      completionKnown: true,
      endReason: 'explicit_completion',
      summary: completion.summary,
      resultSummary: completion.summary,
      validationStatus: completion.validationStatus,
      validationLevel: completion.validationLevel,
      validationAt: completion.validationAt,
      changedFiles: completion.changedFiles,
      calls: task.calls,
      toolCallCount: task.calls,
      successfulToolCallCount: task.successes,
      failedToolCallCount: task.failures,
      failures: task.failures,
      workspace: task.workspace,
      lastTool: task.lastTool,
      operation: task.lastOperation,
      lastOutcome: task.lastOutcome,
      errorSummary: task.errorSummary,
      correlation: { ...task.correlation },
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt,
      startedAtIso: new Date(task.startedAt).toISOString(),
      updatedAt: new Date(completedAt).toISOString(),
      endedAt: completedAt,
      completedAt,
      completedAtIso: new Date(completedAt).toISOString(),
      durationMs: Math.max(0, completedAt - task.startedAt),
      terminalReason: 'Task completion was accepted explicitly.',
      events: task.events.map(cloneActivityEvent)
    });
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
    return sanitizeTaskRecord({
      id: task.id,
      taskId: task.id,
      sessionId: task.id,
      scopeId: task.scopeId,
      title: task.title,
      objective: task.objective,
      status: task.status,
      state: task.activeCalls > 0 ? 'working' : 'waiting',
      progress: normalizeTaskProgress(task.progress, task.status),
      currentStage: task.currentStage,
      currentActivity: task.currentActivity,
      completionKnown: false,
      activeCalls: task.activeCalls,
      calls: task.calls,
      toolCallCount: task.calls,
      successfulToolCallCount: task.successes,
      failedToolCallCount: task.failures,
      failures: task.failures,
      workspace: task.workspace,
      tool: current?.tool || task.lastTool,
      lastTool: task.lastTool,
      operation: current?.label || task.lastOperation,
      lastOperation: task.lastOperation,
      lastOutcome: task.lastOutcome,
      errorSummary: task.errorSummary,
      correlation: { ...task.correlation },
      currentOperations,
      events: task.events.map(cloneActivityEvent),
      createdAt: new Date(task.createdAt).toISOString(),
      startedAt: task.startedAt,
      startedAtIso: new Date(task.startedAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
      lastActivityAt: task.lastActivityAt,
      endReason: task.endReason || undefined,
      terminalReason: task.terminalReason || undefined,
      endedAt: task.endedAt || undefined,
      cancelledAt: task.cancelledAt || undefined,
      cancellationInitiator: task.cancellationInitiator || undefined
    });
  }

  function notify(phase, task, extras = {}) {
    emitActivity({
      phase,
      taskId: task.id,
      scopeId: task.scopeId,
      taskActiveCalls: task.activeCalls,
      taskCalls: task.calls,
      taskFailures: task.failures,
      task: taskSnapshot(task),
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
    for (const task of tasksById.values()) {
      cancelCompletion(task);
      if (!task.abortController.signal.aborted) task.abortController.abort(new Error('Task tracker reset.'));
    }
    tasksById.clear();
    activeToolCalls = 0;
    activeConnectorCalls = 0;
    lastTask = null;
  }

  return {
    beginConnectorToolCall,
    cancelTask,
    onToolActivity,
    getToolActivity,
    reset,
    idleMs
  };
}

function applyActivityPatch(activity, patch = {}) {
  if (!activity || !patch || typeof patch !== 'object') return activity;
  for (const key of ['category', 'action', 'status', 'title', 'summary', 'target', 'result', 'error']) {
    if (patch[key] !== undefined) activity[key] = patch[key];
  }
  if (patch.metadata !== undefined) {
    activity.metadata = {
      ...(activity.metadata || {}),
      ...(sanitizeActivityMetadata(patch.metadata) || {})
    };
  }
  if (patch.tool && typeof patch.tool === 'object') activity.tool = { ...(activity.tool || {}), ...patch.tool };
  activity.timestamp = new Date().toISOString();
  Object.assign(activity, sanitizeActivityEventRecord(activity));
  return activity;
}

function compactCorrelation(value = {}, workspace = '') {
  return Object.fromEntries(Object.entries({
    requestId: sanitizeDisplayText(value?.requestId, 200),
    traceId: sanitizeDisplayText(value?.traceId, 200),
    workspaceId: sanitizeDisplayText(value?.workspaceId || workspace, 200),
    conversationId: sanitizeDisplayText(value?.conversationId, 200)
  }).filter(([, item]) => item));
}

function mergeCorrelation(current = {}, incoming = {}, workspace = '') {
  return { ...compactCorrelation(incoming, workspace), ...current };
}

function formatWait(waitMs) {
  return waitMs < 1000 ? `${Math.max(0, Math.round(waitMs))} ms` : `${(waitMs / 1000).toFixed(1)} seconds`;
}

function cloneActivityEvent(activity) {
  if (!activity) return null;
  return JSON.parse(JSON.stringify(sanitizeActivityEventRecord(activity)));
}

function runWithToolActivity(activity, callback) {
  if (!activity || typeof callback !== 'function') return callback();
  return activityContext.run(activity, callback);
}

function updateCurrentToolActivity(details = {}) {
  const activity = activityContext.getStore();
  activity?.update?.(details);
}

function requestCurrentTaskCancellation(details = {}) {
  const activity = activityContext.getStore();
  if (!activity?.taskId) {
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Task cancellation is only available inside an active task-scoped Rel.AI tool call.');
  }
  return defaultTracker.cancelTask(activity.taskId, details);
}

function getCurrentTaskAbortSignal() {
  return activityContext.getStore()?.signal;
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
  error.allowedAlternatives = Array.isArray(details.allowedAlternatives)
    ? details.allowedAlternatives.map(String).filter(Boolean)
    : [
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
const beginConnectorToolCall = defaultTracker.beginConnectorToolCall;
const cancelTask = defaultTracker.cancelTask;
const onToolActivity = defaultTracker.onToolActivity;
const getToolActivity = defaultTracker.getToolActivity;
const resetToolActivity = defaultTracker.reset;

export {
  DEFAULT_TASK_IDLE_MS,
  createToolActivityTracker,
  beginConnectorToolCall,
  cancelTask,
  onToolActivity,
  getToolActivity,
  resetToolActivity,  runWithToolActivity,
  updateCurrentToolActivity,
  requestCurrentTaskCancellation,
  requestCurrentTaskCompletion,
  getCurrentTaskAbortSignal,
  getCurrentToolActivityContext,
  taskError,
  normalizeTaskId
};
