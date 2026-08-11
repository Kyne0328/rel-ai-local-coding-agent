import { getToolMetadata } from '../tools.js';
import { getReleaseNotes } from '../releaseNotes.js';
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { ensureConfig, getConfigPath, readConfig } from '../config.js';
import * as productUx from "../productUx.js";
import * as release from "../release.js";
import * as configEditor from "../configEditor.js";
import { packageMetadata as pkg, resolvePackagePath } from '../packageMetadata.js';
import * as connection from "../connectionProfile.js";
import { ERROR_CODES, errorPayload } from "../desktopUxContracts.js";
import { renderDashboardShellBootstrap, renderDashboardWindowTitlebar } from "./dashboardShellChrome.js";
import { getOnboardingStatus, writeOnboardingState } from "../onboardingState.js";
import { getVersion } from "../version.js";
import { resolveRequireHttpToken } from "./auth.js";
import { readTaskHistory, readTaskHistorySession } from "../taskHistoryStore.js";
import { onToolActivity } from "../toolActivity.js";
import { buildDashboardPayload, mergeDashboardActivity } from "./dashboardData.js";
import { handleOpenFolder, handlePickFolder, handleSkillsGet, handleSkillsPost, handleWorkspaceChecks, workspacePathPreflight } from "./dashboardActions.js";
import { sendJson, sendHtml, sendSse, readJsonBody, contentTypeForStaticAsset, jsonForHtmlScript } from "./io.js";
import { mcpConnectionManager } from '../mcp/connectionManager.js';
import { buildToolManifest } from '../mcp/toolManifest.js';
import { readMcpAuthenticationStatus } from '../mcp/authenticationStatus.js';
import { WORK_NAV_ITEMS, APPLICATION_NAV_ITEMS, MOBILE_NAV_ITEMS } from '../ui/navigation-catalog.js';
import { onWorkspaceStateChange, workspaceStateRevision } from '../workspaceState.js';

const DASHBOARD_SHARED_MODULES = Object.freeze({
  '/public/analyticsFailureCategory.js': Object.freeze(['src', 'analyticsFailureCategory.js']),
  '/public/taskEvents.js': Object.freeze(['src', 'taskEvents.js']),
  '/public/taskState.js': Object.freeze(['src', 'taskState.js'])
});
const STATIC_ASSET_CACHE = new Map();

function readCachedStaticAsset(filePath) {
  const stat = fs.statSync(filePath);
  const signature = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  const cached = STATIC_ASSET_CACHE.get(filePath);
  if (cached?.signature === signature) return cached.content;
  const content = fs.readFileSync(filePath);
  STATIC_ASSET_CACHE.set(filePath, { signature, content });
  if (STATIC_ASSET_CACHE.size > 128) STATIC_ASSET_CACHE.delete(STATIC_ASSET_CACHE.keys().next().value);
  return content;
}

function renderDashboardNav(items) {
  return items.map((item) => `<a href="${item.href}" data-nav-id="${item.id}" aria-label="${item.label}" title="${item.label}"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span class="nav-label">${item.label}</span></a>`).join("");
}

async function handleFavicon(ctx) {
  try {
    const content = readCachedStaticAsset(resolvePackagePath('public', 'assets', 'favicon.ico'));
    ctx.res.writeHead(200, { "Content-Type": "image/x-icon", "Cache-Control": "private, max-age=60" });
    ctx.res.end(content);
  } catch { ctx.res.writeHead(404); ctx.res.end("Not found"); }
}

function handleHealth(ctx) {
  const mcpConnection = mcpConnectionManager.snapshot();
  sendJson(ctx.res, 200, {
    ok: mcpConnection.status !== 'failed',
    name: pkg.name,
    version: getVersion(),
    transports: ["streamable-http"],
    auth: ctx.options.token ? "bearer" : "disabled",
    serverStatus: mcpConnection.status,
    connectedClientCount: mcpConnection.connectedClientCount,
    toolManifestVersion: mcpConnection.toolManifestVersion,
    activeToolCount: mcpConnection.currentActiveToolCount
  }, ctx.ae);
}

function handleStaticAsset(ctx) {
  const safePath = ctx.parsed.pathname.replaceAll("\\", "/");
  if (safePath.includes("..")) { ctx.res.writeHead(400); ctx.res.end("Bad path"); return; }
  let filePath;
  if (Object.hasOwn(DASHBOARD_SHARED_MODULES, safePath)) {
    filePath = resolvePackagePath(...DASHBOARD_SHARED_MODULES[safePath]);
  } else if (safePath.startsWith("/ui/")) {
    filePath = resolvePackagePath('src', 'ui', safePath.slice(4));
  } else if (safePath.startsWith("/public/ui/")) {
    filePath = resolvePackagePath('src', 'ui', safePath.slice(11));
  } else {
    filePath = resolvePackagePath('public', safePath.slice(8));
  }
  try {
    const content = readCachedStaticAsset(filePath);
    const ct = contentTypeForStaticAsset(safePath);
    const charset = ct.startsWith("text/") || ct === "application/javascript" ? "; charset=utf-8" : "";
    ctx.res.writeHead(200, { "Content-Type": ct + charset, "Cache-Control": "private, max-age=60" });
    ctx.res.end(content);
  } catch { ctx.res.writeHead(404); ctx.res.end("Not found"); }
}

function handleDashboard(ctx) {
  const nonce = crypto.randomBytes(18).toString("base64");
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self'",
    "img-src 'self' data:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"
  ].join("; ");
  sendHtml(ctx.res, 200, renderDashboardHtml(ctx.options, nonce), {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  });
}

function handleApiSettingsGet(ctx) {
  sendJson(ctx.res, 200, configEditor.settingsPayload(readConfig()), ctx.ae);
}

function handleApiTools(ctx) {
  try { sendJson(ctx.res, 200, getToolMetadata(), ctx.ae); }
  catch (err) { sendJson(ctx.res, 500, errorPayload(ERROR_CODES.UNKNOWN, err.message), ctx.ae); }
}

function handleOnboardingStatus(ctx) {
  sendJson(ctx.res, 200, { ok: true, ...getOnboardingStatus() }, ctx.ae);
}

function handleConnection(ctx) {
  const latestProfile = connection.readConnectionProfile();
  const mcpConnection = mcpConnectionManager.snapshot();
  sendJson(ctx.res, 200, {
    ...connection.buildConnectionSummary({
      host: latestProfile.host || ctx.options.host,
      port: latestProfile.port || ctx.options.port,
      publicUrl: latestProfile.publicUrl || ctx.options.publicUrl,
      token: ctx.options.token,
      tunnelProvider: latestProfile.tunnelProvider || "none",
      showToken: false,
      includeTokenInUrls: false
    }),
    mcpConnection,
    mcpAuthentication: readMcpAuthenticationStatus(mcpConnection, {
      staticBearerConfigured: Boolean(ctx.options.token)
    })
  }, ctx.ae);
}

function handleDashboardV10(ctx) {
  const config = readConfig();
  sendJson(ctx.res, 200, buildDashboardPayload(config, {
    ...ctx.options,
    limit: Number(ctx.parsed.searchParams.get("limit") || 100)
  }, resolveRequireHttpToken(ctx.parsed, config)), ctx.ae);
}

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

async function handleOnboardingComplete(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  ensureConfig();
  writeOnboardingState({
    completed: Boolean(payload.completed),
    skipped: Boolean(payload.skipped),
    source: String(payload.source || ''),
    handoffPending: payload.handoffPending === true,
    updatedAt: new Date().toISOString()
  });
  sendJson(ctx.res, 200, { ok: true }, ctx.ae);
}

async function handleApiSettingsPost(ctx) {
  const current = readConfig();
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const result = configEditor.updateSettings(current, payload);
  await refreshMcpManifest('settings_changed');
  sendJson(ctx.res, 200, result, ctx.ae);
}

async function handleApiWorkspaces(ctx) {
  const current = readConfig();
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const result = configEditor.updateWorkspace(current, payload);
  await refreshMcpManifest('workspaces_changed');
  sendJson(ctx.res, 200, result, ctx.ae);
}

async function refreshMcpManifest(trigger) {
  await mcpConnectionManager.observeManifest(buildToolManifest(readConfig()), trigger);
}

function readConfigCached() {
  const configPath = getConfigPath();
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

const DASHBOARD_SNAPSHOT_COALESCE_MS = 350;
const DASHBOARD_SNAPSHOT_MAX_WAIT_MS = 1200;

function statSignature(file) {
  try {
    if (!file) return '0:0';
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return '0:0';
  }
}

function dashboardSourceRevision(options = {}, configOverride = null) {
  let config = configOverride;
  try { config ||= readConfigCached(); } catch { config = null; }
  const taskActivity = typeof options.getTaskActivity === 'function' ? options.getTaskActivity() : null;
  const desktopStatus = typeof options.getDesktopStatus === 'function' ? options.getDesktopStatus() : null;
  const signature = [
    statSignature(getConfigPath()),
    statSignature(config?.auditLogPath),
    JSON.stringify(taskActivity),
    JSON.stringify(desktopStatus),
    String(mcpConnectionManager.snapshot().revision),
    String(workspaceStateRevision())
  ].join('|');
  return crypto.createHash('sha256').update(signature).digest('base64url');
}

function requestedDashboardRevision(req) {
  try {
    return new URL(req?.url || '/events', 'http://127.0.0.1').searchParams.get('revision') || '';
  } catch {
    return '';
  }
}

function openDashboardEvents(res, req, options) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  let lastSignature = dashboardSourceRevision(options);
  const clientRevision = requestedDashboardRevision(req);
  const sendSnapshot = (force = false) => {
    try {
      const signature = dashboardSourceRevision(options);
      if (!force && signature === lastSignature) return;
      lastSignature = signature;
      const config = readConfigCached();
      const payload = buildDashboardPayload(config, { ...options, limit: 100, snapshotRevision: signature }, false);
      sendSse(res, 'dashboard', payload, { id: `${payload.snapshot.streamId}:${payload.snapshot.sequence}` });
    } catch (error) {
      sendSse(res, 'error', errorPayload(
        ERROR_CODES.UNKNOWN,
        error instanceof Error ? error.message : String(error)
      ));
    }
  };
  sendSse(res, 'ready', { ok: true, generatedAt: new Date().toISOString(), revision: lastSignature });
  if (!clientRevision || clientRevision !== lastSignature) sendSnapshot(true);

  let pendingSnapshot = null;
  let pendingSince = 0;
  const scheduleSnapshot = () => {
    if (res.destroyed) return;
    const now = Date.now();
    if (!pendingSince) pendingSince = now;
    if (pendingSnapshot) clearTimeout(pendingSnapshot);
    const remaining = Math.max(0, DASHBOARD_SNAPSHOT_MAX_WAIT_MS - (now - pendingSince));
    const delay = Math.min(DASHBOARD_SNAPSHOT_COALESCE_MS, remaining);
    pendingSnapshot = setTimeout(() => {
      pendingSnapshot = null;
      pendingSince = 0;
      if (!res.destroyed) sendSnapshot(false);
    }, delay);
    pendingSnapshot.unref?.();
  };
  const unsubscribe = onToolActivity(scheduleSnapshot);
  const unsubscribeConnection = mcpConnectionManager.onChange(scheduleSnapshot);
  const unsubscribeWorkspace = onWorkspaceStateChange(scheduleSnapshot);
  const heartbeat = setInterval(() => {
    if (!res.destroyed) res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);
  heartbeat.unref?.();
  req.on('close', () => {
    unsubscribe();
    unsubscribeConnection();
    unsubscribeWorkspace();
    if (pendingSnapshot) clearTimeout(pendingSnapshot);
    clearInterval(heartbeat);
  });
}

function safeInitialDashboardData(options = {}) {
  try {
    const config = readConfig();
    const snapshotRevision = dashboardSourceRevision(options, config);
    return buildDashboardPayload(config, { ...options, limit: 100, snapshotRevision }, false);
  } catch (error) {
    return errorPayload(
      ERROR_CODES.CONFIGURATION_INVALID,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function renderDashboardHtml(options, nonce) {
  const initialDashboardJson = jsonForHtmlScript(safeInitialDashboardData(options));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overview · Rel.AI MCP</title>
<link rel="icon" href="/public/assets/favicon.ico" sizes="any">
<link rel="icon" type="image/png" href="/public/assets/favicon.png">
<link rel="apple-touch-icon" href="/public/assets/relai-logo-192.png">
<script nonce="${nonce}">${renderDashboardShellBootstrap()}</script>
<link rel="stylesheet" href="/public/dashboard.css">
</head>
<body>
${renderDashboardWindowTitlebar()}
<a href="#main" class="skip-link">Skip to content</a><div class="sr-only" id="routeAnnouncer" role="status" aria-live="polite" aria-atomic="true"></div>
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="logo"><img src="/public/assets/relai-logo.png" alt="Rel.AI logo"></div><div><strong>Rel.AI MCP</strong><span>workspace control</span></div></div>
    <div class="sidebar-group">
      <div class="sidebar-group-label">Work</div>
      <nav class="nav" aria-label="Work navigation">${renderDashboardNav(WORK_NAV_ITEMS)}</nav>
    </div>
    <div class="sidebar-group secondary-nav">
      <div class="sidebar-group-label">Application</div>
      <nav class="nav application-nav" aria-label="Application navigation">${renderDashboardNav(APPLICATION_NAV_ITEMS)}</nav>
    </div>
    <div class="sidebar-note">This dashboard mirrors live MCP state.</div>
  </aside>
  <main id="main" class="main" tabindex="-1" aria-labelledby="pageTitle">
    <nav class="mobile-nav" aria-label="Mobile navigation">${renderDashboardNav(MOBILE_NAV_ITEMS)}</nav>
    <header class="topbar">
      <div class="title-wrap">
        <h1 class="page-title" id="pageTitle">Overview</h1>
        <div class="page-subtitle" id="subtitle">Checking local workspace state…</div>
      </div>
      <div class="top-controls">
        <button class="secondary command-trigger" id="commandPaletteBtn" type="button" aria-haspopup="dialog" aria-expanded="false" title="Open quick navigation"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><span class="command-trigger-label">Quick navigation</span><kbd>Ctrl K</kbd></button>
        <a class="status-pill warn connection-status-link" id="connectionStatus" href="#connection" aria-label="Open Connection settings; current status Connecting">Connecting…</a>
        <span class="section-action" id="lastUpdated"></span>
      </div>
    </header>
    <div id="routeRoot" class="route-root">
      <div class="dashboard-state">
        <div class="dashboard-state-card">
          <div class="loading-mark" aria-hidden="true"></div>
          <h2>Loading workspace state…</h2>
          <p>Rel.AI is checking the local service, configuration, and workspace status.</p>
          <div class="skeleton-grid" aria-hidden="true"><div class="skeleton-block"></div><div class="skeleton-block"></div><div class="skeleton-block"></div></div>
        </div>
      </div>
    </div>
  </main>
</div>
<script type="application/json" id="initialDashboardData" nonce="${nonce}">${initialDashboardJson}</script>
<script type="module" src="/public/dashboard.js"></script>
</body>
</html>`;
}

const handleTaskSession = (ctx) => {
  const config = readConfig();
  const taskId = String(ctx.parsed.searchParams.get("task") || "").trim();
  if (!taskId) { sendJson(ctx.res, 400, { ok: false, error: "task is required." }, ctx.ae); return; }
  const session = readTaskHistorySession(config, taskId);
  if (!session) { sendJson(ctx.res, 404, { ok: false, error: "Work session not found." }, ctx.ae); return; }
  sendJson(ctx.res, 200, { ok: true, session }, ctx.ae);
};

const handleApiLogs = (ctx) => {
  const config = readConfig();
  const limit = Number(ctx.parsed.searchParams.get("limit") || 100);
  const taskActivity = typeof ctx.options.getTaskActivity === 'function' ? ctx.options.getTaskActivity() : {};
  const tasks = readTaskHistory(config, taskActivity, { limit: 500 });
  sendJson(ctx.res, 200, mergeDashboardActivity(productUx.liveLogTail(config, { limit }), tasks, limit), ctx.ae);
};
const handleHealthMonitor = (ctx) => sendJson(ctx.res, 200, productUx.healthMonitor(readConfig(), { limit: Number(ctx.parsed.searchParams.get("limit") || 100) }), ctx.ae);
const handleAliasDiagnostics = (ctx) => sendJson(ctx.res, 200, productUx.aliasConsistencyCheck(readConfig()), ctx.ae);
const handleReleaseNotes = (ctx) => sendJson(ctx.res, 200, getReleaseNotes(), ctx.ae);
const handleCautionSummary = (ctx) => sendJson(ctx.res, 200, productUx.cautionSummary(readConfig(), { windowHours: Number(ctx.parsed.searchParams.get("windowHours") || 24) }), ctx.ae);
const handleReadiness = (ctx) => sendJson(ctx.res, 200, release.releaseReadiness(readConfig(), { requireHttpToken: resolveRequireHttpToken(ctx.parsed, readConfig()) }), ctx.ae);

const configCache = { path: "", mtimeMs: -1, value: null };

export { handleFavicon, handleHealth, handleStaticAsset, handleDashboard, handleApiSettingsGet, handleApiTools, handleOnboardingStatus, handleConnection, handleDashboardV10, handleTaskSession, handleApiLogs, handleHealthMonitor, handleAliasDiagnostics, handleReleaseNotes, handleCautionSummary, handleReadiness, handleWorkspacePreflight, handleEvents, handleOnboardingComplete, handleApiSettingsPost, handleApiWorkspaces, handlePickFolder, handleOpenFolder, handleSkillsGet, handleSkillsPost, handleWorkspaceChecks };
