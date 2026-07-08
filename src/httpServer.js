const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { URL } = require("node:url");
const { handleMessage } = require("./server");
const { readConfig } = require("./config");
const productUx = require("./productUx");
const release = require("./release");
const configEditor = require("./configEditor");
const pkg = require("../package.json");
const connection = require("./connectionProfile");
const { getVersion } = require("./version");
const oauth = require("./oauthProvider");

function buildToolMetadata() {
  const { getPublicToolSchemas } = require("./tools");
  const config = readConfig({ allowMissing: true });
  return getPublicToolSchemas(config).map(tool => ({
    name: tool.name,
    displayName: tool.name.replace(/^relai_/, "").replaceAll("_", " "),
    description: tool.description || "",
    category: "Workspace tools",
    requiredProfile: "workspace",
    requiresApproval: false,
    parameters: tool.inputSchema ? Object.keys(tool.inputSchema.properties || {}) : [],
  }));
}

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const sessions = new Map();

function startHttpServer(options = {}) {
  const launchEnv = connection.readLaunchEnv();
  const savedProfile = connection.readConnectionProfile();
  const host = options.host || process.env.REL_AI_MCP_HOST || savedProfile.host || "127.0.0.1";
  const port = Number(options.port ?? process.env.REL_AI_MCP_PORT ?? 3333);
  const token = options.token || process.env.REL_AI_MCP_TOKEN || launchEnv.REL_AI_MCP_TOKEN || "";
  const publicUrl = connection.normalizePublicUrl(options.publicUrl || process.env.REL_AI_MCP_PUBLIC_URL || launchEnv.REL_AI_MCP_PUBLIC_URL || savedProfile.publicUrl || "");
  const allowNoAuth = Boolean(options.allowNoAuth || process.env.REL_AI_MCP_ALLOW_NO_AUTH === "1");
  const maxBodyBytes = Number(options.maxBodyBytes || process.env.REL_AI_MCP_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  // Native folder picker, injected by the Electron launcher (the HTTP server runs
  // in the same process). Absent when the server runs standalone — the endpoint then
  // reports unsupported and the dashboard falls back to manual path entry.
  const pickFolder = typeof options.pickFolder === "function" ? options.pickFolder : null;

  if (!token && !allowNoAuth) {
    throw new Error("REL_AI_MCP_TOKEN is required for the HTTP/SSE server. Set a strong token, or set REL_AI_MCP_ALLOW_NO_AUTH=1 for local-only testing.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { token, allowNoAuth, maxBodyBytes, host, port, publicUrl, pickFolder });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`[rel-ai-mcp] Port ${port} is already in use. Stop the other process or use --port to pick a different port.`);
    } else {
      console.error(`[rel-ai-mcp] Server error: ${error.message}`);
    }
    if (options.exitOnError === false) return;
    process.exit(1);
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    console.error(`[rel-ai-mcp] HTTP/SSE server listening on http://${host}:${actualPort}`);
    connection.writeConnectionProfile({ host, port: actualPort, publicUrl, configPath: require("./config").getConfigPath() });
    const summary = connection.buildConnectionSummary({ host, port: actualPort, publicUrl, token });
    console.error(`[rel-ai-mcp] Dashboard: ${summary.dashboardUrl}`);
    if (publicUrl) {
      console.error(`[rel-ai-mcp] ChatGPT MCP URL: ${summary.chatgptMcpUrl}`);
      console.error("[rel-ai-mcp] ChatGPT Auth: OAuth (sign in with your dashboard token)");
    } else {
      console.error("[rel-ai-mcp] No permanent public URL configured. Use rel-ai-mcp-launch --public-url https://your-domain.example.com when your tunnel is ready.");
      console.error(`[rel-ai-mcp] Local ChatGPT-style URL for diagnostics only: ${summary.chatgptMcpUrl}`);
    }
    if (!token) {
      console.error("[rel-ai-mcp] Notice: HTTP/SSE auth is disabled. Use only on a trusted local network.");
    }
  });

  return server;
}

// ---- Route dispatch infrastructure ------------------------------------------------

function authDashboard(ctx) {
  if (isDashboardAuthorized(ctx.req, ctx.parsed, ctx.options)) return true;
  unauthorized(ctx.res); return false;
}
function authNone() { return true; }

// ---- Route handlers ---------------------------------------------------------------

async function handleFavicon(ctx) {
  try {
    const content = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "favicon.ico"));
    ctx.res.writeHead(200, { "Content-Type": "image/x-icon", "Cache-Control": "no-cache" });
    ctx.res.end(content);
  } catch { ctx.res.writeHead(404); ctx.res.end("Not found"); }
}

function handleHealth(ctx) {
  sendJson(ctx.res, 200, {
    ok: true, name: pkg.name, version: getVersion(),
    transports: ["streamable-http", "sse"],
    auth: ctx.options.token ? "bearer" : "disabled"
  }, ctx.ae);
}

function handleStaticAsset(ctx) {
  const safePath = ctx.parsed.pathname.replaceAll("\\", "/");
  if (safePath.includes("..")) { ctx.res.writeHead(400); ctx.res.end("Bad path"); return; }
  const filePath = safePath.startsWith("/ui/")
    ? path.join(__dirname, "ui", safePath.slice(4))
    : path.join(__dirname, "..", "public", safePath.slice(8));
  try {
    const content = fs.readFileSync(filePath);
    const ct = contentTypeForStaticAsset(safePath);
    const charset = ct.startsWith("text/") || ct === "application/javascript" ? "; charset=utf-8" : "";
    ctx.res.writeHead(200, { "Content-Type": ct + charset, "Cache-Control": "no-cache" });
    ctx.res.end(content);
  } catch { ctx.res.writeHead(404); ctx.res.end("Not found"); }
}

function handleDashboard(ctx) { sendHtml(ctx.res, 200, renderDashboardHtml(ctx.options)); }

function handleApiSettingsGet(ctx) {
  sendJson(ctx.res, 200, configEditor.settingsPayload(readConfig()), ctx.ae);
}

function handleApiTools(ctx) {
  try { sendJson(ctx.res, 200, buildToolMetadata(), ctx.ae); }
  catch (err) { sendJson(ctx.res, 500, { ok: false, error: err.message }, ctx.ae); }
}

function handleOnboardingStatus(ctx) {
  const onboardingPath = path.join(require("node:os").homedir(), ".rel-ai-mcp", "onboarding.json");
  let flag = null;
  try { flag = JSON.parse(fs.readFileSync(onboardingPath, "utf8")); } catch {}
  sendJson(ctx.res, 200, {
    ok: true, completed: flag ? flag.completed : false, skipped: flag ? flag.skipped : false,
    needsOnboarding: flag?.completed !== true
  }, ctx.ae);
}

function handleConnection(ctx) {
  const latestProfile = connection.readConnectionProfile();
  sendJson(ctx.res, 200, connection.buildConnectionSummary({
    host: latestProfile.host || ctx.options.host,
    port: latestProfile.port || ctx.options.port,
    publicUrl: latestProfile.publicUrl || ctx.options.publicUrl,
    token: ctx.options.token,
    tunnelProvider: latestProfile.tunnelProvider || "none",
    showToken: ctx.parsed.searchParams.get("showToken") === "1"
  }), ctx.ae);
}

function handleDashboardV10(ctx) {
  const config = readConfig();
  sendJson(ctx.res, 200, {
    ...productUx.dashboardData(config, { limit: Number(ctx.parsed.searchParams.get("limit") || 100) }),
    readiness: release.releaseReadiness(config, { requireHttpToken: resolveRequireHttpToken(ctx.parsed, config) })
  }, ctx.ae);
}

const handleApiLogs = (ctx) => sendJson(ctx.res, 200, productUx.liveLogTail(readConfig(), { limit: Number(ctx.parsed.searchParams.get("limit") || 100) }), ctx.ae);
const handleHealthMonitor = (ctx) => sendJson(ctx.res, 200, productUx.healthMonitor(readConfig(), { limit: Number(ctx.parsed.searchParams.get("limit") || 100) }), ctx.ae);
const handleAliasDiagnostics = (ctx) => sendJson(ctx.res, 200, productUx.aliasConsistencyCheck(readConfig()), ctx.ae);
const handleReleaseNotes = (ctx) => sendJson(ctx.res, 200, require("./releaseNotes").getReleaseNotes(), ctx.ae);
const handleCautionSummary = (ctx) => sendJson(ctx.res, 200, productUx.cautionSummary(readConfig(), { windowHours: Number(ctx.parsed.searchParams.get("windowHours") || 24) }), ctx.ae);
const handleReadiness = (ctx) => sendJson(ctx.res, 200, release.releaseReadiness(readConfig(), { requireHttpToken: resolveRequireHttpToken(ctx.parsed, readConfig()) }), ctx.ae);

async function handleWorkspacePreflight(ctx) {
  const rawPath = ctx.parsed.searchParams.get("path") || "";
  if (rawPath) { sendJson(ctx.res, 200, workspacePathPreflight(rawPath), ctx.ae); return; }
  const config = readConfig();
  sendJson(ctx.res, 200, await release.workspacePreflight(config, {
    workspace: ctx.parsed.searchParams.get("workspace") || "",
    requireClean: ctx.parsed.searchParams.get("requireClean") !== "0"
  }), ctx.ae);
}

function handleEvents(ctx) { openDashboardEvents(ctx.res, ctx.req, ctx.options); }

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

async function handleOnboardingComplete(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const onboardingDir = path.join(require("node:os").homedir(), ".rel-ai-mcp");
  fs.mkdirSync(onboardingDir, { recursive: true });
  fs.writeFileSync(path.join(onboardingDir, "onboarding.json"), JSON.stringify({
    completed: Boolean(payload.completed), skipped: Boolean(payload.skipped), updatedAt: new Date().toISOString()
  }));
  sendJson(ctx.res, 200, { ok: true }, ctx.ae);
}

async function handleApiSettingsPost(ctx) {
  const current = readConfig();
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  sendJson(ctx.res, 200, configEditor.updateSettings(current, payload), ctx.ae);
}

async function handleApiWorkspaces(ctx) {
  const current = readConfig();
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  sendJson(ctx.res, 200, configEditor.updateWorkspace(current, payload), ctx.ae);
}

async function handlePickFolder(ctx) {
  if (typeof ctx.options.pickFolder !== "function") {
    sendJson(ctx.res, 200, { ok: false, unsupported: true, error: "Native folder picker is only available in the Rel.AI desktop launcher." }, ctx.ae);
    return;
  }
  try {
    const picked = await ctx.options.pickFolder();
    if (!picked) { sendJson(ctx.res, 200, { ok: false, canceled: true }, ctx.ae); return; }
    sendJson(ctx.res, 200, { ok: true, ...workspacePathPreflight(picked) }, ctx.ae);
  } catch (error) {
    sendJson(ctx.res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) }, ctx.ae);
  }
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

// ---- Route maps (exact pathname → { auth, handler }) --------------------------------

const NOT_FOUND_PAYLOAD = {
  ok: false, error: "Not found.",
  endpoints: {
    health: "GET /health", dashboard: "GET /dashboard", dashboardV10Api: "GET /api/dashboard/v10",
    logsApi: "GET /api/logs", settingsApi: "GET /api/settings",
    updateSettingsApi: "POST /api/settings", updateWorkspacesApi: "POST /api/workspaces",
    healthMonitorApi: "GET /api/health-monitor", readinessApi: "GET /api/readiness",
    workspacePreflightApi: "GET /api/workspace/preflight?workspace=...", events: "GET /events",
    streamableHttp: "POST /mcp (Authentication: OAuth, or Bearer token)",
    sse: "GET /sse (Authentication: OAuth, or Bearer token) then POST /messages...?sessionId=...",
    oauthDiscovery: "GET /.well-known/oauth-protected-resource"
  }
};

async function routeRequest(req, res, options) {
  setBaseHeaders(req, res, options);
  const ae = req.headers["accept-encoding"] || "";
  const parsed = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const mcpAccess = getMcpAccess(parsed.pathname);
  const ctx = { req, res, options, parsed, ae, mcpAccess, p: parsed.pathname };

  if (req.method === "GET") {
    if (dispatchGet(ctx)) return;
  } else if (req.method === "POST") {
    if (dispatchPost(ctx)) return;
  }

  sendJson(res, 404, NOT_FOUND_PAYLOAD, ae);
}

// ---- GET dispatch -------------------------------------------------------------------

function dispatchGet(ctx) {
  return tryExactGet(ctx) || tryPrefixGet(ctx) || tryOAuthOrMcpGet(ctx);
}

function tryExactGet(ctx) {
  const entry = GET_ROUTES[ctx.p];
  if (!entry) return false;
  if (!entry.auth(ctx)) return true;
  entry.handler(ctx);
  return true;
}

function tryPrefixGet(ctx) {
  const p = ctx.p;
  if (p.startsWith("/ui/") || p.startsWith("/public/")) { handleStaticAsset(ctx); return true; }
  return false;
}

function tryOAuthOrMcpGet(ctx) {
  if (ctx.p === "/.well-known/oauth-protected-resource") { handleOauthProtectedResource(ctx); return true; }
  if (ctx.p === "/.well-known/oauth-authorization-server" || ctx.p === "/.well-known/openid-configuration") { handleOauthMetadata(ctx); return true; }
  if (ctx.p === "/authorize") { handleAuthorizeGet(ctx); return true; }
  if (ctx.p === "/mcp" || ctx.mcpAccess.kind === "streamable-http") { handleMcpGetDiagnostic(ctx); return true; }
  if (ctx.mcpAccess.kind === "sse") { handleMcpSse(ctx); return true; }
  return false;
}

const GET_ROUTES = {
  "/dashboard": { auth: authDashboard, handler: handleDashboard },
  "/favicon.ico": { auth: authNone, handler: handleFavicon },
  "/health": { auth: authNone, handler: handleHealth },
  "/api/settings": { auth: authDashboard, handler: handleApiSettingsGet },
  "/api/tools": { auth: authDashboard, handler: handleApiTools },
  "/api/onboarding/status": { auth: authDashboard, handler: handleOnboardingStatus },
  "/api/connection": { auth: authDashboard, handler: handleConnection },
  "/api/dashboard/v10": { auth: authDashboard, handler: handleDashboardV10 },
  "/api/logs": { auth: authDashboard, handler: handleApiLogs },
  "/api/health-monitor": { auth: authDashboard, handler: handleHealthMonitor },
  "/api/alias-diagnostics": { auth: authDashboard, handler: handleAliasDiagnostics },
  "/api/release-notes": { auth: authDashboard, handler: handleReleaseNotes },
  "/api/caution-summary": { auth: authDashboard, handler: handleCautionSummary },
  "/api/readiness": { auth: authDashboard, handler: handleReadiness },
  "/api/workspace/preflight": { auth: authDashboard, handler: handleWorkspacePreflight },
  "/events": { auth: authDashboard, handler: handleEvents }
};

// ---- POST dispatch ------------------------------------------------------------------

function dispatchPost(ctx) {
  return tryExactPost(ctx) || tryOAuthOrMcpPost(ctx);
}

function tryExactPost(ctx) {
  const entry = POST_ROUTES[ctx.p];
  if (!entry) return false;
  if (!entry.auth(ctx)) return true;
  entry.handler(ctx);
  return true;
}

function tryOAuthOrMcpPost(ctx) {
  if (ctx.p === "/register") { handleRegister(ctx); return true; }
  if (ctx.p === "/authorize") { handleAuthorizePost(ctx); return true; }
  if (ctx.p === "/token") { handleToken(ctx); return true; }
  if (ctx.mcpAccess.kind === "streamable-http") { handleMcpStreamable(ctx); return true; }
  if (ctx.mcpAccess.kind === "messages") { handleMcpMessages(ctx); return true; }
  return false;
}

const POST_ROUTES = {
  "/api/onboarding/complete": { auth: authDashboard, handler: handleOnboardingComplete },
  "/api/settings": { auth: authDashboard, handler: handleApiSettingsPost },
  "/api/workspaces": { auth: authDashboard, handler: handleApiWorkspaces },
  "/api/pick-folder": { auth: authDashboard, handler: handlePickFolder }
};


// The MCP transport endpoints. The legacy secret-in-URL no-auth path
// (/mcp/<secret>) has been removed — access is granted only by OAuth or the local
// bearer token, enforced in isMcpAuthorized.
function getMcpAccess(pathname) {
  if (pathname === "/mcp") return { kind: "streamable-http" };
  if (pathname === "/sse") return { kind: "sse", messagePath: "/messages" };
  if (pathname === "/messages") return { kind: "messages" };
  return { kind: "none" };
}

// External origin ChatGPT reaches us on — used as the OAuth issuer and for building
// absolute authorize/token/registration URLs in discovery metadata. Prefer the
// configured public HTTPS URL; fall back to the local bind address.
function resolveBaseUrl(options) {
  const latestProfile = connection.readConnectionProfile();
  const base = latestProfile.publicUrl
    || options.publicUrl
    || (connection.localBaseUrl ? connection.localBaseUrl(options.host, options.port) : "")
    || `http://${options.host || "127.0.0.1"}:${options.port || 3333}`;
  let s = String(base || "");
  while (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

function bearerToken(req) {
  const header = req?.headers?.authorization || "";
  if (!/^Bearer\s+/i.test(header)) return "";
  return header.slice(7).trim();
}

// An OAuth access token issued by our /token endpoint is a valid bearer for /mcp.
function isOAuthAuthorized(req) {
  const token = bearerToken(req);
  return Boolean(token && oauth.validateAccessToken(token));
}

// MCP access is granted by either the static REL_AI_MCP_TOKEN bearer (local/API
// clients) or an OAuth-issued access token (the ChatGPT OAuth connector). There is
// no unauthenticated path.
function isMcpAuthorized(req, options) {
  return isAuthorized(req, options) || isOAuthAuthorized(req);
}

function unauthorizedMcp(res, baseUrl) {
  if (res.headersSent) return;
  res.setHeader("WWW-Authenticate", oauth.wwwAuthenticateHeader(baseUrl, "invalid_token"));
  sendJson(res, 401, {
    ok: false,
    error: "Authorization required. Add this server in ChatGPT with Authentication: OAuth, or send a bearer token."
  });
}

function oauthErrorPage(message) {
  const safe = String(message == null ? "" : message).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cannot authorize</title></head><body style="font-family:system-ui,sans-serif;background:#0b0f1a;color:#e6eaf2;padding:48px;"><h2>Cannot authorize this connection</h2><p style="color:#9aa6bd;">${safe}</p></body></html>`;
}

function hasDashboardQueryToken(parsed, options) {
  if (!options.token) return false;
  const supplied = parsed.searchParams.get("token");
  return supplied != null && timingSafeEqual(supplied, options.token);
}

function isDashboardAuthorized(req, parsed, options) {
  return isAuthorized(req, options) || hasDashboardQueryToken(parsed, options);
}

// Honor an explicit requireHttpToken query param (the dashboard sends "0" because it
// uses the secret /mcp URL, not bearer auth); when the param is absent, fall back to
// the configured release.requireHttpToken default instead of silently assuming true.
function resolveRequireHttpToken(parsed, config) {
  const raw = parsed.searchParams.get("requireHttpToken");
  if (raw != null) return raw !== "0";
  const configured = config?.release?.requireHttpToken;
  return configured !== false;
}

function workspacePathPreflight(rawPath) {
  const target = path.resolve(String(rawPath || ""));
  const findings = [];
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch { /* stat failed; report path_not_found below */
    findings.push({ severity: "error", code: "path_not_found", message: `Path does not exist: ${target}` });
  }
  const exists = Boolean(stat);
  const isDirectory = Boolean(stat?.isDirectory());
  const gitDir = path.join(target, ".git");
  const isGit = isDirectory && fs.existsSync(gitDir);
  if (exists && !isDirectory) findings.push({ severity: "error", code: "path_not_directory", message: `Path is not a directory: ${target}` });
  return {
    ok: findings.every((item) => item.severity !== "error"),
    path: target,
    exists,
    isDirectory,
    isGit,
    findings
  };
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

// The dashboard SSE loop re-reads + re-normalizes config.json on every tick for
// every connected client. Cache the parsed config keyed on the file's mtime so N
// open dashboard tabs cost one parse per actual config change, not N per second.
const configCache = { path: "", mtimeMs: -1, value: null };
function readConfigCached() {
  const configPath = require("./config").getConfigPath();
  let mtimeMs = null;
  try { mtimeMs = fs.statSync(configPath).mtimeMs; } catch { /* config file may not exist yet */ }
  if (mtimeMs != null && configCache.value && configCache.path === configPath && configCache.mtimeMs === mtimeMs) {
    return configCache.value;
  }
  const value = readConfig();
  if (mtimeMs != null) {
    configCache.path = configPath;
    configCache.mtimeMs = mtimeMs;
    configCache.value = value;
  }
  return value;
}

function openDashboardEvents(res, req, _options) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const statMtime = (file) => {
    try { return file ? fs.statSync(file).mtimeMs : 0; } catch { return 0; /* file may not exist; treat as not modified */ }
  };
  const changeSignature = () => {
    let config = null;
    try { config = readConfigCached(); } catch { /* config may be unavailable; signature stays empty */ }
    return [
      statMtime(require("./config").getConfigPath()),
      statMtime(config?.auditLogPath)
    ].join(":");
  };
  let lastSignature = "";
  const sendSnapshot = (force = false) => {
    try {
      const signature = changeSignature();
      if (!force && signature === lastSignature) return;
      lastSignature = signature;
      const config = readConfigCached();
      sendSse(res, "dashboard", {
        ...productUx.dashboardData(config, { limit: 100 }),
        readiness: release.releaseReadiness(config, { requireHttpToken: false })
      });
    } catch (error) {
      sendSse(res, "error", { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  sendSnapshot(true);
  const intervalMs = Math.max(1000, Number(readConfig({ allowMissing: true }).productUx?.liveLogPollSeconds || 3) * 1000);
  const timer = setInterval(() => sendSnapshot(false), intervalMs);
  req.on("close", () => clearInterval(timer));
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  const text = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of text.split(/\r?\n/)) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

function isAuthorized(req, options) {
  if (!options.token && options.allowNoAuth) return true;
  const header = req.headers.authorization || "";
  const expected = `Bearer ${options.token}`;
  return timingSafeEqual(header, expected);
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function unauthorized(res) {
  sendJson(res, 401, {
    ok: false,
    error: "Unauthorized. Send Authorization: Bearer <REL_AI_MCP_TOKEN>."
  });
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Collect raw buffers and decode once at the end: decoding per-chunk corrupts
    // multi-byte UTF-8 sequences that straddle a chunk boundary.
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function readJsonBody(req, maxBytes) {
  return readRawBody(req, maxBytes).then((body) => {
    try {
      return body.trim() ? JSON.parse(body) : {};
    } catch (error) {
      throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}

function tryParseJsonOrNull(raw) {
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

// OAuth /token uses application/x-www-form-urlencoded; /register and some clients use
// JSON. Parse by content-type, with a best-effort fallback for unlabeled JSON bodies.
async function readFormOrJsonBody(req, maxBytes) {
  const raw = await readRawBody(req, maxBytes);
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const parsed = tryParseJsonOrNull(raw);
    if (parsed !== null) return parsed;
    throw new Error(`Invalid JSON body`);
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const obj = {};
    for (const [key, value] of new URLSearchParams(raw)) obj[key] = value;
    if (Object.keys(obj).length) return obj;
  }
  if (raw.trim().startsWith("{")) {
    const parsed = tryParseJsonOrNull(raw);
    if (parsed !== null) return parsed;
  }
  return {};
}

// Origin-scoped CORS. Only local dashboard/tooling origins are allowed to read
// local HTTP responses cross-origin. Requests with no Origin header (server-to-server
// MCP, curl, the same-origin dashboard) are unaffected; CORS only governs browser
// cross-origin reads.
function fixedCorsOrigins(options = {}) {
  const port = Number(options.port || 3333);
  return Object.freeze({
    loopback: `http://127.0.0.1:${port}`,
    localhost: `http://localhost:${port}`,
    ipv6Loopback: `http://[::1]:${port}`
  });
}

function allowedCorsOrigin(origin, options = {}) {
  const origins = fixedCorsOrigins(options);
  const value = String(origin || "");
  if (value === origins.loopback) return origins.loopback;
  if (value === origins.localhost) return origins.localhost;
  if (value === origins.ipv6Loopback) return origins.ipv6Loopback;
  return "";
}

function setBaseHeaders(req, res, options = {}) {
  const corsOrigin = allowedCorsOrigin(req?.headers?.origin ?? "", options);
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(res, status, payload, ae = "") {
  if (res.headersSent) return;
  const json = `${JSON.stringify(payload)}\n`;
  if (ae.includes("gzip")) {
    try {
      const compressed = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 6 });
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "Vary": "Accept-Encoding" });
      res.end(compressed);
      return;
    } catch { /* gzip failed; fall through to uncompressed response */ }
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendHtml(res, status, html) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function safeInitialDashboardData() {
  try {
    const config = readConfig();
    return {
      ...productUx.dashboardData(config, { limit: 100 }),
      readiness: release.releaseReadiness(config, { requireHttpToken: false })
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}


function contentTypeForStaticAsset(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".js")) return "application/javascript";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function jsonForHtmlScript(value) {
  return JSON.stringify(value).replaceAll("<", String.raw`\u003c`).replaceAll(">", String.raw`\u003e`).replaceAll("&", String.raw`\u0026`);
}

function renderDashboardHtml(_options) {
  const initialDashboardJson = jsonForHtmlScript(safeInitialDashboardData());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rel.AI MCP Dashboard</title>
<link rel="icon" href="/public/assets/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/public/assets/favicon.png">
<link rel="apple-touch-icon" href="/public/assets/relai-logo-192.png">
<link rel="stylesheet" href="/public/dashboard.css">
</head>
<body>
<a href="#main" class="skip-link">Skip to content</a>
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="logo"><img src="/public/assets/relai-logo.png" alt="Rel.AI logo"></div><div><strong>Rel.AI MCP</strong><span>workspace control</span></div></div>
    <nav class="nav">
      <a href="#home">Home</a>
      <a href="#workspaces">Workspaces</a>
      <a href="#activity">Activity</a>
      <a href="#tools">Tools</a>
      <a href="#settings">Settings</a>
    </nav>
    <div class="sidebar-note">This dashboard mirrors live MCP state.</div>
  </aside>
  <main id="main" class="main">
    <div class="mobile-nav">
      <a href="#home">Home</a><a href="#workspaces">Workspaces</a><a href="#activity">Activity</a><a href="#tools">Tools</a><a href="#settings">Settings</a>
    </div>
    <header class="topbar">
      <div class="title-wrap">
        <h1 class="page-title" id="pageTitle">Rel.AI MCP</h1>
        <div class="page-subtitle" id="subtitle">Loading workspace state…</div>
      </div>
      <div class="top-controls">
        <span class="status-pill" id="serverStatus">Connecting…</span>
        <button class="secondary" id="refreshBtn" type="button">Refresh</button>
        <span class="section-action" id="lastUpdated"></span>
      </div>
    </header>
  </main>
</div>
<script type="application/json" id="initialDashboardData">${initialDashboardJson}</script>
<script type="module" src="/public/dashboard.js"></script>
</body>
</html>`;
}


module.exports = {
  startHttpServer,
  handleJsonRpcPayload
};
