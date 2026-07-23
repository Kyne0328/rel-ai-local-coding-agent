const http = require("node:http");
const { URL } = require("node:url");
const connection = require("./connectionProfile");
const { setBaseHeaders, sendJson, unauthorized } = require("./http/io");
const { isDashboardAuthorized } = require("./http/auth");
const {
  handleFavicon,
  handleHealth,
  handleStaticAsset,
  handleDashboard,
  handleApiSettingsGet,
  handleApiTools,
  handleOnboardingStatus,
  handleConnection,
  handleDashboardV10,
  handleApiLogs,
  handleHealthMonitor,
  handleAliasDiagnostics,
  handleReleaseNotes,
  handleCautionSummary,
  handleReadiness,
  handleWorkspacePreflight,
  handleEvents,
  handleOnboardingComplete,
  handleApiSettingsPost,
  handleApiWorkspaces,
  handlePickFolder,
  handleOpenFolder,
  handleWorkspaceChecks
} = require("./http/dashboard");
const { handleApiHistoryReset } = require("./http/dashboardHistory");
const {
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
} = require("./http/mcp");

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

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
  const openFolder = typeof options.openFolder === "function" ? options.openFolder : null;
  const getTaskActivity = typeof options.getTaskActivity === "function" ? options.getTaskActivity : null;
  const getDesktopStatus = typeof options.getDesktopStatus === "function" ? options.getDesktopStatus : null;
  const resetTaskActivity = typeof options.resetTaskActivity === "function" ? options.resetTaskActivity : null;

  if (!token && !allowNoAuth) {
    throw new Error("REL_AI_MCP_TOKEN is required for the HTTP/SSE server. Set a strong token, or set REL_AI_MCP_ALLOW_NO_AUTH=1 for local-only testing.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { token, allowNoAuth, maxBodyBytes, host, port, publicUrl, pickFolder, openFolder, getTaskActivity, getDesktopStatus, resetTaskActivity });
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
      console.error("[rel-ai-mcp] No public URL configured. Open the Rel.AI MCP desktop app to set your ngrok domain and start the tunnel.");
      console.error(`[rel-ai-mcp] Local ChatGPT-style URL for diagnostics only: ${summary.chatgptMcpUrl}`);
    }
    if (!token) {
      console.error("[rel-ai-mcp] Notice: HTTP/SSE auth is disabled. Use only on a trusted local network.");
    }
  });

  return server;
}

function authDashboard(ctx) {
  if (isDashboardAuthorized(ctx.req, ctx.parsed, ctx.options, ctx.res)) return true;
  unauthorized(ctx.res);
  return false;
}
function authNone() { return true; }

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
    if (await dispatchGet(ctx)) return;
  } else if (req.method === "POST") {
    if (await dispatchPost(ctx)) return;
  }

  sendJson(res, 404, NOT_FOUND_PAYLOAD, ae);
}

async function dispatchGet(ctx) {
  if (await tryExactGet(ctx)) return true;
  if (await tryPrefixGet(ctx)) return true;
  return tryOAuthOrMcpGet(ctx);
}

async function tryExactGet(ctx) {
  const entry = GET_ROUTES[ctx.p];
  if (!entry) return false;
  if (!entry.auth(ctx)) return true;
  await entry.handler(ctx);
  return true;
}

async function tryPrefixGet(ctx) {
  const p = ctx.p;
  if (p.startsWith("/ui/") || p.startsWith("/public/")) { handleStaticAsset(ctx); return true; }
  return false;
}

async function tryOAuthOrMcpGet(ctx) {
  if (ctx.p === "/.well-known/oauth-protected-resource") { await handleOauthProtectedResource(ctx); return true; }
  if (ctx.p === "/.well-known/oauth-authorization-server" || ctx.p === "/.well-known/openid-configuration") { await handleOauthMetadata(ctx); return true; }
  if (ctx.p === "/authorize") { await handleAuthorizeGet(ctx); return true; }
  if (ctx.p === "/mcp" || ctx.mcpAccess.kind === "streamable-http") { await handleMcpGetDiagnostic(ctx); return true; }
  if (ctx.mcpAccess.kind === "sse") { await handleMcpSse(ctx); return true; }
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

async function dispatchPost(ctx) {
  if (await tryExactPost(ctx)) return true;
  return tryOAuthOrMcpPost(ctx);
}

async function tryExactPost(ctx) {
  const entry = POST_ROUTES[ctx.p];
  if (!entry) return false;
  if (!entry.auth(ctx)) return true;
  await entry.handler(ctx);
  return true;
}

async function tryOAuthOrMcpPost(ctx) {
  if (ctx.p === "/register") { await handleRegister(ctx); return true; }
  if (ctx.p === "/authorize") { await handleAuthorizePost(ctx); return true; }
  if (ctx.p === "/token") { await handleToken(ctx); return true; }
  if (ctx.mcpAccess.kind === "streamable-http") { await handleMcpStreamable(ctx); return true; }
  if (ctx.mcpAccess.kind === "messages") { await handleMcpMessages(ctx); return true; }
  return false;
}

const POST_ROUTES = {
  "/api/onboarding/complete": { auth: authDashboard, handler: handleOnboardingComplete },
  "/api/settings": { auth: authDashboard, handler: handleApiSettingsPost },
  "/api/workspaces": { auth: authDashboard, handler: handleApiWorkspaces },
  "/api/history/reset": { auth: authDashboard, handler: handleApiHistoryReset },
  "/api/pick-folder": { auth: authDashboard, handler: handlePickFolder },
  "/api/open-folder": { auth: authDashboard, handler: handleOpenFolder },
  "/api/workspace/checks": { auth: authDashboard, handler: handleWorkspaceChecks }
};

module.exports = {
  startHttpServer,
  handleJsonRpcPayload
};
