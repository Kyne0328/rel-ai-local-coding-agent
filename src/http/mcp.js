const crypto = require("node:crypto");
const { URL } = require("node:url");
const { handleMessage } = require("../server");
const pkg = require("../../package.json");
const { getVersion } = require("../version");
const oauth = require("../oauthProvider");
const {
  resolveBaseUrl,
  isMcpAuthorized,
  unauthorizedMcp,
  oauthErrorPage,
  isOAuthAuthorized
} = require("./auth");
const { readJsonBody, readFormOrJsonBody, sendJson, sendHtml, sendSse, isAuthorized } = require("./io");

const sessions = new Map();

function handleOauthProtectedResource(ctx) {
  sendJson(ctx.res, 200, oauth.protectedResourceMetadata(resolveBaseUrl(ctx.options)), ctx.ae);
}

function handleOauthMetadata(ctx) {
  sendJson(ctx.res, 200, oauth.authorizationServerMetadata(resolveBaseUrl(ctx.options)), ctx.ae);
}

async function handleRegister(ctx) {
  const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const result = oauth.registerClient(body);
  sendJson(ctx.res, result.error ? 400 : 201, result, ctx.ae);
}

async function handleAuthorizeGet(ctx) {
  const query = Object.fromEntries(ctx.parsed.searchParams.entries());
  const check = oauth.validateAuthorizationRequest(query);
  if (!check.ok) {
    if (check.redirectError && check.redirectUri) {
      ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.redirectUri, { error: check.error, error_description: check.error_description, state: check.state }) });
      ctx.res.end();
      return;
    }
    sendHtml(ctx.res, 400, oauthErrorPage(check.error_description || check.error));
    return;
  }
  sendHtml(ctx.res, 200, oauth.renderLoginPage(check.request, resolveBaseUrl(ctx.options)));
}

async function handleAuthorizePost(ctx) {
  const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const check = oauth.validateAuthorizationRequest(body);
  if (!check.ok) { sendHtml(ctx.res, 400, oauthErrorPage(check.error_description || check.error)); return; }
  if (!ctx.options.token) {
    const base = resolveBaseUrl(ctx.options);
    let isLocal = true;
    try { const { hostname } = new URL(base); isLocal = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"; }
    catch {}
    if (!isLocal) { sendHtml(ctx.res, 403, oauthErrorPage("OAuth approval requires REL_AI_MCP_TOKEN when accessed over a public URL. Set a token and restart.")); return; }
  }
  if (!oauth.verifyLogin(body.dashboard_token, ctx.options.token)) {
    sendHtml(ctx.res, 401, oauth.renderLoginPage(check.request, resolveBaseUrl(ctx.options), { error: "Incorrect dashboard token. Try again." }));
    return;
  }
  const code = oauth.issueAuthorizationCode(check.request);
  ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.request.redirectUri, { code, state: check.request.state }) });
  ctx.res.end();
}

async function handleToken(ctx) {
  const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const result = oauth.exchangeToken(body);
  ctx.res.setHeader("Cache-Control", "no-store");
  sendJson(ctx.res, result.status, result.body, ctx.ae);
}

function handleMcpGetDiagnostic(ctx) {
  sendJson(ctx.res, 200, mcpGetDiagnostic(ctx.parsed.pathname, ctx.options, ctx.mcpAccess, ctx.req), ctx.ae);
}

async function handleMcpStreamable(ctx) {
  if (!isMcpAuthorized(ctx.req, ctx.options)) { unauthorizedMcp(ctx.res, resolveBaseUrl(ctx.options)); return; }
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const sessionId = streamableSessionId(ctx.req, payload);
  if (sessionId) ctx.res.setHeader('Mcp-Session-Id', sessionId);
  const response = await handleJsonRpcPayload(payload, {
    publicHttpOnly: true,
    taskScopeId: resolveTaskScopeId(ctx.req, payload, sessionId)
  });
  if (response === null) { sendJson(ctx.res, 202, { ok: true, accepted: true }, ctx.ae); return; }
  sendJson(ctx.res, 200, response, ctx.ae);
}

function handleMcpSse(ctx) {
  if (!isMcpAuthorized(ctx.req, ctx.options)) { unauthorizedMcp(ctx.res, resolveBaseUrl(ctx.options)); return; }
  openSseSession(ctx.res, ctx.req, ctx.mcpAccess.messagePath);
}

async function handleMcpMessages(ctx) {
  if (!isMcpAuthorized(ctx.req, ctx.options)) { unauthorizedMcp(ctx.res, resolveBaseUrl(ctx.options)); return; }
  const sessionId = ctx.parsed.searchParams.get("sessionId") || "";
  const session = sessions.get(sessionId);
  if (!session) { sendJson(ctx.res, 404, { ok: false, error: "Unknown or expired SSE session." }, ctx.ae); return; }
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const response = await handleJsonRpcPayload(payload, {
    publicHttpOnly: true,
    taskScopeId: resolveTaskScopeId(ctx.req, payload, sessionId)
  });
  if (response !== null) sendSse(session.res, "message", response);
  sendJson(ctx.res, 202, { ok: true, accepted: true }, ctx.ae);
}

// The MCP transport endpoints. The legacy secret-in-URL no-auth path
// (/mcp/<secret>) has been removed — access is granted only by OAuth or the local
// bearer token, enforced in isMcpAuthorized.
function getMcpAccess(pathname) {
  if (pathname === "/mcp") return { kind: "streamable-http" };
  if (pathname === "/sse") return { kind: "sse", messagePath: "/messages" };
  if (pathname === "/messages") return { kind: "messages" };
  return { kind: "none" };
}

function mcpGetDiagnostic(pathname, options, mcpAccess, req) {
  const cleanBase = resolveBaseUrl(options);
  const usableWithPost = Boolean(isAuthorized(req, options) || isOAuthAuthorized(req) || options.allowNoAuth);
  return {
    ok: true,
    endpoint: pathname,
    reachable: true,
    note: "This is a GET browser diagnostic. MCP clients must send JSON-RPC with POST.",
    // The ChatGPT connector uses real OAuth: add this plain /mcp URL with
    // Authentication: OAuth. ChatGPT discovers the auth endpoints automatically.
    correctChatGPTUrl: `${cleanBase}/mcp`,
    chatgptAuth: "OAuth",
    oauthProtectedResource: `${cleanBase}/.well-known/oauth-protected-resource`,
    oauthAuthorizationServer: `${cleanBase}/.well-known/oauth-authorization-server`,
    plainMcpUrl: "/mcp is the OAuth-protected MCP endpoint. ChatGPT uses Authentication: OAuth; local/API clients may use a Bearer token instead.",
    postRequired: true,
    usableWithPost,
    examples: {
      health: "/health",
      dashboard: "/dashboard",
      chatgptMcp: "/mcp",
      oauthDiscovery: "/.well-known/oauth-protected-resource",
      localBearerMcp: "/mcp"
    }
  };
}

async function handleJsonRpcPayload(payload, options = {}) {
  if (Array.isArray(payload)) {
    const responses = await Promise.all(payload.map(item => handleMessage(item, options)));
    const visible = responses.filter(Boolean);
    return visible.length > 0 ? visible : null;
  }
  return handleMessage(payload, options);
}

function streamableSessionId(req, payload) {
  const existing = req?.headers?.['mcp-session-id'];
  if (existing) return String(Array.isArray(existing) ? existing[0] : existing);
  const messages = Array.isArray(payload) ? payload : [payload];
  return messages.some(message => message?.method === 'initialize') ? crypto.randomUUID() : '';
}

function resolveTaskScopeId(req, payload, explicitSessionId = '') {
  const headers = req?.headers || {};
  const first = values => values.map(value => Array.isArray(value) ? value[0] : value).find(Boolean);
  const conversationHeader = first([
    headers['x-openai-conversation-id'],
    headers['x-chatgpt-conversation-id'],
    headers['openai-conversation-id']
  ]);
  const transportHeader = first([
    headers['x-openai-session-id'],
    headers['mcp-session-id']
  ]);
  const message = Array.isArray(payload) ? payload[0] : payload;
  const meta = message?.params?._meta || message?._meta || {};
  const metadataConversation = first([
    meta['openai/conversationId'],
    meta.conversationId
  ]);
  const metadataSession = first([
    meta['openai/sessionId'],
    meta.sessionId
  ]);
  const remoteAddress = String(req?.socket?.remoteAddress || 'connector');
  const remotePort = String(req?.socket?.remotePort || 'unknown');
  const fallback = `${remoteAddress}:${remotePort}`;
  // Conversation identity must outlive a transport reconnect. Using Mcp-Session-Id
  // first split validation and relai_complete_task into separate work sessions when
  // ChatGPT rotated the HTTP transport between tool calls.
  const source = String(
    conversationHeader || metadataConversation || metadataSession ||
    transportHeader || explicitSessionId || fallback
  );
  return `mcp:${crypto.createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function openSseSession(res, req, messagePath = "/messages") {
  const sessionId = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const session = { id: sessionId, res, createdAt: new Date().toISOString() };
  sessions.set(sessionId, session);

  sendSse(res, "endpoint", `${messagePath}?sessionId=${encodeURIComponent(sessionId)}`);
  sendSse(res, "ready", { ok: true, sessionId, name: pkg.name, version: getVersion() });

  const keepAlive = setInterval(() => {
    if (!sessions.has(sessionId)) return clearInterval(keepAlive);
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
}

module.exports = {
  handleOauthProtectedResource,
  handleOauthMetadata,
  handleRegister,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleToken,
  handleMcpGetDiagnostic,
  handleMcpStreamable,
  handleMcpSse,
  handleMcpMessages,
  getMcpAccess,
  handleJsonRpcPayload,
  resolveTaskScopeId,
  streamableSessionId
};
