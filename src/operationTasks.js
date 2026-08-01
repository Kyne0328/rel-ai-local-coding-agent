import {
  cancelNativeTask,
  completeNativeTask,
  createNativeTask,
  failNativeTask,
  getNativeTaskRecord,
  nativeTaskSignal,
  pruneNativeTasks,
  updateNativeTask
} from './mcp/nativeTaskService.js';

const TASK_TTL_MS = 24 * 60 * 60 * 1000;

function createOperationTask(config, options = {}) {
  const controller = new AbortController();
  const created = createNativeTask(config, {
    method: options.method,
    name: options.name,
    logicalTaskId: options.logicalTaskId,
    principal: options.principal,
    ttlMs: TASK_TTL_MS,
    pollIntervalMs: 1000,
    statusMessage: options.message || 'Operation started.',
    restartPolicy: 'non_resumable',
    executor: { controller },
    internal: {
      compatibilityOperation: true,
      workspace: String(options.workspace || ''),
      progress: 0,
      message: String(options.message || 'Operation started.')
    }
  });
  return operationView(getNativeTaskRecord(config, created.taskId));
}

function updateOperationTask(config, taskId, patch = {}) {
  const current = getNativeTaskRecord(config, taskId);
  if (isTerminal(current.status)) return operationView(current);
  if (patch.status === 'completed') {
    completeNativeTask(config, taskId, patch.result, { statusMessage: patch.message || 'Operation completed.' });
  } else if (patch.status === 'failed') {
    failNativeTask(config, taskId, patch.error || 'Operation failed.', { statusMessage: patch.message || 'Operation failed.' });
  } else if (patch.status === 'cancelled') {
    cancelNativeTask(config, taskId, { statusMessage: patch.message || 'Operation cancelled.' });
  } else {
    updateNativeTask(config, taskId, {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.message != null ? { statusMessage: patch.message } : {}),
      internal: {
        ...(patch.progress != null ? { progress: clampProgress(patch.progress) } : {}),
        ...(patch.message != null ? { message: String(patch.message).slice(0, 2000) } : {})
      }
    });
  }
  return operationView(getNativeTaskRecord(config, taskId));
}

function completeOperationTask(config, taskId, result) {
  completeNativeTask(config, taskId, result, { statusMessage: 'Operation completed.' });
  return operationView(getNativeTaskRecord(config, taskId));
}

function failOperationTask(config, taskId, error) {
  failNativeTask(config, taskId, error, { statusMessage: 'Operation failed.' });
  return operationView(getNativeTaskRecord(config, taskId));
}

function cancelOperationTask(config, taskId) {
  cancelNativeTask(config, taskId, { statusMessage: 'Operation cancelled.' });
  return operationView(getNativeTaskRecord(config, taskId));
}

function getOperationTask(config, taskId) {
  return operationView(getNativeTaskRecord(config, taskId));
}

function operationTaskSignal(_config, taskId) {
  return nativeTaskSignal(taskId);
}

function assertOperationTaskPrincipal(config, taskId, principal) {
  return operationView(getNativeTaskRecord(config, taskId, { principal }));
}

function assertOperationTaskLogicalOwner(config, taskId, logicalTaskId) {
  try {
    return operationView(getNativeTaskRecord(config, taskId, { logicalTaskId }));
  } catch {
    throw new Error('Operation task belongs to a different logical task or is unavailable.');
  }
}

function pruneOperationTasks(config) {
  return pruneNativeTasks(config);
}

function operationView(task) {
  const internal = task.internal || {};
  return {
    taskId: task.taskId,
    status: task.status,
    method: String(task.origin?.method || ''),
    name: String(task.origin?.name || ''),
    workspace: String(internal.workspace || ''),
    createdAt: task.createdAt,
    updatedAt: task.lastUpdatedAt,
    progress: task.status === 'completed' ? 1 : clampProgress(internal.progress),
    message: String(task.statusMessage || internal.message || ''),
    ...(task.status === 'completed' ? { result: task.result } : {}),
    ...(task.status === 'failed' ? { error: task.error?.message || 'Operation failed.' } : {}),
    cancelRequested: task.cancelRequested === true || task.status === 'cancelled'
  };
}

function clampProgress(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function isTerminal(status) {
  return ['completed', 'failed', 'cancelled'].includes(status);
}

export {
  assertOperationTaskLogicalOwner,
  assertOperationTaskPrincipal,
  cancelOperationTask,
  completeOperationTask,
  createOperationTask,
  failOperationTask,
  getOperationTask,
  operationTaskSignal,
  pruneOperationTasks,
  updateOperationTask
};
