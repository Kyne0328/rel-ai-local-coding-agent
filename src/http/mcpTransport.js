import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  createMcpHandler,
  isLegacyRequest
} from '@modelcontextprotocol/server';
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import { readConfig } from '../config.js';
import { mcpConnectionManager } from '../mcp/connectionManager.js';
import {
  LEGACY_LIFECYCLE_METHODS,
  MCP_PROTOCOL_VERSION,
  TASK_METHODS,
  validateJsonRpcRequestEnvelope
} from '../mcp/protocol.js';
import { createHttpTaskPrincipal } from '../mcp/principal.js';
import { buildToolManifest } from '../mcp/toolManifest.js';
import { handleTransportTaskRequest } from '../mcp/transportTasks.js';
import { createRelaiMcpServer } from '../mcpServer.js';
import { runSpan } from '../telemetry.js';
import { resolveBaseUrl } from './auth.js';
import { mcpAuthorization, unauthorizedMcp } from './mcpAuth.js';
import { readJsonBody, readRawBody, sendJson } from './io.js';

let coreHandler = null;
let coreNodeHandler = null;
const activePrincipalRequests = new Map();
const MAX_CONCURRENT_REQUESTS_PER_PRINCIPAL = 8;
const DEFAULT_MCP_BODY_LIMIT = 2 * 1024 * 1024;

function getCoreNodeHandler() {
  if (coreNodeHandler) return coreNodeHandler;
  coreHandler = createMcpHandler(
    context => {
      const authInfo = context.authInfo || {};
      const authMode = String(authInfo.authMode || 'oauth');
      return createRelaiMcpServer({
        publicHttpOnly: true,
        transportType: 'streamable-http',
        nativeTasks: context.era === 'modern',
        legacyCompatibility: context.era === 'legacy',
        principal: createHttpTaskPrincipal(authInfo, authMode)
      });
    },
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
  const authorizationResult = mcpAuthorization(ctx.req, ctx.options);
  if (!authorizationResult) {
    mcpConnectionManager.noteAuthenticationFailure('invalid_or_missing_bearer');
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
    const raw = await readRawBody(ctx.req, Math.min(ctx.options.maxBodyBytes, DEFAULT_MCP_BODY_LIMIT));
    message = raw.trim() ? JSON.parse(raw) : null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendMcpProtocolError(ctx.res, 400, -32700, 'Parse error.');
      return;
    }
    throw error;
  }

  const authMode = authorizationResult.authMode;
  const authInfo = { ...authorizationResult.authInfo, authMode };
  const principalId = authInfo.clientId;
  const principal = createHttpTaskPrincipal(authInfo, authMode);
  ctx.req.auth = authInfo;
  const config = readConfig();
  if (Array.isArray(message)) {
    sendMcpProtocolError(ctx.res, 400, -32600, 'One JSON-RPC request object is required; batches are not supported.');
    return;
  }
  if (headerValue(ctx.req.headers, 'mcp-session-id')) {
    sendMcpProtocolError(ctx.res, 400, -32600, 'Mcp-Session-Id is not supported by this stateless endpoint.', message?.id);
    return;
  }
  const legacy = await isLegacyHttpRequest(ctx.req, message);
  const params = objectValue(message?.params);
  const meta = legacy ? {} : objectValue(params._meta);
  const releasePrincipalRequest = acquirePrincipalRequest(principalId);
  if (!releasePrincipalRequest) {
    sendMcpProtocolError(ctx.res, 429, -32023, 'Too many concurrent MCP requests for this client.', message?.id, { retryable: true });
    return;
  }
  const requestId = mcpConnectionManager.beginRequest({
    principal: principalId,
    method: message?.method,
    authMode,
    clientInfo: legacy ? params.clientInfo : meta[CLIENT_INFO_META_KEY],
    clientCapabilities: legacy ? params.capabilities : meta[CLIENT_CAPABILITIES_META_KEY]
  });
  let requestFinished = false;
  const finishRequest = (ok) => {
    if (requestFinished) return;
    requestFinished = true;
    mcpConnectionManager.finishRequest(requestId, { method: message?.method, ok });
  };

  try {
    if (legacy) {
      const manifest = buildToolManifest(config);
      await mcpConnectionManager.observeManifest(manifest, message?.method);
      await runSpan(config, 'relai.mcp.request', {
        'mcp.protocol.version': String(params.protocolVersion || headerValue(ctx.req.headers, 'mcp-protocol-version') || 'legacy'),
        'mcp.method': String(message?.method || ''),
        'oauth.client_id': principalId
      }, async () => {
        await getCoreNodeHandler()(ctx.req, ctx.res, message);
        finishRequest(ctx.res.statusCode < 400);
      }, { carrier: ctx.req.headers });
      return;
    }

    const validation = validateMcpRequestHeaders(ctx.req.headers, message);
    if (!validation.ok) {
      finishRequest(false);
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

    const manifest = buildToolManifest(config);
    await mcpConnectionManager.observeManifest(manifest, message.method);

    await runSpan(config, 'relai.mcp.request', {
      'mcp.protocol.version': MCP_PROTOCOL_VERSION,
      'mcp.method': message.method,
      'oauth.client_id': principalId
    }, async () => {
      const requestAbort = createHttpRequestAbortScope(ctx.req, ctx.res);
      try {
        const transportResponse = await handleTransportTaskRequest(config, message, {
          principal,
          transportType: 'streamable-http',
          envelope: meta,
          authInfo,
          requestHeaders: ctx.req.headers,
          signal: requestAbort.signal
        });
        if (transportResponse) {
          finishRequest(!transportResponse.body?.error);
          sendTransportResponse(ctx, transportResponse);
          return;
        }
        await getCoreNodeHandler()(ctx.req, ctx.res, message);
        finishRequest(ctx.res.statusCode < 400);
      } finally {
        requestAbort.dispose();
      }
    }, { carrier: ctx.req.headers });
  } catch (error) {
    finishRequest(false);
    throw error;
  } finally {
    releasePrincipalRequest();
  }
}

function acquirePrincipalRequest(principalId) {
  const key = String(principalId || 'anonymous');
  const active = Number(activePrincipalRequests.get(key) || 0);
  if (active >= MAX_CONCURRENT_REQUESTS_PER_PRINCIPAL) return null;
  activePrincipalRequests.set(key, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Number(activePrincipalRequests.get(key) || 1) - 1;
    if (remaining > 0) activePrincipalRequests.set(key, remaining);
    else activePrincipalRequests.delete(key);
  };
}

async function handleUnsupportedHttpMethod(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  if (!mcpAuthorization(ctx.req, ctx.options)) {
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
  const envelope = validateJsonRpcRequestEnvelope(message);
  if (!envelope.ok) return rejection(400, envelope.code, envelope.error, envelope.data);
  if (headerValue(headers, 'mcp-session-id')) {
    return rejection(400, -32600, 'Mcp-Session-Id is not supported by MCP 2026-07-28.');
  }
  if (LEGACY_LIFECYCLE_METHODS.includes(message.method)) {
    return rejection(400, -32601, `Initialize lifecycle methods are not valid inside a modern MCP request envelope: ${message.method}.`);
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

async function isLegacyHttpRequest(req, message) {
  const request = await toWebRequest(req, message);
  return isLegacyRequest(request, message);
}

function sendTransportResponse(ctx, response) {
  if (response.body == null) {
    ctx.res.statusCode = response.status || 204;
    ctx.res.end();
    return;
  }
  sendJson(ctx.res, response.status || 200, response.body, ctx.ae);
}

function expectedMcpName(method, params = {}) {
  if (method === 'tools/call' || method === 'prompts/get') return String(params.name || '');
  if (['resources/read', 'resources/subscribe', 'resources/unsubscribe'].includes(method)) {
    return String(params.uri || '');
  }
  if (TASK_METHODS.includes(method)) return String(params.taskId || '');
  return '';
}

function createHttpRequestAbortScope(req, res) {
  const controller = new AbortController();
  const abort = message => {
    if (!controller.signal.aborted) controller.abort(new Error(message));
  };
  const onRequestAborted = () => abort('HTTP MCP request was aborted by the client.');
  const onResponseClosed = () => {
    if (!res.writableEnded) abort('HTTP MCP response connection closed before completion.');
  };
  const onSocketClosed = () => {
    if (!res.writableEnded) abort('HTTP MCP connection closed before completion.');
  };
  req.once('aborted', onRequestAborted);
  res.once('close', onResponseClosed);
  req.socket?.once('close', onSocketClosed);
  if (req.aborted || res.destroyed) onRequestAborted();
  return {
    signal: controller.signal,
    dispose() {
      req.off('aborted', onRequestAborted);
      res.off('close', onResponseClosed);
      req.socket?.off('close', onSocketClosed);
    }
  };
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
  createHttpRequestAbortScope,
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
