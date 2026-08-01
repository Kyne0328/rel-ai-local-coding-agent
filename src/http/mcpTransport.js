import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler
} from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { readConfig } from '../config.js';
import { mcpConnectionManager } from '../mcp/connectionManager.js';
import { LEGACY_LIFECYCLE_METHODS, MCP_PROTOCOL_VERSION } from '../mcp/protocol.js';
import { buildToolManifest } from '../mcp/toolManifest.js';
import { createRelaiMcpServer } from '../mcpServer.js';
import { expectedNativeTaskName, handleNativeTasksRequest } from '../nativeTasksProbe.js';
import { runSpan } from '../telemetry.js';
import { isMcpAuthorized, oauthAuthorization, resolveBaseUrl, unauthorizedMcp } from './auth.js';
import { readJsonBody, readRawBody, sendJson } from './io.js';

let coreHandler = null;
let coreNodeHandler = null;

function getCoreNodeHandler() {
  if (coreNodeHandler) return coreNodeHandler;
  coreHandler = createMcpHandler(
    () => createRelaiMcpServer({
      publicHttpOnly: true,
      transportType: 'streamable-http',
      nativeTasks: true,
      legacyCompatibility: true
    }),
    {
      legacy: 'stateless',
      responseMode: 'auto',
      onerror: error => debug('MCP handler', error)
    }
  );
  coreNodeHandler = toNodeHandler(coreHandler, {
    onerror: error => debug('MCP Node adapter', error)
  });
  return coreNodeHandler;
}

async function handleMcpGetDiagnostic(ctx) {
  return handleUnsupportedHttpMethod(ctx);
}

async function handleMcpDelete(ctx) {
  return handleUnsupportedHttpMethod(ctx);
}

async function handleMcpStreamable(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  if (!isMcpAuthorized(ctx.req, ctx.options)) {
    mcpConnectionManager.record('authentication_failed', { reasonCode: 'invalid_or_missing_bearer' });
    unauthorizedMcp(ctx.res, baseUrl, ctx.req);
    return;
  }
  if (!validateTransportOrigin(ctx)) return;
  if (!isJsonContentType(ctx.req.headers['content-type'])) {
    sendMcpProtocolError(ctx.res, 415, -32600, 'Content-Type must be application/json.');
    return;
  }

  let message;
  try {
    const raw = await readRawBody(ctx.req, ctx.options.maxBodyBytes);
    message = raw.trim() ? JSON.parse(raw) : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendMcpProtocolError(ctx.res, 400, -32700, 'Parse error.');
      return;
    }
    throw error;
  }

  const authorization = oauthAuthorization(ctx.req, ctx.options);
  const principal = authorization?.clientId || (ctx.options.allowNoAuth ? 'local-no-auth' : 'static-bearer');
  ctx.req.auth = authorization || { clientId: principal, scopes: ['mcp'] };
  const config = readConfig();

  if (isLegacyMcpRequest(ctx.req.headers, message)) {
    const params = objectValue(message?.params);
    mcpConnectionManager.noteRequest({
      principal,
      method: message?.method,
      clientInfo: params.clientInfo,
      clientCapabilities: params.capabilities
    });
    await runSpan(config, 'relai.mcp.request', {
      'mcp.protocol.version': String(params.protocolVersion || headerValue(ctx.req.headers, 'mcp-protocol-version') || 'legacy'),
      'mcp.method': String(message?.method || ''),
      'oauth.client_id': principal
    }, async () => {
      try {
        await getCoreNodeHandler()(ctx.req, ctx.res, message);
        mcpConnectionManager.noteRequestResult(message?.method, ctx.res.statusCode < 400);
      } catch (error) {
        mcpConnectionManager.noteRequestResult(message?.method, false);
        throw error;
      }
    }, { carrier: ctx.req.headers });
    return;
  }

  const validation = validateMcpRequestHeaders(ctx.req.headers, message);
  if (!validation.ok) {
    mcpConnectionManager.noteRequestResult(message?.method, false);
    sendMcpProtocolError(
      ctx.res,
      validation.status,
      validation.code,
      validation.error,
      message?.id,
      validation.data
    );
    return;
  }

  const meta = message.params._meta;
  const manifest = buildToolManifest(config);
  await mcpConnectionManager.observeManifest(manifest, message.method);
  mcpConnectionManager.noteRequest({
    principal,
    method: message.method,
    clientInfo: meta[CLIENT_INFO_META_KEY],
    clientCapabilities: meta[CLIENT_CAPABILITIES_META_KEY]
  });

  await runSpan(config, 'relai.mcp.request', {
    'mcp.protocol.version': MCP_PROTOCOL_VERSION,
    'mcp.method': message.method,
    'oauth.client_id': principal
  }, async () => {
    const nativeResponse = handleNativeTasksRequest(config, message, principal);
    if (nativeResponse) {
      mcpConnectionManager.noteRequestResult(message.method, !nativeResponse.body.error);
      sendJson(ctx.res, nativeResponse.status, nativeResponse.body, ctx.ae);
      return;
    }
    try {
      await getCoreNodeHandler()(ctx.req, ctx.res, message);
      mcpConnectionManager.noteRequestResult(message.method, ctx.res.statusCode < 400);
    } catch (error) {
      mcpConnectionManager.noteRequestResult(message.method, false);
      throw error;
    }
  }, { carrier: ctx.req.headers });
}

async function handleUnsupportedHttpMethod(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  if (!isMcpAuthorized(ctx.req, ctx.options)) {
    unauthorizedMcp(ctx.res, baseUrl, ctx.req);
    return;
  }
  ctx.res.setHeader('allow', 'POST');
  sendMcpProtocolError(ctx.res, 405, -32600, 'Method not allowed. MCP 2026-07-28 uses stateless POST requests only.');
}

async function handleMcpRecovery(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const action = String(payload.action || 'retry');
  if (!['retry', 'restart_transport'].includes(action)) {
    sendJson(ctx.res, 400, { ok: false, error: 'action must be retry or restart_transport' }, ctx.ae);
    return;
  }
  const result = await mcpConnectionManager.retryConnection(action);
  sendJson(ctx.res, 200, { ...result, connection: mcpConnectionManager.snapshot() }, ctx.ae);
}

function handleMcpConnectionState(ctx) {
  sendJson(ctx.res, 200, { ok: true, connection: mcpConnectionManager.snapshot() }, ctx.ae);
}

function validateMcpRequestHeaders(headers = {}, message) {
  if (!message || Array.isArray(message) || typeof message !== 'object') {
    return rejection(400, -32600, 'One JSON-RPC request object is required; batches are not supported.');
  }
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method) {
    return rejection(400, -32600, 'A valid JSON-RPC 2.0 MCP request or notification is required.');
  }
  if (headerValue(headers, 'mcp-session-id')) {
    return rejection(400, -32600, 'Mcp-Session-Id is not supported by MCP 2026-07-28.');
  }
  if (LEGACY_LIFECYCLE_METHODS.includes(message.method)) {
    return rejection(400, -32601, `Legacy MCP method is not supported: ${message.method}.`);
  }
  const protocolHeader = headerValue(headers, 'mcp-protocol-version');
  if (protocolHeader !== MCP_PROTOCOL_VERSION) {
    return rejection(400, -32022, `Unsupported protocol version: ${protocolHeader || 'missing'}.`, {
      supported: [MCP_PROTOCOL_VERSION],
      requested: protocolHeader || 'missing'
    });
  }
  const methodHeader = headerValue(headers, 'mcp-method');
  if (!methodHeader || methodHeader !== message.method) {
    return rejection(400, -32020, 'Mcp-Method header does not match the JSON-RPC method.');
  }
  const params = objectValue(message.params);
  const meta = objectValue(params._meta);
  if (params !== message.params || meta !== params._meta) {
    return rejection(400, -32602, 'Modern MCP requests require params._meta.');
  }
  const protocolMeta = String(meta[PROTOCOL_VERSION_META_KEY] || '');
  if (protocolMeta !== MCP_PROTOCOL_VERSION || protocolMeta !== protocolHeader) {
    return rejection(400, -32020, 'Request protocol metadata does not match MCP-Protocol-Version.');
  }
  if (Object.hasOwn(meta, CLIENT_INFO_META_KEY) && !validImplementation(meta[CLIENT_INFO_META_KEY])) {
    return rejection(400, -32602, `When present, ${CLIENT_INFO_META_KEY} must include name and version.`);
  }
  if (!isPlainObject(meta[CLIENT_CAPABILITIES_META_KEY])) {
    return rejection(400, -32602, `Request metadata must include ${CLIENT_CAPABILITIES_META_KEY}.`);
  }
  const expectedName = expectedMcpName(message.method, params);
  const nameHeader = headerValue(headers, 'mcp-name');
  if (expectedName && nameHeader !== expectedName) {
    return rejection(400, -32020, 'Mcp-Name header does not match the named request target.');
  }
  if (!expectedName && nameHeader) {
    return rejection(400, -32020, 'Mcp-Name is only valid for a named MCP request.');
  }
  if (hasMcpParamHeader(headers)) {
    return rejection(400, -32020, 'Mcp-Param-* headers are not declared by this server.');
  }
  return { ok: true };
}

function isLegacyMcpRequest(headers = {}, message = {}) {
  const method = String(message?.method || '');
  const params = objectValue(message?.params);
  const meta = objectValue(params._meta);
  const protocolHeader = headerValue(headers, 'mcp-protocol-version');
  const protocolMeta = String(meta[PROTOCOL_VERSION_META_KEY] || '');
  const declaredVersion = protocolHeader || protocolMeta;

  if (method === 'server/discover') return false;
  if (declaredVersion === MCP_PROTOCOL_VERSION) return false;
  if (LEGACY_LIFECYCLE_METHODS.includes(method)) return true;
  if (!declaredVersion) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(declaredVersion) && declaredVersion < MCP_PROTOCOL_VERSION;
}

function expectedMcpName(method, params = {}) {
  if (method === 'tools/call' || method === 'prompts/get') return String(params.name || '');
  if (['resources/read', 'resources/subscribe', 'resources/unsubscribe'].includes(method)) {
    return String(params.uri || '');
  }
  return expectedNativeTaskName(method, params);
}

function validateTransportOrigin(ctx) {
  const allowed = transportSecurityOptions(ctx);
  const incomingHost = String(ctx.req.headers.host || '');
  let hostName = '';
  try { hostName = new URL(`http://${incomingHost}`).hostname; } catch {}
  if (!hostName || !allowed.allowedHostnames.includes(hostName)) {
    sendMcpProtocolError(ctx.res, 403, -32600, 'Forbidden Host header.');
    return false;
  }
  const origin = String(ctx.req.headers.origin || '');
  if (!origin) return true;
  let originName = '';
  try { originName = new URL(origin).hostname; } catch {}
  if (!originName || !allowed.allowedOriginHostnames.includes(originName)) {
    sendMcpProtocolError(ctx.res, 403, -32600, 'Forbidden Origin header.');
    return false;
  }
  return true;
}

function transportSecurityOptions(ctx) {
  const allowedHostnames = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  const allowedOriginHostnames = new Set(allowedHostnames);
  for (const value of [
    resolveBaseUrl(ctx.options),
    `http://${ctx.options.host || '127.0.0.1'}:${ctx.options.port || 3333}`
  ]) {
    try {
      const url = new URL(value);
      allowedHostnames.add(url.hostname);
      allowedOriginHostnames.add(url.hostname);
    } catch {}
  }
  return {
    allowedHostnames: [...allowedHostnames],
    allowedOriginHostnames: [...allowedOriginHostnames]
  };
}

function sendMcpProtocolError(res, status, code, message, id = null, data) {
  sendJson(res, status, {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) }
  });
}

function rejection(status, code, error, data) {
  return { ok: false, status, code, error, ...(data === undefined ? {} : { data }) };
}

function headerValue(headers, name) {
  const target = String(name).toLowerCase();
  const value = headers[target] ?? headers[name];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function hasMcpParamHeader(headers = {}) {
  return Object.keys(headers).some(name => String(name).toLowerCase().startsWith('mcp-param-'));
}

function isJsonContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function validImplementation(value) {
  return isPlainObject(value)
    && typeof value.name === 'string'
    && value.name.length > 0
    && typeof value.version === 'string'
    && value.version.length > 0;
}

function objectValue(value) {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function debug(context, error) {
  if (process.env.REL_AI_MCP_DEBUG) {
    console.error(`[rel-ai-mcp] ${context}:`, error instanceof Error ? error.message : String(error));
  }
}

async function shutdownMcpTransport() {
  const handler = coreHandler;
  coreHandler = null;
  coreNodeHandler = null;
  if (handler) await handler.close();
}

export {
  MCP_PROTOCOL_VERSION,
  expectedMcpName,
  handleMcpConnectionState,
  handleMcpDelete,
  handleMcpGetDiagnostic,
  handleMcpRecovery,
  handleMcpStreamable,
  shutdownMcpTransport,
  transportSecurityOptions,
  validateMcpRequestHeaders
};
