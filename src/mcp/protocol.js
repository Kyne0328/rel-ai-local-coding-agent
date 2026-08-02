import {
  MissingRequiredClientCapabilityError,
  ProtocolErrorCode
} from '@modelcontextprotocol/server';

const MCP_PROTOCOL_VERSION = '2026-07-28';
const MCP_LEGACY_PROTOCOL_VERSIONS = Object.freeze(['2025-11-25']);
const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const TASKS_EXTENSION_REVISION = '2026-07-28';
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
  const revision = String(extensions[TASKS_EXTENSION_ID].revision || '');
  if (revision && revision !== TASKS_EXTENSION_REVISION) {
    return capabilityResult(false, false, 'unsupported_tasks_revision');
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
  return {
    requiredCapabilities: {
      extensions: {
        [TASKS_EXTENSION_ID]: { revision: TASKS_EXTENSION_REVISION }
      }
    }
  };
}

function validateJsonRpcRequestEnvelope(message) {
  if (!isPlainObject(message)) {
    return envelopeError(-32600, 'One JSON-RPC request object is required; batches are not supported.');
  }
  if (message.jsonrpc !== '2.0') {
    return envelopeError(-32600, 'A valid JSON-RPC 2.0 request is required.');
  }
  if (typeof message.method !== 'string' || !message.method.trim()) {
    return envelopeError(-32600, 'JSON-RPC method must be a non-empty string.');
  }
  const hasId = Object.hasOwn(message, 'id');
  if (hasId && !validJsonRpcId(message.id)) {
    return envelopeError(-32600, 'JSON-RPC id must be a string or finite number when present.');
  }
  if (message.params !== undefined && !isPlainObject(message.params)) {
    return envelopeError(-32602, 'JSON-RPC params must be an object when present.');
  }
  return { ok: true, notification: !hasId, id: hasId ? message.id : undefined };
}

function validJsonRpcId(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function envelopeError(code, error, data) {
  return { ok: false, code, error, id: null, ...(data === undefined ? {} : { data }) };
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
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION,
  MISSING_TASKS_CAPABILITY_CODE,
  TASK_EXECUTION_MODE,
  TASK_METHODS,
  TASKS_EXTENSION_ID,
  TASKS_EXTENSION_REVISION,
  clientSupportsNativeTasks,
  createInvalidTasksCapabilityError,
  createMissingTasksCapabilityError,
  negotiateTasksCapability,
  requiredTasksCapability,
  validateJsonRpcRequestEnvelope,
  validJsonRpcId
};
