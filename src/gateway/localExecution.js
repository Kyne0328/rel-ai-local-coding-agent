import { CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { resolveWorkspace } from '../config.js';
import { createRelaiRequestStateCodec } from '../mcp/context.js';
import { createGatewayTaskPrincipal } from '../mcp/principal.js';
import { MCP_PROTOCOL_VERSION, validateJsonRpcRequestEnvelope } from '../mcp/protocol.js';
import {
  executeTransportToolResult,
  handleTransportTaskRequest,
  validateTransportToolArguments
} from '../mcp/transportTasks.js';
import { listResources, readResource } from '../resources.js';
import { validWorkspaceAlias } from './protocol.js';

const ALLOWED_METHODS = new Set([
  'tools/call',
  'tasks/get',
  'tasks/update',
  'tasks/cancel',
  'resources/list',
  'resources/read'
]);

function createGatewayLocalExecutor({ gatewayOrigin, pairedPrincipalId, config } = {}) {
  if (!config || typeof config !== 'object') throw new TypeError('Gateway local execution requires the current Rel.AI config.');
  const principal = createGatewayTaskPrincipal(gatewayOrigin, pairedPrincipalId);
  const expectedPrincipalId = String(pairedPrincipalId || '').trim();

  async function execute(request = {}) {
    if (String(request.principalId || '') !== expectedPrincipalId) {
      return gatewayFailure('GATEWAY_PRINCIPAL_MISMATCH', 'The routed principal does not match this paired Rel.AI desktop.');
    }
    if (request.signal?.aborted) return gatewayFailure('REQUEST_TIMEOUT', 'The routed request was cancelled before local execution.');
    if (Number.isFinite(Number(request.deadlineAt)) && Number(request.deadlineAt) <= Date.now()) {
      return gatewayFailure('REQUEST_TIMEOUT', 'The routed request expired before local execution.');
    }

    const message = request.message;
    const envelope = validateJsonRpcRequestEnvelope(message);
    if (!envelope.ok) return rpcOutcome(errorResponse(null, envelope.code, envelope.error, envelope.data));
    const method = String(message.method || '');
    if (!ALLOWED_METHODS.has(method)) {
      return gatewayFailure('DEVICE_RESPONSE_INVALID', `Gateway method '${method}' is not executable by the desktop adapter.`);
    }

    const workspaceCheck = validateRoutedWorkspace(config, message, request.workspace);
    if (!workspaceCheck.ok) return workspaceCheck;

    const transport = await handleTransportTaskRequest(config, message, {
      principal,
      transportType: 'gateway',
      publicHttpOnly: true,
      protocolVersion: protocolVersionOf(message),
      envelope: objectValue(message.params?._meta),
      capabilities: clientCapabilities(message),
      requestId: message.id,
      authInfo: principal,
      inputResponses: objectValueOrUndefined(message.params?.inputResponses),
      signal: request.signal
    });
    if (transport) return rpcOutcome(transport.body);

    if (method === 'tools/call') return executeTool(config, principal, message, request.signal);
    if (method === 'resources/list') return rpcOutcome(successResponse(message.id, listResources()));
    if (method === 'resources/read') {
      try {
        return rpcOutcome(successResponse(message.id, readResource(String(message.params?.uri || ''))));
      } catch (error) {
        return rpcOutcome(errorResponse(message.id, -32602, error instanceof Error ? error.message : 'Resource read failed.'));
      }
    }
    return gatewayFailure('DEVICE_RESPONSE_INVALID', `Gateway method '${method}' was not handled locally.`);
  }

  Object.defineProperty(execute, 'principal', { value: principal, enumerable: true });
  return Object.freeze(execute);
}

async function executeTool(config, principal, message, signal) {
  const name = String(message.params?.name || '');
  const validated = await validateTransportToolArguments(config, name, message.params?.arguments);
  if (!validated.ok) return rpcOutcome(errorResponse(message.id, -32602, validated.error));

  const codec = createRelaiRequestStateCodec(config, principal);
  const approval = await gatewayApprovalContext(message, principal, codec, signal);
  if (!approval.ok) return rpcOutcome(errorResponse(message.id, -32602, 'Invalid or expired requestState.', { reason: 'invalid_request_state' }));

  const result = await executeTransportToolResult(config, name, validated.value, {
    principal,
    transportType: 'gateway',
    publicHttpOnly: true,
    protocolVersion: protocolVersionOf(message),
    envelope: objectValue(message.params?._meta),
    capabilities: clientCapabilities(message),
    requestId: message.id,
    authInfo: principal,
    inputResponses: objectValueOrUndefined(message.params?.inputResponses),
    signal,
    approvalContext: approval.context,
    requestStateCodec: codec
  });
  return rpcOutcome(successResponse(message.id, result));
}

async function gatewayApprovalContext(message, principal, codec, signal) {
  const params = objectValue(message.params);
  if (params.inputResponses !== undefined && !isPlainObject(params.inputResponses)) return { ok: false };
  if (params.requestState !== undefined && typeof params.requestState !== 'string') return { ok: false };
  const base = {
    principal,
    mcpReq: {
      id: message.id,
      method: String(message.method || ''),
      envelope: objectValue(params._meta),
      inputResponses: objectValueOrUndefined(params.inputResponses),
      signal,
      requestState: () => undefined
    }
  };
  if (params.requestState === undefined) return { ok: true, context: base };
  try {
    const decoded = await codec.verify(params.requestState, base);
    return {
      ok: true,
      context: {
        ...base,
        mcpReq: { ...base.mcpReq, requestState: () => decoded }
      }
    };
  } catch {
    return { ok: false };
  }
}

function validateRoutedWorkspace(config, message, routedWorkspace) {
  const routed = String(routedWorkspace || '').trim();
  if (routed && !validLocalAlias(config, routed)) return gatewayFailure('WORKSPACE_NOT_AVAILABLE', 'The routed workspace is not a configured local alias.');

  if (message.method === 'tools/call') {
    const argumentValue = message.params?.arguments?.workspace;
    if (argumentValue !== undefined && argumentValue !== null && String(argumentValue).trim()) {
      const requested = String(argumentValue).trim();
      if (!validLocalAlias(config, requested)) return gatewayFailure('WORKSPACE_NOT_AVAILABLE', 'Gateway tool calls may select workspaces only by configured alias.');
      if (routed && routed !== requested) return gatewayFailure('WORKSPACE_NOT_AVAILABLE', 'The routed workspace does not match the tool workspace.');
    } else if (routed) {
      return gatewayFailure('WORKSPACE_NOT_AVAILABLE', 'The routed workspace is not asserted by the tool request.');
    }
  }

  if (message.method === 'resources/read') {
    const resourceAlias = workspaceAliasFromResource(String(message.params?.uri || ''));
    if (resourceAlias !== null && !validLocalAlias(config, resourceAlias)) {
      return gatewayFailure('WORKSPACE_NOT_AVAILABLE', 'Gateway resources may select workspaces only by configured alias.');
    }
  }
  return { ok: true };
}

function validLocalAlias(config, value) {
  if (!validWorkspaceAlias(value)) return false;
  try {
    return resolveWorkspace(config, value).alias === value;
  } catch {
    return false;
  }
}

function workspaceAliasFromResource(uri) {
  const match = /^relai:\/\/workspace\/([^/]+)\//.exec(uri);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

function protocolVersionOf(message) {
  return String(objectValue(message.params?._meta)['io.modelcontextprotocol/protocolVersion'] || MCP_PROTOCOL_VERSION);
}

function clientCapabilities(message) {
  return objectValue(objectValue(message.params?._meta)[CLIENT_CAPABILITIES_META_KEY]);
}

function rpcOutcome(payload) {
  if (payload == null) return { ok: true, payload: null };
  return { ok: true, payload };
}

function gatewayFailure(code, message) {
  return { ok: false, error: { code, message } };
}

function successResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message, data) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function objectValue(value) {
  return isPlainObject(value) ? value : {};
}

function objectValueOrUndefined(value) {
  return value === undefined ? undefined : objectValue(value);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export { createGatewayLocalExecutor };
