import {
  completeNativeTask,
  createNativeTask,
  failNativeTask,
  nativeTaskSignal,
  pruneNativeTasks
} from './nativeTaskService.js';

const TOOL_TASK_TTL_MS = 24 * 60 * 60 * 1000;

// Compatibility policy: Rel.AI 0.24.0 stops writing internal.compatibilityOperation.
// Native Task schema v1 continues accepting that unknown internal field on old records.
// Tool tasks expire after at most 24 hours, so no compatibility-specific handling is
// required after the first release published at least 24 hours after 0.24.0.
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
  return completeNativeTask(config, taskId, result, {
    statusMessage: 'Tool execution completed.'
  });
}

function failNativeToolTask(config, taskId, error) {
  return failNativeTask(config, taskId, error, {
    statusMessage: 'Tool execution failed.'
  });
}

function nativeToolTaskSignal(taskId) {
  return nativeTaskSignal(taskId);
}

function pruneNativeToolTasks(config) {
  return pruneNativeTasks(config);
}

export {
  completeNativeToolTask,
  createNativeToolTask,
  failNativeToolTask,
  nativeToolTaskSignal,
  pruneNativeToolTasks
};
