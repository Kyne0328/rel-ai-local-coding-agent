'use strict';

const { getCurrentToolActivityContext, taskError } = require('../toolActivity');
const { readTaskHistorySession } = require('../taskHistoryStore');
const { isTerminalTaskStatus } = require('../taskState');

function startTask(workspace, args = {}) {
  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Rel.AI could not create a logical task for this request.');
  }
  return {
    ok: true,
    workspace: workspace.alias,
    task_id: context.taskId,
    status: 'planning',
    identity: 'logical_task',
    title: String(args.title || context.title || '').trim() || undefined,
    objective: String(args.objective || context.objective || '').trim() || undefined,
    nextAction: 'Pass this task_id on every subsequent Rel.AI tool call for this task, including relai_complete_task.'
  };
}

function assertKnownTask(config, taskId, workspace, toolName) {
  const session = readTaskHistorySession(config, taskId);
  if (!session) {
    throw taskError('TASK_NOT_FOUND', 'The supplied task_id is unknown or expired. Start a new logical task with relai_start_task.');
  }
  if (session.status === 'cancelled' && toolName === 'relai_cancel_task') return session;
  if (['completed', 'completed_with_warnings'].includes(session.status) && toolName === 'relai_complete_task') return session;
  if (isTerminalTaskStatus(session.status)) {
    throw taskError('INVALID_TASK_STATE', `This logical task is already ${session.status}. Start a new task instead of reusing its task_id.`);
  }
  const requestedWorkspace = String(workspace || '').trim();
  const ownedWorkspace = String(session.workspace || '').trim();
  if (requestedWorkspace && ownedWorkspace && requestedWorkspace !== ownedWorkspace) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The supplied task_id belongs to a different workspace.');
  }
  return session;
}

function taskAuditContext(context, activity, requestedTaskId, toolName, ok, value = null) {
  const duplicateCompletion = toolName === 'relai_complete_task' && value?.duplicate === true;
  const duplicateCancellation = toolName === 'relai_cancel_task' && value?.duplicate === true;
  const taskId = activity?.taskId || requestedTaskId || '';
  const taskHistoryEligible = Boolean(taskId && (requestedTaskId || toolName === 'relai_start_task'));
  return {
    taskId,
    scopeId: activity?.scopeId || '',
    operationId: activity?.operationId || '',
    requestId: context?.requestId == null ? '' : String(context.requestId),
    serverInstanceId: String(context?.serverInstanceId || ''),
    transportType: String(context?.transportType || ''),
    transportSessionId: String(context?.transportSessionId || ''),
    clientName: String(context?.clientName || ''),
    clientVersion: String(context?.clientVersion || ''),
    initializationRequestId: context?.initializationRequestId == null ? '' : String(context.initializationRequestId),
    taskIdentityVersion: taskHistoryEligible ? 2 : 0,
    taskIdExplicit: taskHistoryEligible,
    taskHistoryEligible,
    duplicateRequest: duplicateCompletion || duplicateCancellation,
    eventType: toolName === 'relai_start_task'
      ? (ok ? 'task.started' : 'task.start.rejected')
      : toolName === 'relai_complete_task'
        ? (ok ? (duplicateCompletion ? 'task.completion.duplicate' : 'task.completion.committed') : 'task.completion.rejected')
        : toolName === 'relai_cancel_task'
          ? (ok ? (duplicateCancellation ? 'task.cancellation.duplicate' : 'task.cancellation.committed') : 'task.cancellation.rejected')
          : 'tool.call.completed'
  };
}

function withTaskIdentity(value, taskId) {
  const identity = String(taskId || '').trim();
  if (!identity) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value, task_id: identity };
  return { ok: true, value, task_id: identity };
}

module.exports = { startTask, assertKnownTask, taskAuditContext, withTaskIdentity };
