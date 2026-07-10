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
  const response = await handleJsonRpcPayload(payload, { publicHttpOnly: true });
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
  const response = await handleJsonRpcPayload(payload, { publicHttpOnly: true });
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
    const responses = [];
    for (const item of payload) {
      const response = await handleMessage(item, options);
      if (response) responses.push(response);
    }
    return responses.length > 0 ? responses : null;
  }
  return handleMessage(payload, options);
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
  handleJsonRpcPayload
};
