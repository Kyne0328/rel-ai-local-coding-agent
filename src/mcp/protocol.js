import {
  MissingRequiredClientCapabilityError,
  ProtocolErrorCode
} from '@modelcontextprotocol/server';

const MCP_PROTOCOL_VERSION = '2026-07-28';
const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const TASK_EXECUTION_MODE = Object.freeze({
  NATIVE_TASKS: 'native_tasks',
  BOUNDED_SYNCHRONOUS: 'bounded_synchronous'
});
const MISSING_TASKS_CAPABILITY_CODE = ProtocolErrorCode.MissingRequiredClientCapability;
const INVALID_TASKS_CAPABILITY_CODE = ProtocolErrorCode.InvalidParams;
const TASK_METHODS = Object.freeze(['tasks/get', 'tasks/update', 'tasks/cancel']);
const LEGACY_LIFECYCLE_METHODS = Object.freeze(['initialize', 'notifications/initialized']);

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function negotiateTasksCapability(clientCapabilities) {
  if (!isPlainObject(clientCapabilities)) {
    return capabilityResult(false, false, 'malformed_capabilities');
  }
  if (clientCapabilities.extensions !== undefined && !isPlainObject(clientCapabilities.extensions)) {
    return capabilityResult(false, false, 'malformed_extensions');
  }
  const extensions = clientCapabilities.extensions;
  if (!extensions || !Object.hasOwn(extensions, TASKS_EXTENSION_ID)) {
    return capabilityResult(false, true, 'capability_absent');
  }
  if (!isPlainObject(extensions[TASKS_EXTENSION_ID])) {
    return capabilityResult(false, false, 'malformed_tasks_capability');
  }
  return capabilityResult(true, true, 'capability_present');
}

function capabilityResult(supported, valid, reason) {
  return Object.freeze({
    mode: supported ? TASK_EXECUTION_MODE.NATIVE_TASKS : TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS,
    supported,
    valid,
    reason
  });
}

function clientSupportsNativeTasks(clientCapabilities) {
  return negotiateTasksCapability(clientCapabilities).supported;
}

function requiredTasksCapability() {
  return { requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } } };
}

function createMissingTasksCapabilityError() {
  return new MissingRequiredClientCapabilityError(requiredTasksCapability());
}

function createInvalidTasksCapabilityError(capability = {}) {
  const error = new Error('Client capabilities for native MCP Tasks are malformed.');
  error.code = INVALID_TASKS_CAPABILITY_CODE;
  error.reason = 'invalid_client_capabilities';
  error.retryable = false;
  error.data = {
    reason: 'invalid_client_capabilities',
    capabilityReason: String(capability.reason || 'malformed_capabilities'),
    expectedCapabilities: requiredTasksCapability().requiredCapabilities
  };
  return error;
}

export {
  INVALID_TASKS_CAPABILITY_CODE,
  LEGACY_LIFECYCLE_METHODS,
  MCP_PROTOCOL_VERSION,
  MISSING_TASKS_CAPABILITY_CODE,
  TASK_EXECUTION_MODE,
  TASK_METHODS,
  TASKS_EXTENSION_ID,
  clientSupportsNativeTasks,
  createInvalidTasksCapabilityError,
  createMissingTasksCapabilityError,
  negotiateTasksCapability,
  requiredTasksCapability
};
