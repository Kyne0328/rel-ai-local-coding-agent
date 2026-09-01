import {
  completeNativeTask,
  createNativeTask,
  failNativeTask,
  nativeTaskSignal,
  pruneNativeTasks,
  retryNativeTaskOperation
} from './nativeTaskService.js';

// Tool calls may legally run for 24 hours. Keep the durable task record alive
// beyond that execution ceiling so queue/startup/response overhead cannot outlive it.
const TOOL_TASK_TTL_MS = 25 * 60 * 60 * 1000;

function createNativeToolTask(config, options = {}) {
  const controller = new AbortController();
  return createNativeTask(config, {
    method: options.method,
    name: options.name,
    logicalTaskId: options.logicalTaskId,
    principal: options.principal,
    ttlMs: TOOL_TASK_TTL_MS,
    pollIntervalMs: 1000,
    statusMessage: options.message || 'Tool execution started.',
    restartPolicy: 'non_resumable',
    executor: { controller },
    internal: {
      workspace: String(options.workspace || '')
    }
  });
}

function completeNativeToolTask(config, taskId, result) {
  return retryNativeTaskOperation(() => completeNativeTask(config, taskId, result, {
    statusMessage: 'Tool execution completed.'
  }));
}

function failNativeToolTask(config, taskId, error) {
  return retryNativeTaskOperation(() => failNativeTask(config, taskId, error, {
    statusMessage: 'Tool execution failed.'
  }));
}

function nativeToolTaskSignal(taskId) {
  return nativeTaskSignal(taskId);
}

function pruneNativeToolTasks(config) {
  return retryNativeTaskOperation(() => pruneNativeTasks(config));
}

export {
  completeNativeToolTask,
  createNativeToolTask,
  failNativeToolTask,
  nativeToolTaskSignal,
  pruneNativeToolTasks
};
