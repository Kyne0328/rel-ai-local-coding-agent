import { CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import {
  cancelNativeTask,
  createNativeTask,
  getNativeTask,
  updateNativeTaskInputs,
  updateNativeTaskRecovery
} from './mcp/nativeTaskService.js';
import {
  MISSING_TASKS_CAPABILITY_CODE,
  TASK_METHODS,
  TASKS_EXTENSION_ID
} from './mcp/protocol.js';

const PROBE_TOOL_NAME = 'relai_native_tasks_probe';
const DEFAULT_DURATION_MS = 5000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 30000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const TASK_TTL_MS = 10 * 60 * 1000;

function clientSupportsNativeTasks(capabilities) {
  const extensions = capabilities?.extensions;
  return Boolean(extensions && Object.hasOwn(extensions, TASKS_EXTENSION_ID));
}

function clientCapabilitiesFromMessage(message) {
  return message?.params?._meta?.[CLIENT_CAPABILITIES_META_KEY] || {};
}

function nativeTasksProbeFallback(_config, _args = {}, context = {}) {
  const error = new Error('Missing required client capability: io.modelcontextprotocol/tasks');
  error.code = MISSING_TASKS_CAPABILITY_CODE;
  error.data = requiredTasksCapability();
  error.clientAdvertisedTasks = clientSupportsNativeTasks(context.clientCapabilities || {});
  throw error;
}

function expectedNativeTaskName(method, params = {}) {
  return TASK_METHODS.includes(String(method || '')) ? String(params.taskId || '') : '';
}

function handleNativeTasksRequest(config, message, principal = '') {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const method = String(message.method || '');
  const isProbe = method === 'tools/call' && message.params?.name === PROBE_TOOL_NAME;
  const isTaskMethod = TASK_METHODS.includes(method);
  if (!isProbe && !isTaskMethod) return null;

  const capabilities = clientCapabilitiesFromMessage(message);
  if (!clientSupportsNativeTasks(capabilities)) {
    return errorResponse(
      message.id,
      MISSING_TASKS_CAPABILITY_CODE,
      'Missing required client capability',
      requiredTasksCapability()
    );
  }

  try {
    if (isProbe) return createProbeResponse(config, message, principal);
    const taskId = String(message.params?.taskId || '');
    if (method === 'tasks/get') {
      return successResponse(message.id, { resultType: 'complete', ...getNativeTask(config, taskId, { principal }) });
    }
    if (method === 'tasks/update') {
      updateNativeTaskInputs(config, taskId, message.params?.inputResponses, { principal });
      return successResponse(message.id, { resultType: 'complete' });
    }
    cancelNativeTask(config, taskId, {
      principal,
      immediate: true,
      statusMessage: 'Native MCP task cancelled by the client.'
    });
    return successResponse(message.id, { resultType: 'complete' });
  } catch (error) {
    return taskErrorResponse(message.id, error);
  }
}

function createProbeResponse(config, message, principal) {
  const args = normalizeProbeArguments(message.params?.arguments);
  const now = Date.now();
  const completion = {
    content: [{
      type: 'text',
      text: 'Native MCP Tasks probe completed. The client retrieved the final tool result through tasks/get.'
    }],
    structuredContent: {
      ok: true,
      nativeTasksProbe: true,
      extensionId: TASKS_EXTENSION_ID,
      durationMs: args.durationMs
    },
    isError: false
  };
  const task = createNativeTask(config, {
    principal,
    method: 'tools/call',
    name: PROBE_TOOL_NAME,
    restartPolicy: 'restart_reconcilable',
    ttlMs: TASK_TTL_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    statusMessage: `${args.label} is running.`,
    recovery: {
      mode: 'deadline',
      completeAtMs: now + args.durationMs,
      statusMessage: 'Native MCP Tasks probe completed.'
    }
  });
  completion.structuredContent.taskId = task.taskId;
  updateNativeTaskRecovery(config, task.taskId, {
    mode: 'deadline',
    completeAtMs: now + args.durationMs,
    statusMessage: 'Native MCP Tasks probe completed.',
    result: completion
  }, { principal });
  return successResponse(message.id, { resultType: 'task', ...task });
}

function normalizeProbeArguments(value) {
  const args = value == null ? {} : value;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalidTaskRequest('Probe arguments must be an object.');
  const allowed = new Set(['durationMs', 'label']);
  const unknown = Object.keys(args).filter(key => !allowed.has(key));
  if (unknown.length) throw invalidTaskRequest(`Unknown probe argument: ${unknown[0]}`);
  const durationMs = args.durationMs == null ? DEFAULT_DURATION_MS : Number(args.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw invalidTaskRequest(`durationMs must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}.`);
  }
  const label = String(args.label || '').trim().slice(0, 120) || 'ChatGPT native MCP Tasks probe';
  return { durationMs: Math.round(durationMs), label };
}

function requiredTasksCapability() {
  return { requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } };
}

function taskErrorMessage(error) {
  if (error?.code === 'NATIVE_TASK_UNAVAILABLE') return 'Invalid task ID or task is not available to this client.';
  if (error?.code === 'NATIVE_TASK_INVALID_REQUEST') return error.message;
  return 'Native task request failed.';
}

function taskErrorResponse(id, error) {
  if (error?.code === 'NATIVE_TASK_UNAVAILABLE' || error?.code === 'NATIVE_TASK_INVALID_REQUEST') {
    return errorResponse(id, -32602, taskErrorMessage(error));
  }
  if (error?.code === 'NATIVE_TASK_STORE_ERROR') {
    const corrupt = error.reason === 'record_corrupt';
    return errorResponse(id, -32603, corrupt ? 'Native task record is corrupt.' : 'Native task storage is unavailable.', {
      reason: corrupt ? 'task_record_corrupt' : 'task_store_unavailable',
      retryable: error.retryable !== false
    });
  }
  return errorResponse(id, -32603, 'Native task request failed.', {
    reason: 'internal_error',
    retryable: true
  });
}

function invalidTaskRequest(message) {
  const error = new Error(message);
  error.code = 'NATIVE_TASK_INVALID_REQUEST';
  return error;
}

function successResponse(id, result) {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, result } };
}

function errorResponse(id, code, message, data) {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data === undefined ? {} : { data }) }
    }
  };
}

export {
  PROBE_TOOL_NAME,
  TASKS_EXTENSION_ID,
  clientCapabilitiesFromMessage,
  clientSupportsNativeTasks,
  expectedNativeTaskName,
  handleNativeTasksRequest,
  nativeTasksProbeFallback
};
