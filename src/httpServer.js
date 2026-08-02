import * as http from "node:http";
import { URL } from "node:url";
import * as connection from "./connectionProfile.js";
import { setBaseHeaders, sendJson, unauthorized } from "./http/io.js";
import { ERROR_CODES, errorPayload } from "./desktopUxContracts.js";
import { isDashboardAuthorized } from "./http/auth.js";
import { handleFavicon, handleHealth, handleStaticAsset, handleDashboard, handleApiSettingsGet, handleApiTools, handleOnboardingStatus, handleConnection, handleDashboardV10, handleApiLogs, handleHealthMonitor, handleAliasDiagnostics, handleReleaseNotes, handleCautionSummary, handleReadiness, handleWorkspacePreflight, handleEvents, handleOnboardingComplete, handleApiSettingsPost, handleApiWorkspaces, handlePickFolder, handleOpenFolder, handleWorkspaceChecks } from "./http/dashboard.js";
import { handleApiHistoryReset } from "./http/dashboardHistory.js";
import { handleApiDiagnostics, handleApiDiagnosticsReset } from "./http/dashboardDiagnostics.js";
import { handleApiProcessStop } from "./http/dashboardProcesses.js";
import { handleOauthProtectedResource, handleOauthMetadata, handleRegister, handleAuthorizeGet, handleAuthorizePost, handleToken, handleMcpGetDiagnostic, handleMcpStreamable, handleMcpDelete, handleMcpRecovery, handleMcpConnectionState, shutdownMcpTransport, getMcpAccess, oauthWellKnownPaths } from "./http/mcp.js";
import { resolveBaseUrl } from "./http/auth.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";
import { stopAllManagedProcesses, pruneManagedProcesses } from "./processManager.js";
import { pruneOperationTasks } from "./operationTasks.js";
import { ensureConfig, getConfigPath, readConfig } from './config.js';
import { buildToolManifest } from './mcp/toolManifest.js';
import { resolveConnectionGenerations } from './mcp/connectionGenerations.js';
import { mcpConnectionManager } from './mcp/connectionManager.js';
import { SERVER_INSTANCE_ID } from './mcp/context.js';

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

function startHttpServer(options = {}) {
  const isolated = options.isolated === true
    || Number(options.port) === 0
    || process.env.REL_AI_MCP_ISOLATED === '1';
  const launchEnv = isolated ? {} : connection.readLaunchEnv();
  const savedProfile = isolated ? {} : connection.readConnectionProfile();
  const host = options.host || process.env.REL_AI_MCP_HOST || savedProfile.host || "127.0.0.1";
  const port = Number(options.port ?? process.env.REL_AI_MCP_PORT ?? 3333);
  const token = options.token || process.env.REL_AI_MCP_TOKEN || launchEnv.REL_AI_MCP_TOKEN || "";
  const publicUrl = connection.normalizePublicUrl(options.publicUrl || process.env.REL_AI_MCP_PUBLIC_URL || launchEnv.REL_AI_MCP_PUBLIC_URL || savedProfile.publicUrl || "");
  const allowNoAuth = Boolean(options.allowNoAuth || process.env.REL_AI_MCP_ALLOW_NO_AUTH === "1");
  // connection.json is global state the desktop app and the ChatGPT connector read to
  // find the live server. A second instance (a test, a benchmark, a manual
  // `npm run start:http` on another port) would otherwise silently repoint it.
  const writeProfile = !isolated && options.writeProfile !== false && process.env.REL_AI_MCP_NO_PROFILE_WRITE !== "1";
  const maxBodyBytes = Number(options.maxBodyBytes || process.env.REL_AI_MCP_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  // Native folder picker, injected by the Electron launcher (the HTTP server runs
  // in the same process). Absent when the server runs standalone — the endpoint then
  // reports unsupported and the dashboard falls back to manual path entry.
  const pickFolder = typeof options.pickFolder === "function" ? options.pickFolder : null;
  const openFolder = typeof options.openFolder === "function" ? options.openFolder : null;
  const getTaskActivity = typeof options.getTaskActivity === "function" ? options.getTaskActivity : null;
  const getDesktopStatus = typeof options.getDesktopStatus === "function" ? options.getDesktopStatus : null;
  const resetTaskActivity = typeof options.resetTaskActivity === "function" ? options.resetTaskActivity : null;
  const getRuntimeLogs = typeof options.getRuntimeLogs === "function" ? options.getRuntimeLogs : null;
  const clearRuntimeLogs = typeof options.clearRuntimeLogs === "function" ? options.clearRuntimeLogs : null;

  ensureConfig();
  const runtimeConfig = readConfig();
  const manifest = buildToolManifest(runtimeConfig);
  const generations = resolveConnectionGenerations(runtimeConfig, { token, host, port, publicUrl });
  mcpConnectionManager.configure({
    serverInstanceId: SERVER_INSTANCE_ID,
    credentialGeneration: generations.credentialGeneration,
    configurationGeneration: generations.configurationGeneration,
    manifest
  });
  initializeTelemetry(runtimeConfig);
  pruneManagedProcesses(runtimeConfig);
  pruneOperationTasks(runtimeConfig);

  if (!token && !allowNoAuth) {
    throw new Error("REL_AI_MCP_TOKEN is required for the HTTP server. Set a strong token, or set REL_AI_MCP_ALLOW_NO_AUTH=1 for local-only testing.");
  }
  if (allowNoAuth && !isLoopbackHost(host)) {
    throw new Error('REL_AI_MCP_ALLOW_NO_AUTH is permitted only on a loopback bind.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { token, allowNoAuth, maxBodyBytes, host, port, publicUrl, pickFolder, openFolder, getTaskActivity, getDesktopStatus, resetTaskActivity, getRuntimeLogs, clearRuntimeLogs });
    } catch (error) {
      const status = Number(error?.status || 500);
      const code = error?.errorCode || errorCodeForRequest(req);
      sendJson(res, status, errorPayload(code, error instanceof Error ? error.message : String(error)));
    }
  });

  let shutdownPromise = Promise.resolve();
  server.on('close', () => {
    shutdownPromise = Promise.allSettled([
      shutdownMcpTransport(),
      mcpConnectionManager.shutdown('http_server_closed'),
      stopAllManagedProcesses(runtimeConfig),
      shutdownTelemetry()
    ]);
  });
  server.waitForShutdown = () => shutdownPromise;

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  server.on("error", (error) => {
    mcpConnectionManager.markFailed(error);
    if (error.code === "EADDRINUSE") {
      console.error(`[rel-ai-mcp] Port ${port} is already in use. Stop the other process or use --port to pick a different port.`);
    } else {
      console.error(`[rel-ai-mcp] Server error: ${error.message}`);
    }
    if (options.exitOnError === false) return;
    process.exit(1);
  });

  server.listen(port, host, () => {
    mcpConnectionManager.markReady();
    const address = server.address();
    const actualPort = address && typeof address === "object" ? address.port : port;
    console.error(`[rel-ai-mcp] HTTP server listening on http://${host}:${actualPort}`);
    if (writeProfile) {
      const previousPort = Number(savedProfile.port || 0);
      if (previousPort && previousPort !== actualPort) {
        console.error(`[rel-ai-mcp] Notice: repointing the saved connector profile from port ${previousPort} to ${actualPort}. Start with --no-profile-write to leave it untouched.`);
      }
      connection.writeConnectionProfile({ host, port: actualPort, publicUrl, configPath: getConfigPath() });
    }
    const summary = connection.buildConnectionSummary({ host, port: actualPort, publicUrl, token, includeTokenInUrls: false });
    console.error(`[rel-ai-mcp] Dashboard: ${summary.dashboardUrl}`);
    if (publicUrl) {
      console.error(`[rel-ai-mcp] ChatGPT MCP URL: ${summary.chatgptMcpUrl}`);
      console.error("[rel-ai-mcp] ChatGPT Auth: OAuth (sign in with your approval token)");
    } else {
      console.error("[rel-ai-mcp] No public URL configured. Open the Rel.AI MCP desktop app to set your ngrok domain and start the tunnel.");
      console.error(`[rel-ai-mcp] Local ChatGPT-style URL for diagnostics only: ${summary.chatgptMcpUrl}`);
    }
    if (!token) {
      console.error("[rel-ai-mcp] Notice: HTTP auth is disabled. Use only on a trusted local network.");
    }
  });

  return server;
}

function authDashboard(ctx) {
  if (isDashboardAuthorized(ctx.req, ctx.parsed, ctx.options, ctx.res)) return true;
  const suppliedCredential = Boolean(
    ctx.req.headers.authorization
    || ctx.parsed.searchParams.get("token")
    || ctx.parsed.searchParams.get("bootstrap")
  );
  unauthorized(ctx.res, { rejected: suppliedCredential });
  return false;
}
function authNone() { return true; }

const NOT_FOUND_PAYLOAD = {
  ok: false, error: "Not found.",
  endpoints: {
    health: "GET /health", dashboard: "GET /dashboard", dashboardV10Api: "GET /api/dashboard/v10",
    logsApi: "GET /api/logs", diagnosticsApi: "GET /api/diagnostics", settingsApi: "GET /api/settings",
    updateSettingsApi: "POST /api/settings", diagnosticsResetApi: "POST /api/diagnostics/reset", updateWorkspacesApi: "POST /api/workspaces",
    healthMonitorApi: "GET /api/health-monitor", readinessApi: "GET /api/readiness",
    workspacePreflightApi: "GET /api/workspace/preflight?workspace=...", events: "GET /events",
    streamableHttp: "POST /mcp (MCP 2026-07-28; Authentication: OAuth, or Bearer token)",
    mcpConnectionApi: "GET /api/mcp/connection",
    mcpRecoveryApi: "POST /api/mcp/recovery",
    oauthDiscovery: 'GET /.well-known/oauth-protected-resource/mcp'
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
  } else if (req.method === "DELETE") {
    if (ctx.mcpAccess.kind === "streamable-http") { await handleMcpDelete(ctx); return; }
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
  const wellKnown = oauthWellKnownPaths(resolveBaseUrl(ctx.options));
  if (ctx.p === wellKnown.protectedResource) { await handleOauthProtectedResource(ctx); return true; }
  if (ctx.p === wellKnown.authorizationServer || ctx.p === wellKnown.openidConfiguration) { await handleOauthMetadata(ctx); return true; }
  if (ctx.p === "/authorize") { await handleAuthorizeGet(ctx); return true; }
  if (ctx.mcpAccess.kind === "streamable-http") { await handleMcpGetDiagnostic(ctx); return true; }
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
  "/api/mcp/connection": { auth: authDashboard, handler: handleMcpConnectionState },
  "/api/dashboard/v10": { auth: authDashboard, handler: handleDashboardV10 },
  "/api/logs": { auth: authDashboard, handler: handleApiLogs },
  "/api/diagnostics": { auth: authDashboard, handler: handleApiDiagnostics },
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
  return false;
}

const POST_ROUTES = {
  "/api/onboarding/complete": { auth: authDashboard, handler: handleOnboardingComplete },
  "/api/settings": { auth: authDashboard, handler: handleApiSettingsPost },
  "/api/workspaces": { auth: authDashboard, handler: handleApiWorkspaces },
  "/api/history/reset": { auth: authDashboard, handler: handleApiHistoryReset },
  "/api/diagnostics/reset": { auth: authDashboard, handler: handleApiDiagnosticsReset },
  "/api/pick-folder": { auth: authDashboard, handler: handlePickFolder },
  "/api/open-folder": { auth: authDashboard, handler: handleOpenFolder },
  "/api/workspace/checks": { auth: authDashboard, handler: handleWorkspaceChecks },
  "/api/processes/stop": { auth: authDashboard, handler: handleApiProcessStop },
  "/api/mcp/recovery": { auth: authDashboard, handler: handleMcpRecovery }
};

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host || '').toLowerCase());
}

function errorCodeForRequest(req) {
  const path = String(req?.url || '').split('?')[0];
  if (path === '/api/settings') return ERROR_CODES.SETTINGS_SAVE_FAILED;
  if (path === '/api/workspaces' || path.startsWith('/api/workspace/')) return ERROR_CODES.WORKSPACE_UNAVAILABLE;
  if (path === '/api/diagnostics/reset' || path === '/api/history/reset') return ERROR_CODES.STATE_RESET_FAILED;
  if (path === '/api/diagnostics') return ERROR_CODES.DIAGNOSTICS_UNAVAILABLE;
  return ERROR_CODES.UNKNOWN;
}

export { startHttpServer };
