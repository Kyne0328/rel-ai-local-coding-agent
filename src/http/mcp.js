'use strict';

const { toNodeHandler } = require('@modelcontextprotocol/node');
const { createMcpHandler } = require('@modelcontextprotocol/server');
const { createRelaiMcpServer } = require('../mcpServer');
const oauth = require('../oauthProvider');
const {
  resolveBaseUrl,
  isMcpAuthorized,
  oauthAuthorization,
  unauthorizedMcp,
  oauthErrorPage
} = require('./auth');
const { readRawBody, readFormOrJsonBody, sendJson, sendHtml } = require('./io');
const { runSpan } = require('../telemetry');
const { readConfig } = require('../config');
const {
  expectedNativeTaskName,
  handleNativeTasksProbeRequest
} = require('../nativeTasksProbe');

const MCP_PROTOCOL_VERSION = '2026-07-28';
let nodeMcpHandler = null;

function getNodeMcpHandler() {
  if (!nodeMcpHandler) {
    const handler = createMcpHandler(
      () => createRelaiMcpServer({ publicHttpOnly: true, transportType: 'streamable-http' }),
      { legacy: 'reject' }
    );
    nodeMcpHandler = toNodeHandler(handler, {
      onerror: error => { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] MCP adapter:', error); }
    });
  }
  return nodeMcpHandler;
}

function getMcpAccess(pathname) {
  return pathname === '/mcp' ? { kind: 'streamable-http' } : { kind: 'none' };
}

async function handleOauthProtectedResource(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  sendJson(ctx.res, 200, oauth.protectedResourceMetadata(baseUrl));
}

async function handleOauthMetadata(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  sendJson(ctx.res, 200, oauth.authorizationServerMetadata(baseUrl));
}

async function handleRegister(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.register', { 'oauth.issuer': baseUrl }, async () => {
    const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const result = oauth.registerClient(body, baseUrl);
    sendJson(ctx.res, result.error ? 400 : 201, result);
  }, { carrier: ctx.req.headers });
}

function authorizationQuery(parsed) {
  return Object.fromEntries(parsed.searchParams.entries());
}

async function handleAuthorizeGet(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.authorize', { 'oauth.issuer': baseUrl, 'oauth.phase': 'request' }, async () => {
    const check = oauth.validateAuthorizationRequest(authorizationQuery(ctx.parsed), { issuer: baseUrl });
    if (!check.ok) {
      if (check.redirectError && check.redirectUri) {
        ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.redirectUri, { error: check.error, error_description: check.error_description, state: check.state, iss: check.issuer || baseUrl }) });
        ctx.res.end();
        return;
      }
      sendHtml(ctx.res, 400, oauthErrorPage(check.error_description));
      return;
    }
    sendHtml(ctx.res, 200, oauth.renderLoginPage(check.request, baseUrl));
  }, { carrier: ctx.req.headers });
}

async function handleAuthorizePost(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.authorize', { 'oauth.issuer': baseUrl, 'oauth.phase': 'approval' }, async () => {
    const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const check = oauth.validateAuthorizationRequest(body, { issuer: baseUrl });
    if (!check.ok) {
      if (check.redirectError && check.redirectUri) {
        ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.redirectUri, { error: check.error, error_description: check.error_description, state: check.state, iss: check.issuer || baseUrl }) });
        ctx.res.end();
        return;
      }
      sendHtml(ctx.res, 400, oauthErrorPage(check.error_description));
      return;
    }
    if (!oauth.verifyLogin(body.dashboard_token, ctx.options.token)) {
      sendHtml(ctx.res, 401, oauth.renderLoginPage(check.request, baseUrl, { error: 'Incorrect approval token. Copy the current token from Rel.AI Settings > Connection and try again.' }));
      return;
    }
    const code = oauth.issueAuthorizationCode(check.request, baseUrl);
    if (typeof ctx.options.onOAuthAuthorized === 'function') {
      try { ctx.options.onOAuthAuthorized(); } catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] OAuth authorization callback:', error); }
    }
    ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.request.redirectUri, { code, state: check.request.state, iss: baseUrl }) });
    ctx.res.end();
  }, { carrier: ctx.req.headers });
}

async function handleToken(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.token', { 'oauth.issuer': baseUrl }, async () => {
    const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const result = oauth.exchangeToken(body, baseUrl);
    sendJson(ctx.res, result.status, result.body);
  }, { carrier: ctx.req.headers });
}

async function handleMcpGetDiagnostic(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  if (!isMcpAuthorized(ctx.req, ctx.options)) {
    unauthorizedMcp(ctx.res, baseUrl, ctx.req);
    return;
  }
  sendJson(ctx.res, 405, {
    ok: false,
    error: 'MCP 2026-07-28 uses stateless POST requests. GET streams and protocol sessions are not supported.',
    protocolVersion: MCP_PROTOCOL_VERSION
  });
}

async function handleMcpStreamable(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  if (!isMcpAuthorized(ctx.req, ctx.options)) {
    unauthorizedMcp(ctx.res, baseUrl, ctx.req);
    return;
  }
  await runSpan(readConfig(), 'relai.mcp.request', {
    'mcp.protocol.version': String(ctx.req.headers['mcp-protocol-version'] || ''),
    'mcp.method': String(ctx.req.headers['mcp-method'] || ''),
    'mcp.name': String(ctx.req.headers['mcp-name'] || ''),
    'oauth.client_id': oauthAuthorization(ctx.req, ctx.options)?.clientId || ''
  }, async () => {
    const raw = await readRawBody(ctx.req, ctx.options.maxBodyBytes);
    let message;
    try { message = raw.trim() ? JSON.parse(raw) : null; }
    catch { return sendMcpProtocolError(ctx.res, 400, -32700, 'Parse error.'); }
    const validation = validateMcpRequestHeaders(ctx.req.headers, message);
    if (!validation.ok) return sendMcpProtocolError(ctx.res, validation.status, validation.code, validation.error, message?.id);
    const authorization = oauthAuthorization(ctx.req, ctx.options) || { clientId: 'static-bearer' };
    ctx.req.auth = authorization;
    const nativeTasksResponse = handleNativeTasksProbeRequest(readConfig(), message, authorization.clientId || 'static-bearer');
    if (nativeTasksResponse) {
      sendJson(ctx.res, nativeTasksResponse.status, nativeTasksResponse.body, ctx.ae);
      return;
    }
    await getNodeMcpHandler()(ctx.req, ctx.res, message);
  }, { carrier: ctx.req.headers });
}

function validateMcpRequestHeaders(headers = {}, message) {
  if (headers['mcp-session-id']) return { ok: false, status: 400, code: -32600, error: 'Mcp-Session-Id is not valid in MCP 2026-07-28.' };
  const protocolVersion = String(headers['mcp-protocol-version'] || '');
  if (protocolVersion !== MCP_PROTOCOL_VERSION) return { ok: false, status: 400, code: -32022, error: `MCP-Protocol-Version must be ${MCP_PROTOCOL_VERSION}.` };
  if (!message || Array.isArray(message) || typeof message !== 'object') return { ok: false, status: 400, code: -32600, error: 'One JSON-RPC request object is required; batches are not supported.' };
  const bodyMethod = String(message.method || '');
  const headerMethod = String(headers['mcp-method'] || '');
  if (!headerMethod) return { ok: false, status: 400, code: -32600, error: 'Mcp-Method header is required.' };
  if (headerMethod !== bodyMethod) return { ok: false, status: 400, code: -32600, error: 'Mcp-Method header does not match the JSON-RPC method.' };
  if (bodyMethod === 'initialize' || bodyMethod === 'notifications/initialized') return { ok: false, status: 400, code: -32601, error: 'The initialize handshake was removed in MCP 2026-07-28. Use server/discover.' };
  const bodyName = expectedMcpName(bodyMethod, message.params || {});
  const headerName = String(headers['mcp-name'] || '');
  if (bodyName && !headerName) return { ok: false, status: 400, code: -32600, error: `Mcp-Name header is required for ${bodyMethod}.` };
  if (bodyName && headerName !== bodyName) return { ok: false, status: 400, code: -32600, error: 'Mcp-Name header does not match the named request target.' };
  if (!bodyName && headerName) return { ok: false, status: 400, code: -32600, error: 'Mcp-Name is only valid for a named MCP request.' };
  return { ok: true };
}

function expectedMcpName(method, params) {
  if (method === 'tools/call' || method === 'prompts/get') return String(params.name || '');
  if (['resources/read', 'resources/subscribe', 'resources/unsubscribe'].includes(method)) return String(params.uri || '');
  return expectedNativeTaskName(method, params);
}

function sendMcpProtocolError(res, status, code, message, id = null) {
  sendJson(res, status, { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function oauthWellKnownPaths(baseUrl) {
  const issuer = new URL(oauth.canonicalIssuer(baseUrl));
  const issuerPath = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '');
  return {
    protectedResource: `/.well-known/oauth-protected-resource/mcp`,
    authorizationServer: `/.well-known/oauth-authorization-server${issuerPath}`,
    openidConfiguration: `${issuerPath}/.well-known/openid-configuration`
  };
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  getMcpAccess,
  handleOauthProtectedResource,
  handleOauthMetadata,
  handleRegister,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleToken,
  handleMcpGetDiagnostic,
  handleMcpStreamable,
  validateMcpRequestHeaders,
  expectedMcpName,
  oauthWellKnownPaths
};
