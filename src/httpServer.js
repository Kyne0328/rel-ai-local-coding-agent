import * as http from "node:http";
import { URL } from "node:url";
import * as connection from "./connectionProfile.js";
import { DEFAULT_MAX_BODY_BYTES, normalizeMaxBodyBytes, setBaseHeaders, sendJson } from "./http/io.js";
import { ERROR_CODES, errorPayload } from "./desktopUxContracts.js";
import { errorCodeForRequest, isLoopbackHost } from './http/serverPolicy.js';
import { isDashboardAuthorized } from "./http/auth.js";
import { handleFavicon, handleHealth, handleStaticAsset, handleDashboard, handleApiTools, handleOnboardingStatus, handleConnection, handleDashboardV10, handleTaskSession, handleApiLogs, handleReleaseNotes, handleWorkspacePreflight, handleEvents, handleOnboardingComplete, handleApiWorkspaces, handlePickFolder, handleOpenFolder, handleWorkspaceChecks } from "./http/dashboard.js";
import { handleApiDiagnostics, handleApiDiagnosticsReset } from "./http/dashboardDiagnostics.js";
import { handleApiProcessStop } from "./http/dashboardProcesses.js";
import { getMcpAccess } from "./http/mcp.js";
import { handleMcpGetDiagnostic, handleMcpStreamable, handleMcpDelete, sendMcpTransportError, shutdownMcpTransport } from "./http/mcpTransport.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";
import { stopAllManagedProcesses, pruneManagedProcesses } from "./processManager.js";
import { flushAuditWrites } from './audit.js';
import { flushLocalAnalytics } from './localAnalytics.js';
import { flushTaskHistoryPersistence } from './taskHistoryStore.js';
import { stopAllUiSessions } from './webAutomationManager.js';
import { pruneNativeToolTasks } from './mcp/nativeToolTasks.js';
import { ensureConfig, getConfigPath, readConfig } from './config.js';
import { buildToolManifest } from './mcp/toolManifest.js';
import { resolveConnectionGenerations } from './mcp/connectionGenerations.js';
import { mcpConnectionManager } from './mcp/connectionManager.js';
import { SERVER_INSTANCE_ID } from './mcp/context.js';

const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 300_000;
const MAX_NODE_TIMEOUT_MS = 2_147_483_647;

function resolveHttpRequestTimeoutMs(maxBodyBytes) {
  const bodyBytes = normalizeMaxBodyBytes(maxBodyBytes);
  const scaledTimeoutMs = Math.ceil(DEFAULT_HTTP_REQUEST_TIMEOUT_MS * (bodyBytes / DEFAULT_MAX_BODY_BYTES));
  return Math.min(MAX_NODE_TIMEOUT_MS, Math.max(DEFAULT_HTTP_REQUEST_TIMEOUT_MS, scaledTimeoutMs));
}

function startHttpServer(options = {}) {
  const isolated = options.isolated === true
    || Number(options.port) === 0
    || process.env.REL_AI_MCP_ISOLATED === '1';
  const launchEnv = isolated ? {} : connection.readLaunchEnv();
  const savedProfile = isolated ? {} : connection.readConnectionProfile();
  const host = options.host || process.env.REL_AI_MCP_HOST || savedProfile.host || "127.0.0.1";
  const port = Number(options.port ?? process.env.REL_AI_MCP_PORT ?? 3333);
  const token = options.token || process.env.REL_AI_MCP_TOKEN || launchEnv.REL_AI_MCP_TOKEN || "";
  const allowNoAuth = Boolean(options.allowNoAuth || process.env.REL_AI_MCP_ALLOW_NO_AUTH === "1");
  // connection.json is global state the desktop app and the ChatGPT connector read to
  // find the live server. A second instance (a test, a benchmark, a manual
  // `npm run start:http` on another port) would otherwise silently repoint it.
  const writeProfile = !isolated && options.writeProfile !== false && process.env.REL_AI_MCP_NO_PROFILE_WRITE !== "1";
  const maxBodyBytes = normalizeMaxBodyBytes(options.maxBodyBytes ?? process.env.REL_AI_MCP_MAX_BODY_BYTES);
  // Native folder picker, injected by the Electron launcher (the HTTP server runs
  // in the same process). Absent when the server runs standalone — the endpoint then
  // reports unsupported and the dashboard falls back to manual path entry.
  const pickFolder = typeof options.pickFolder === "function" ? options.pickFolder : null;
  const openFolder = typeof options.openFolder === "function" ? options.openFolder : null;
  const getTaskActivity = typeof options.getTaskActivity === "function" ? options.getTaskActivity : null;
  const getDesktopStatus = typeof options.getDesktopStatus === "function" ? options.getDesktopStatus : null;
  const onDesktopStatusChange = typeof options.onDesktopStatusChange === "function" ? options.onDesktopStatusChange : null;
  const getRuntimeAccess = typeof options.getRuntimeAccess === "function" ? options.getRuntimeAccess : null;
  const resetTaskActivity = typeof options.resetTaskActivity === "function" ? options.resetTaskActivity : null;
  const getRuntimeLogs = typeof options.getRuntimeLogs === "function" ? options.getRuntimeLogs : null;
  const clearRuntimeLogs = typeof options.clearRuntimeLogs === "function" ? options.clearRuntimeLogs : null;
  const onRuntimeLogChange = typeof options.onRuntimeLogChange === "function" ? options.onRuntimeLogChange : null;

  ensureConfig();
  const runtimeConfig = readConfig();
  const manifest = buildToolManifest(runtimeConfig);
  const generations = resolveConnectionGenerations(runtimeConfig, { token, host, port });
  mcpConnectionManager.configure({
    serverInstanceId: SERVER_INSTANCE_ID,
    credentialGeneration: generations.credentialGeneration,
    configurationGeneration: generations.configurationGeneration,
    manifest
  });
  if (!isolated) {
    initializeTelemetry(runtimeConfig);
    pruneManagedProcesses(runtimeConfig);
    pruneNativeToolTasks(runtimeConfig);
  }

  if (!token && !allowNoAuth) {
    throw new Error("REL_AI_MCP_TOKEN is required for the HTTP server. Set a strong token, or set REL_AI_MCP_ALLOW_NO_AUTH=1 for local-only testing.");
  }
  if (allowNoAuth && !isLoopbackHost(host)) {
    throw new Error('REL_AI_MCP_ALLOW_NO_AUTH is permitted only on a loopback bind.');
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { token, allowNoAuth, maxBodyBytes, host, port, pickFolder, openFolder, getTaskActivity, getDesktopStatus, onDesktopStatusChange, getRuntimeAccess, resetTaskActivity, getRuntimeLogs, clearRuntimeLogs, onRuntimeLogChange });
    } catch (error) {
      const status = Number(error?.status || 500);
      const pathname = safeRequestPath(req.url);
      if (getMcpAccess(pathname).kind !== 'none') {
        sendMcpTransportError(res, { status });
        return;
      }
      const code = error?.errorCode || errorCodeForRequest(req);
      sendJson(res, status, errorPayload(code, error instanceof Error ? error.message : String(error)));
    }
  });

  let shutdownPromise = Promise.resolve();
  server.on('close', () => {
    const shutdownTasks = [
      shutdownMcpTransport(),
      mcpConnectionManager.shutdown('http_server_closed')
    ];
    if (!isolated) {
      shutdownTasks.push(
        flushAuditWrites(),
        flushTaskHistoryPersistence(),
        flushLocalAnalytics(runtimeConfig),
        ...(options.stopManagedProcessesOnClose === false ? [] : [stopAllManagedProcesses(runtimeConfig)]),
        stopAllUiSessions(),
        shutdownTelemetry()
      );
    }
    shutdownPromise = Promise.allSettled(shutdownTasks);
  });
  server.waitForShutdown = () => shutdownPromise;

  // Keep a finite total receive bound for slow clients, but scale it with the body
  // size the server explicitly accepts so raising the payload limit does not make
  // legitimate uploads proportionally more likely to time out.
  server.requestTimeout = resolveHttpRequestTimeoutMs(maxBodyBytes);
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
      connection.writeConnectionProfile({ host, port: actualPort, configPath: getConfigPath() });
    }
    const summary = connection.buildConnectionSummary({ host, port: actualPort, token, includeTokenInUrls: false, tunnelId: savedProfile.tunnelId || '' });
    console.error(`[rel-ai-mcp] Dashboard: ${summary.dashboardUrl}`);
    console.error(`[rel-ai-mcp] Local MCP: ${summary.localMcpUrl}`);
    console.error('[rel-ai-mcp] ChatGPT connectivity is provided only by OpenAI Secure MCP Tunnel.');
    if (!token) {
      console.error("[rel-ai-mcp] Notice: HTTP auth is disabled. Use only on a trusted local network.");
    }
  });

  return server;
}

function safeRequestPath(value) {
  try { return new URL(value || '/', 'http://127.0.0.1').pathname; } catch { return '/'; }
}

function authDashboard(ctx) {
  if (isDashboardAuthorized(ctx.req, ctx.parsed, ctx.options, ctx.res)) return true;
  sendJson(ctx.res, 401, errorPayload(
    ERROR_CODES.DASHBOARD_UNAVAILABLE,
    'Dashboard authorization expired. Reopen the dashboard from the Rel.AI desktop app.'
  ));
  return false;
}
function authNone() { return true; }

const NOT_FOUND_PAYLOAD = {
  ok: false, error: "Not found.",
  endpoints: {
    health: "GET /health", dashboard: "GET /dashboard", dashboardV10Api: "GET /api/dashboard/v10",
    logsApi: "GET /api/logs", diagnosticsApi: "GET /api/diagnostics",
    diagnosticsResetApi: "POST /api/diagnostics/reset", updateWorkspacesApi: "POST /api/workspaces",
    workspacePreflightApi: "GET /api/workspace/preflight?workspace=...", events: "GET /events",
    streamableHttp: "POST /mcp (MCP 2026-07-28; Authentication: private Bearer token)"
  }
};

async function routeRequest(req, res, options) {
  setBaseHeaders(req, res, options);
  const parsed = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const mcpAccess = getMcpAccess(parsed.pathname);
  if (mcpAccess.kind !== 'none' && blockMcpForRuntimeAccess(res, options.getRuntimeAccess)) return;
  const ctx = { req, res, options, parsed, mcpAccess, p: parsed.pathname };

  if (req.method === "GET") {
    if (await dispatchGet(ctx)) return;
  } else if (req.method === "POST") {
    if (await dispatchPost(ctx)) return;
  } else if (req.method === "DELETE") {
    if (ctx.mcpAccess.kind === "streamable-http") { await handleMcpDelete(ctx); return; }
  }

  sendJson(res, 404, NOT_FOUND_PAYLOAD);
}

function blockMcpForRuntimeAccess(res, getRuntimeAccess) {
  if (typeof getRuntimeAccess !== 'function') return false;
  let access;
  try { access = getRuntimeAccess(); } catch { return false; }
  if (access?.blocked !== true) return false;
  sendJson(res, 426, errorPayload(access.errorCode || ERROR_CODES.UPDATE_REQUIRED, access.message || 'Update Rel.AI MCP before continuing MCP work.'));
  return true;
}

async function dispatchGet(ctx) {
  if (await tryExactGet(ctx)) return true;
  if (await tryPrefixGet(ctx)) return true;
  if (ctx.mcpAccess.kind === 'streamable-http') { await handleMcpGetDiagnostic(ctx); return true; }
  return false;
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
  if (p.startsWith("/ui/") || p.startsWith("/public/") || p.startsWith("/vendor/monaco/")) { handleStaticAsset(ctx); return true; }
  return false;
}

const GET_ROUTES = {
  "/dashboard": { auth: authDashboard, handler: handleDashboard },
  "/favicon.ico": { auth: authNone, handler: handleFavicon },
  "/health": { auth: authNone, handler: handleHealth },
  "/api/tools": { auth: authDashboard, handler: handleApiTools },
  "/api/onboarding/status": { auth: authDashboard, handler: handleOnboardingStatus },
  "/api/connection": { auth: authDashboard, handler: handleConnection },
  "/api/dashboard/v10": { auth: authDashboard, handler: handleDashboardV10 },
  "/api/tasks/session": { auth: authDashboard, handler: handleTaskSession },
  "/api/logs": { auth: authDashboard, handler: handleApiLogs },
  "/api/diagnostics": { auth: authDashboard, handler: handleApiDiagnostics },
  "/api/release-notes": { auth: authDashboard, handler: handleReleaseNotes },
  "/api/workspace/preflight": { auth: authDashboard, handler: handleWorkspacePreflight },
  "/events": { auth: authDashboard, handler: handleEvents }
};

async function dispatchPost(ctx) {
  if (await tryExactPost(ctx)) return true;
  if (ctx.mcpAccess.kind === 'streamable-http') { await handleMcpStreamable(ctx); return true; }
  return false;
}

async function tryExactPost(ctx) {
  const entry = POST_ROUTES[ctx.p];
  if (!entry) return false;
  if (!entry.auth(ctx)) return true;
  await entry.handler(ctx);
  return true;
}

const POST_ROUTES = {
  "/api/onboarding/complete": { auth: authDashboard, handler: handleOnboardingComplete },
  "/api/workspaces": { auth: authDashboard, handler: handleApiWorkspaces },
  "/api/diagnostics/reset": { auth: authDashboard, handler: handleApiDiagnosticsReset },
  "/api/pick-folder": { auth: authDashboard, handler: handlePickFolder },
  "/api/open-folder": { auth: authDashboard, handler: handleOpenFolder },
  "/api/workspace/checks": { auth: authDashboard, handler: handleWorkspaceChecks },
  "/api/processes/stop": { auth: authDashboard, handler: handleApiProcessStop }
};

export { resolveHttpRequestTimeoutMs, startHttpServer };
