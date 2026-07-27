const { URL } = require("node:url");
const { createMcpHandler } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { createRelaiMcpServer } = require('../mcpServer');
const oauth = require("../oauthProvider");
const {
  resolveBaseUrl,
  isMcpAuthorized,
  unauthorizedMcp,
  oauthErrorPage,
  isOAuthAuthorized
} = require("./auth");
const { readJsonBody, readFormOrJsonBody, sendJson, sendHtml, isAuthorized } = require("./io");

const sdkHttpHandler = createMcpHandler(
  () => createRelaiMcpServer({ publicHttpOnly: true, transportType: 'streamable-http' }),
  {
    legacy: 'stateless',
    onerror: reportSdkError
  }
);
const nodeMcpHandler = toNodeHandler(sdkHttpHandler, { onerror: reportSdkError });

function reportSdkError(error) {
  if (process.env.REL_AI_MCP_DEBUG) {
    console.error('[rel-ai-mcp] MCP SDK HTTP error:', error instanceof Error ? error.message : String(error));
  }
}

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
  const check = oauth.validateAuthorizationRequest(query, { allowClientRecovery: true });
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
  const check = oauth.validateAuthorizationRequest(body, { allowClientRecovery: true });
  if (!check.ok) { sendHtml(ctx.res, 400, oauthErrorPage(check.error_description || check.error)); return; }
  if (!ctx.options.token) {
    const base = resolveBaseUrl(ctx.options);
    let isLocal = true;
    try { const { hostname } = new URL(base); isLocal = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"; }
    catch {}
    if (!isLocal) { sendHtml(ctx.res, 403, oauthErrorPage("OAuth approval requires REL_AI_MCP_TOKEN when accessed over a public URL. Set a token and restart.")); return; }
  }
  if (!oauth.verifyLogin(body.dashboard_token, ctx.options.token)) {
    sendHtml(ctx.res, 401, oauth.renderLoginPage(check.request, resolveBaseUrl(ctx.options), { error: "Incorrect approval token. Copy the current token from Rel.AI Settings > Connection and try again." }));
    return;
  }
  const code = oauth.issueAuthorizationCode(check.request);
  if (typeof ctx.options.onOAuthAuthorized === "function") {
    try { ctx.options.onOAuthAuthorized(); }
    catch (error) { if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] OAuth authorization callback:', error); }
  }
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
  sendJson(ctx.res, 200, mcpGetDiagnostic(ctx.parsed.pathname, ctx.options, ctx.req), ctx.ae);
}

async function handleMcpStreamable(ctx) {
  if (!isMcpAuthorized(ctx.req, ctx.options)) {
    unauthorizedMcp(ctx.res, resolveBaseUrl(ctx.options), ctx.req);
    return;
  }
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  await nodeMcpHandler(ctx.req, ctx.res, payload);
}

function getMcpAccess(pathname) {
  return pathname === "/mcp" ? { kind: "streamable-http" } : { kind: "none" };
}

function mcpGetDiagnostic(pathname, options, req) {
  const cleanBase = resolveBaseUrl(options);
  const usableWithPost = Boolean(isAuthorized(req, options) || isOAuthAuthorized(req) || options.allowNoAuth);
  return {
    ok: true,
    endpoint: pathname,
    reachable: true,
    note: "This is a GET browser diagnostic. MCP clients must send protocol requests with POST.",
    correctChatGPTUrl: `${cleanBase}/mcp`,
    chatgptAuth: "OAuth",
    oauthProtectedResource: `${cleanBase}/.well-known/oauth-protected-resource`,
    oauthAuthorizationServer: `${cleanBase}/.well-known/oauth-authorization-server`,
    plainMcpUrl: "/mcp is the OAuth-protected MCP endpoint. ChatGPT uses Authentication: OAuth; local/API clients may use a Bearer token instead.",
    postRequired: true,
    usableWithPost,
    protocolImplementation: "@modelcontextprotocol/server v2",
    examples: {
      health: "/health",
      dashboard: "/dashboard",
      chatgptMcp: "/mcp",
      oauthDiscovery: "/.well-known/oauth-protected-resource",
      localBearerMcp: "/mcp"
    }
  };
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
  getMcpAccess
};
