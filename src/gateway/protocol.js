import { MCP_PROTOCOL_VERSION } from '../mcp/protocolConstants.js';

const GATEWAY_PROTOCOL_VERSION = 1;
const MINIMUM_GATEWAY_PROTOCOL_VERSION = 1;
const MAX_GATEWAY_MESSAGE_BYTES = 10 * 1024 * 1024;

const GATEWAY_ERROR_CODES = Object.freeze({
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  DEVICE_UPDATE_REQUIRED: 'DEVICE_UPDATE_REQUIRED',
  WORKSPACE_NOT_AVAILABLE: 'WORKSPACE_NOT_AVAILABLE',
  DEVICE_SELECTION_REQUIRED: 'DEVICE_SELECTION_REQUIRED',
  PAIRING_REQUIRED: 'PAIRING_REQUIRED',
  PAIRING_EXPIRED: 'PAIRING_EXPIRED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  DEVICE_RESPONSE_INVALID: 'DEVICE_RESPONSE_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  AMBIGUOUS_RESULT: 'AMBIGUOUS_RESULT',
  RESULT_UNAVAILABLE: 'RESULT_UNAVAILABLE'
});

const FRAME_TYPES = Object.freeze(new Set([
  'challenge',
  'authenticate',
  'authenticated',
  'capabilities',
  'workspaces',
  'request',
  'accepted',
  'result',
  'cancel',
  'heartbeat',
  'usage_request',
  'usage_result',
  'devices_request',
  'devices_result',
  'device_revoke',
  'device_revoke_result',
  'device_link_request',
  'device_link_result',
  'error'
]));

const SECURITY_SENSITIVE_FIELDS = Object.freeze({
  authenticate: new Set(['type', 'protocolVersion', 'principalId', 'deviceId', 'nonce', 'expiresAt', 'signature']),
  request: new Set(['type', 'gatewayRequestId', 'requestKey', 'workspace', 'expiresAt', 'message', 'synchronization']),
  accepted: new Set(['type', 'gatewayRequestId', 'requestKey']),
  result: new Set(['type', 'gatewayRequestId', 'requestKey', 'ok', 'payload', 'error', 'durationMs']),
  cancel: new Set(['type', 'gatewayRequestId', 'requestKey']),
  capabilities: new Set(['type', 'protocolVersion', 'appVersion', 'mcpProtocolVersion', 'capabilities']),
  workspaces: new Set(['type', 'aliases']),
  heartbeat: new Set(['type', 'ok']),
  usage_request: new Set(['type', 'requestId', 'month']),
  usage_result: new Set(['type', 'requestId', 'month', 'totals', 'tools', 'devices', 'workspaces', 'workspaceDimensions', 'workspaceTools', 'series', 'toolSeries', 'workspaceSeries', 'workspaceToolSeries', 'failureCategories', 'workspaceFailureCategories', 'failureCategorySeries', 'workspaceFailureCategorySeries']),
  devices_request: new Set(['type', 'requestId']),
  devices_result: new Set(['type', 'requestId', 'devices']),
  device_revoke: new Set(['type', 'requestId', 'deviceId']),
  device_revoke_result: new Set(['type', 'requestId', 'deviceId', 'ok']),
  device_link_request: new Set(['type', 'requestId']),
  device_link_result: new Set(['type', 'requestId', 'ok', 'linkCode', 'expiresAt', 'code'])
});

const READ_ONLY_METHODS = new Set([
  'resources/list',
  'resources/read',
  'tools/list',
  'server/discover',
  'tasks/get'
]);
const MUTATING_CONTROL_METHODS = new Set(['tasks/update', 'tasks/cancel']);

function validateGatewayFrame(value) {
  if (!isPlainObject(value)) return invalidFrame('Gateway frame must be an object.');
  const size = serializedBytes(value);
  if (!size.ok) return size;
  if (size.bytes > MAX_GATEWAY_MESSAGE_BYTES) return invalidFrame('Gateway frame exceeds the maximum message size.');

  const type = typeof value.type === 'string' ? value.type : '';
  if (!FRAME_TYPES.has(type)) return invalidFrame('Unknown gateway frame type.');
  const allowed = SECURITY_SENSITIVE_FIELDS[type];
  if (allowed && Object.keys(value).some(key => !allowed.has(key))) {
    return invalidFrame(`Unexpected field in ${type} frame.`);
  }

  switch (type) {
    case 'challenge':
      return validateChallenge(value);
    case 'authenticate':
      return validateAuthenticate(value);
    case 'authenticated':
      return validateAuthenticated(value);
    case 'capabilities':
      return validateCapabilities(value);
    case 'workspaces':
      return validateWorkspaces(value);
    case 'request':
      return validateRoutedRequest(value);
    case 'accepted':
      return requireStringFields(value, ['gatewayRequestId', 'requestKey']);
    case 'result':
      return validateResult(value);
    case 'cancel':
      return requireStringFields(value, ['gatewayRequestId', 'requestKey']);
    case 'heartbeat':
      return value.ok === undefined || typeof value.ok === 'boolean'
        ? validFrame()
        : invalidFrame('Heartbeat ok must be boolean when present.');
    case 'usage_request':
      return validateUsageRequest(value);
    case 'usage_result':
      return validateUsageResult(value);
    case 'devices_request':
      return requireStringFields(value, ['requestId']);
    case 'devices_result':
      return validateDevicesResult(value);
    case 'device_revoke':
      return requireStringFields(value, ['requestId', 'deviceId']);
    case 'device_revoke_result':
      return validateDeviceRevokeResult(value);
    case 'device_link_request':
      return requireStringFields(value, ['requestId']);
    case 'device_link_result':
      return validateDeviceLinkResult(value);
    case 'error':
      return validateErrorFrame(value);
    default:
      return invalidFrame('Unknown gateway frame type.');
  }
}

function validateRoutedRequest(value) {
  if (!isPlainObject(value)) return invalidFrame('Routed request must be an object.');
  const required = requireStringFields(value, ['gatewayRequestId', 'requestKey']);
  if (!required.ok) return required;
  if (!isPlainObject(value.message) || typeof value.message.method !== 'string' || !value.message.method.trim()) {
    return invalidFrame('Routed request requires an MCP message with a method.');
  }
  if (value.workspace !== undefined && !validWorkspaceAlias(value.workspace)) {
    return invalidFrame('Workspace must be a bounded alias, not a local path.');
  }
  if (value.expiresAt !== undefined && !finiteNumber(value.expiresAt)) {
    return invalidFrame('Routed request expiry must be a finite number.');
  }
  if (value.synchronization !== undefined) {
    const sync = validateSynchronization(value.synchronization);
    if (!sync.ok) return sync;
  }
  return validFrame();
}

function classifyMcpRequest(message, toolManifest = {}) {
  if (!isPlainObject(message) || typeof message.method !== 'string' || !message.method.trim()) {
    return { ok: false, reason: 'invalid_method' };
  }
  const method = message.method;
  if (READ_ONLY_METHODS.has(method)) {
    return { ok: true, method, idempotency: 'read_only', idempotent: true, destructive: false };
  }
  if (MUTATING_CONTROL_METHODS.has(method)) {
    return { ok: true, method, idempotency: 'mutating', idempotent: false, destructive: method === 'tasks/cancel' };
  }
  if (method !== 'tools/call') return { ok: false, method, reason: 'unsupported_method' };

  const toolName = String(message.params?.name || '');
  const tools = Array.isArray(toolManifest?.tools) ? toolManifest.tools : [];
  const tool = tools.find(candidate => candidate?.name === toolName);
  if (!tool) return { ok: false, method, toolName, reason: 'tool_not_found' };
  const annotations = isPlainObject(tool.annotations) ? tool.annotations : {};
  const readOnly = annotations.readOnlyHint === true;
  return {
    ok: true,
    method,
    toolName,
    idempotency: readOnly ? 'read_only' : 'mutating',
    idempotent: readOnly || annotations.idempotentHint === true,
    destructive: annotations.destructiveHint === true
  };
}

function gatewayCompatibility(device = {}) {
  const protocolVersion = Number(device.protocolVersion);
  if (!Number.isInteger(protocolVersion) || protocolVersion < MINIMUM_GATEWAY_PROTOCOL_VERSION || protocolVersion > GATEWAY_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: GATEWAY_ERROR_CODES.DEVICE_UPDATE_REQUIRED,
      reason: 'unsupported_gateway_protocol',
      minimumProtocolVersion: MINIMUM_GATEWAY_PROTOCOL_VERSION,
      currentProtocolVersion: GATEWAY_PROTOCOL_VERSION
    };
  }
  if (device.mcpProtocolVersion !== undefined && device.mcpProtocolVersion !== MCP_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: GATEWAY_ERROR_CODES.DEVICE_UPDATE_REQUIRED,
      reason: 'unsupported_mcp_protocol',
      expectedMcpProtocolVersion: MCP_PROTOCOL_VERSION
    };
  }
  return { ok: true, protocolVersion, mcpProtocolVersion: MCP_PROTOCOL_VERSION };
}

const RECOVERY_CODE_PREFIX = 'relai-recovery-v1';
const DEVICE_LINK_CODE_PREFIX = 'relai-link-v1';
const RECOVERY_PRINCIPAL_RE = /^prn_[A-Za-z0-9_-]{32}$/;
const RECOVERY_SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

function formatRecoveryCode(principalId, recoverySecret) {
  const principal = String(principalId || '').trim();
  const secret = String(recoverySecret || '').trim();
  if (!RECOVERY_PRINCIPAL_RE.test(principal) || !RECOVERY_SECRET_RE.test(secret)) throw new TypeError('Recovery identity is invalid.');
  return `${RECOVERY_CODE_PREFIX}.${principal}.${secret}`;
}

function formatDeviceLinkCode(principalId, linkCode) {
  const principal = String(principalId || '').trim();
  const secret = String(linkCode || '').trim();
  if (!RECOVERY_PRINCIPAL_RE.test(principal) || !RECOVERY_SECRET_RE.test(secret)) throw new TypeError('Device link identity is invalid.');
  return `${DEVICE_LINK_CODE_PREFIX}.${principal}.${secret}`;
}

function parseDeviceLinkCode(value) {
  const text = String(value || '').trim();
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== DEVICE_LINK_CODE_PREFIX) return null;
  const principalId = parts[1];
  const linkCode = parts[2];
  if (!RECOVERY_PRINCIPAL_RE.test(principalId) || !RECOVERY_SECRET_RE.test(linkCode)) return null;
  return { principalId, linkCode };
}

function parseRecoveryCode(value) {
  const text = String(value || '').trim();
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== RECOVERY_CODE_PREFIX) return null;
  const principalId = parts[1];
  const recoverySecret = parts[2];
  if (!RECOVERY_PRINCIPAL_RE.test(principalId) || !RECOVERY_SECRET_RE.test(recoverySecret)) return null;
  return { principalId, recoverySecret };
}

function schemaSynchronizationStatus({
  authenticated = true,
  manifestHash = '',
  schemaVersion = 0,
  observation = null,
  device = {}
} = {}) {
  const normalizedHash = String(manifestHash || '');
  const normalizedSchemaVersion = Math.max(0, Math.floor(Number(schemaVersion) || 0));
  const base = {
    schemaVersion: normalizedSchemaVersion,
    manifestHash: normalizedHash,
    minimumProtocolVersion: MINIMUM_GATEWAY_PROTOCOL_VERSION,
    currentProtocolVersion: GATEWAY_PROTOCOL_VERSION
  };
  if (authenticated !== true) return { status: 'reauthentication_required', ...base };
  const compatibility = gatewayCompatibility(device);
  if (!compatibility.ok) {
    return {
      status: 'device_update_required',
      ...base,
      ...(compatibility.minimumProtocolVersion == null ? {} : { minimumProtocolVersion: Number(compatibility.minimumProtocolVersion) }),
      ...(compatibility.currentProtocolVersion == null ? {} : { currentProtocolVersion: Number(compatibility.currentProtocolVersion) })
    };
  }
  const current = observation
    && String(observation.manifestHash || observation.manifest_hash || '') === normalizedHash
    && Number(observation.schemaVersion ?? observation.schema_version) === normalizedSchemaVersion;
  if (!current) return { status: 'tool_refresh_required', ...base };
  return {
    status: 'current',
    ...base,
    observedAt: Number(observation.observedAt ?? observation.observed_at) || null
  };
}

function validateChallenge(value) {
  const required = requireStringFields(value, ['principalId', 'deviceId', 'nonce']);
  if (!required.ok) return required;
  if (value.protocolVersion !== GATEWAY_PROTOCOL_VERSION) return invalidFrame('Challenge protocol version is unsupported.');
  if (!finiteNumber(value.expiresAt)) return invalidFrame('Challenge expiry must be a finite number.');
  return validFrame();
}

function validateAuthenticate(value) {
  const challenge = validateChallenge(value);
  if (!challenge.ok) return challenge;
  return requireStringFields(value, ['signature']);
}

function validateAuthenticated(value) {
  if (value.protocolVersion !== undefined && value.protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
    return invalidFrame('Authenticated frame protocol version is unsupported.');
  }
  return optionalStringFields(value, ['principalId', 'deviceId', 'appVersion']);
}

function validateCapabilities(value) {
  if (value.protocolVersion !== undefined && value.protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
    return invalidFrame('Capabilities protocol version is unsupported.');
  }
  if (value.capabilities !== undefined && !isPlainObject(value.capabilities)) {
    return invalidFrame('Capabilities must be an object.');
  }
  return optionalStringFields(value, ['appVersion', 'mcpProtocolVersion']);
}

function validateWorkspaces(value) {
  const aliases = value.aliases ?? value.workspaces;
  if (!Array.isArray(aliases) || aliases.some(alias => !validWorkspaceAlias(alias))) {
    return invalidFrame('Workspaces frame must contain bounded workspace aliases only.');
  }
  return validFrame();
}

function validateResult(value) {
  const required = requireStringFields(value, ['gatewayRequestId', 'requestKey']);
  if (!required.ok) return required;
  if (typeof value.ok !== 'boolean') return invalidFrame('Result frame requires a boolean ok field.');
  if (value.durationMs !== undefined && (!finiteNumber(value.durationMs) || value.durationMs < 0)) {
    return invalidFrame('Result duration must be a non-negative finite number.');
  }
  return validFrame();
}

function validateErrorFrame(value) {
  const required = requireStringFields(value, ['code', 'message']);
  if (!required.ok) return required;
  if (value.retryable !== undefined && typeof value.retryable !== 'boolean') return invalidFrame('Error retryable must be boolean.');
  if (value.retryAfterMs !== undefined && (!finiteNumber(value.retryAfterMs) || value.retryAfterMs < 0)) {
    return invalidFrame('Error retryAfterMs must be a non-negative finite number.');
  }
  return validFrame();
}

function requireStringFields(value, fields) {
  for (const field of fields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) return invalidFrame(`${field} must be a non-empty string.`);
  }
  return validFrame();
}

function optionalStringFields(value, fields) {
  for (const field of fields) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field].trim())) {
      return invalidFrame(`${field} must be a non-empty string when present.`);
    }
  }
  return validFrame();
}

function usageMonthKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validUsageMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function validateSynchronization(value) {
  if (!isPlainObject(value)) return invalidFrame('Synchronization status must be an object.');
  const allowed = new Set(['status', 'schemaVersion', 'manifestHash', 'observedAt', 'minimumProtocolVersion', 'currentProtocolVersion']);
  if (Object.keys(value).some(key => !allowed.has(key))) return invalidFrame('Synchronization status contains an unsafe field.');
  if (!['current', 'tool_refresh_required', 'reauthentication_required'].includes(String(value.status || ''))) return invalidFrame('Synchronization status is unsupported.');
  if (!Number.isInteger(Number(value.schemaVersion)) || Number(value.schemaVersion) < 0) return invalidFrame('Schema version must be a non-negative integer.');
  if (typeof value.manifestHash !== 'string' || !value.manifestHash || value.manifestHash.length > 200) return invalidFrame('Manifest hash is required.');
  for (const field of ['observedAt', 'minimumProtocolVersion', 'currentProtocolVersion']) {
    if (value[field] !== undefined && value[field] !== null && !finiteNumber(value[field])) return invalidFrame('Synchronization status numeric fields must be finite numbers.');
  }
  return validFrame();
}

function validateUsageRequest(value) {
  const required = requireStringFields(value, ['requestId']);
  if (!required.ok) return required;
  if (value.month !== undefined && !validUsageMonth(value.month)) return invalidFrame('Usage month must use YYYY-MM.');
  return validFrame();
}

function validateUsageResult(value) {
  const required = requireStringFields(value, ['requestId', 'month']);
  if (!required.ok) return required;
  if (!validUsageMonth(value.month)) return invalidFrame('Usage month must use YYYY-MM.');
  if (!isPlainObject(value.totals)) return invalidFrame('Usage totals must be an object.');
  for (const field of ['tools', 'devices', 'workspaces']) {
    if (!Array.isArray(value[field])) return invalidFrame(`Usage ${field} must be an array.`);
  }
  for (const field of ['workspaceDimensions', 'workspaceTools', 'series', 'toolSeries', 'workspaceSeries', 'workspaceToolSeries', 'failureCategories', 'workspaceFailureCategories', 'failureCategorySeries', 'workspaceFailureCategorySeries']) {
    if (value[field] !== undefined && !Array.isArray(value[field])) return invalidFrame(`Usage ${field} must be an array when present.`);
  }
  return validFrame();
}

function validateDevicesResult(value) {
  const required = requireStringFields(value, ['requestId']);
  if (!required.ok) return required;
  if (!Array.isArray(value.devices) || value.devices.length > 256) return invalidFrame('Devices result must contain a bounded devices array.');
  for (const device of value.devices) {
    if (!isPlainObject(device) || typeof device.deviceId !== 'string' || !device.deviceId.trim()) return invalidFrame('Device result entry is invalid.');
    const allowed = new Set(['deviceId', 'displayName', 'appVersion', 'protocolVersion', 'mcpProtocolVersion', 'capabilities', 'lastSeenAt', 'revokedAt']);
    if (Object.keys(device).some(key => !allowed.has(key))) return invalidFrame('Device result entry contains an unsafe field.');
  }
  return validFrame();
}

function validateDeviceLinkResult(value) {
  const required = requireStringFields(value, ['requestId']);
  if (!required.ok) return required;
  if (typeof value.ok !== 'boolean') return invalidFrame('Device link result requires a boolean ok field.');
  if (value.ok) {
    if (!RECOVERY_SECRET_RE.test(String(value.linkCode || ''))) return invalidFrame('Device link result requires a valid one-time link code.');
    if (!finiteNumber(value.expiresAt)) return invalidFrame('Device link result requires a finite expiry.');
  }
  if (!value.ok && value.code !== undefined && typeof value.code !== 'string') return invalidFrame('Device link error code must be a string.');
  return validFrame();
}

function validateDeviceRevokeResult(value) {
  const required = requireStringFields(value, ['requestId', 'deviceId']);
  if (!required.ok) return required;
  if (typeof value.ok !== 'boolean') return invalidFrame('Device revoke result requires a boolean ok field.');
  return validFrame();
}

function validWorkspaceAlias(value) {
  if (typeof value !== 'string') return false;
  const alias = value.trim();
  if (!alias || alias.length > 180) return false;
  return /^[A-Za-z0-9_.-]{1,180}$/.test(alias);
}

function serializedBytes(value) {
  try {
    return { ok: true, bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength };
  } catch {
    return invalidFrame('Gateway frame must be JSON-serializable.');
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validFrame() {
  return { ok: true };
}

function invalidFrame(error) {
  return { ok: false, error };
}

export {
  GATEWAY_ERROR_CODES,
  GATEWAY_PROTOCOL_VERSION,
  MAX_GATEWAY_MESSAGE_BYTES,
  MINIMUM_GATEWAY_PROTOCOL_VERSION,
  classifyMcpRequest,
  gatewayCompatibility,
  schemaSynchronizationStatus,
  formatRecoveryCode,
  parseRecoveryCode,
  formatDeviceLinkCode,
  parseDeviceLinkCode,
  usageMonthKey,
  validUsageMonth,
  validWorkspaceAlias,
  validateGatewayFrame,
  validateRoutedRequest
};
