const fs = require("node:fs");
const path = require("node:path");
const { readConfig } = require("../config");
const productUx = require("../productUx");
const release = require("../release");
const configEditor = require("../configEditor");
const pkg = require("../../package.json");
const connection = require("../connectionProfile");
const { getVersion } = require("../version");
const { resolveRequireHttpToken } = require("./auth");
const {
  sendJson,
  sendHtml,
  sendSse,
  readJsonBody,
  contentTypeForStaticAsset,
  jsonForHtmlScript
} = require("./io");

function buildToolMetadata() {
  return require("../tools").getPublicToolMetadata();
}

const DASHBOARD_NAV_ITEMS = [
  { id: "home", label: "Overview", icon: '<path d="M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z" />' },
  { id: "workspaces", label: "Workspaces", icon: '<path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v2.5Z" />' },
  { id: "activity", label: "Activity", icon: '<path d="M3 12h4l2.3-6 4.2 12 2.3-6H21" />' },
  { id: "tools", label: "Tools", icon: '<path d="m14.7 6.3 3-3a5 5 0 0 1-6.4 6.4l-6.8 6.8a2.1 2.1 0 0 0 3 3l6.8-6.8a5 5 0 0 1 6.4-6.4l-3 3-3-3Z" />' },
  { id: "settings", label: "Settings", icon: '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" />' }
];

function renderDashboardNav() {
  return DASHBOARD_NAV_ITEMS.map((item) => `<a href="#${item.id}" aria-label="${item.label}"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span class="nav-label">${item.label}</span></a>`).join("");
}

function buildDashboardPayload(config, options = {}, requireHttpToken = false) {
  const profile = connection.readConnectionProfile();
  return {
    ...productUx.dashboardData(config, { limit: Number(options.limit || 100) }),
    readiness: release.releaseReadiness(config, { requireHttpToken }),
    connection: connection.buildConnectionSummary({
      host: profile.host || options.host || "127.0.0.1",
      port: profile.port || options.port || 3333,
      publicUrl: profile.publicUrl || options.publicUrl || "",
      token: "",
      tunnelProvider: profile.tunnelProvider || "none"
    })
  };
}

async function handleFavicon(ctx) {
  try {
    const content = fs.readFileSync(path.join(__dirname, "..", "..", "public", "assets", "favicon.ico"));
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
  let filePath;
  if (safePath.startsWith("/ui/")) {
    filePath = path.join(__dirname, "..", "ui", safePath.slice(4));
  } else if (safePath.startsWith("/public/ui/")) {
    filePath = path.join(__dirname, "..", "ui", safePath.slice(11));
  } else {
    filePath = path.join(__dirname, "..", "..", "public", safePath.slice(8));
  }
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

function readConfigCached() {
  const configPath = require("../config").getConfigPath();
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

function openDashboardEvents(res, req, options) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const statSignature = (file) => {
    try {
      if (!file) return "0:0";
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "0:0";
    }
  };
  const changeSignature = () => {
    let config = null;
    try { config = readConfigCached(); } catch { /* config may be unavailable; signature stays empty */ }
    return [
      statSignature(require("../config").getConfigPath()),
      statSignature(config?.auditLogPath)
    ].join("|");
  };
  let lastSignature = "";
  const sendSnapshot = (force = false) => {
    try {
      const signature = changeSignature();
      if (!force && signature === lastSignature) return;
      lastSignature = signature;
      const config = readConfigCached();
      sendSse(res, "dashboard", buildDashboardPayload(config, { ...options, limit: 100 }, false));
    } catch (error) {
      sendSse(res, "error", { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  sendSnapshot(true);
  const intervalMs = Math.max(1000, Number(readConfig({ allowMissing: true }).productUx?.liveLogPollSeconds || 3) * 1000);
  const timer = setInterval(() => sendSnapshot(false), intervalMs);
  req.on("close", () => clearInterval(timer));
}

function safeInitialDashboardData() {
  try {
    const config = readConfig();
    return buildDashboardPayload(config, { limit: 100 }, false);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
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
<script>
try {
  const themePreference = localStorage.getItem('relai_ui_theme') || 'system';
  const resolvedTheme = themePreference === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : themePreference;
  document.documentElement.dataset.themePreference = themePreference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.density = localStorage.getItem('relai_ui_density') || 'comfortable';
} catch {}
</script>
<link rel="stylesheet" href="/public/dashboard.css">
</head>
<body>
<a href="#main" class="skip-link">Skip to content</a>
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="logo"><img src="/public/assets/relai-logo.png" alt="Rel.AI logo"></div><div><strong>Rel.AI MCP</strong><span>workspace control</span></div></div>
    <nav class="nav" aria-label="Primary navigation">${renderDashboardNav()}</nav>
    <div class="sidebar-note">This dashboard mirrors live MCP state.</div>
  </aside>
  <main id="main" class="main">
    <nav class="mobile-nav" aria-label="Mobile navigation">${renderDashboardNav()}</nav>
    <header class="topbar">
      <div class="title-wrap">
        <h1 class="page-title" id="pageTitle">Rel.AI MCP</h1>
        <div class="page-subtitle" id="subtitle">Checking local workspace state…</div>
      </div>
      <div class="top-controls">
        <span class="status-pill" id="serverStatus">Connecting…</span>
        <button class="secondary" id="refreshBtn" type="button">Refresh</button>
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
<script type="application/json" id="initialDashboardData">${initialDashboardJson}</script>
<script type="module" src="/public/dashboard.js"></script>
</body>
</html>`;
}

const handleApiLogs = (ctx) => sendJson(ctx.res, 200, productUx.liveLogTail(readConfig(), { limit: Number(ctx.parsed.searchParams.get("limit") || 100) }), ctx.ae);
const handleHealthMonitor = (ctx) => sendJson(ctx.res, 200, productUx.healthMonitor(readConfig(), { limit: Number(ctx.parsed.searchParams.get("limit") || 100) }), ctx.ae);
const handleAliasDiagnostics = (ctx) => sendJson(ctx.res, 200, productUx.aliasConsistencyCheck(readConfig()), ctx.ae);
const handleReleaseNotes = (ctx) => sendJson(ctx.res, 200, require("../releaseNotes").getReleaseNotes(), ctx.ae);
const handleCautionSummary = (ctx) => sendJson(ctx.res, 200, productUx.cautionSummary(readConfig(), { windowHours: Number(ctx.parsed.searchParams.get("windowHours") || 24) }), ctx.ae);
const handleReadiness = (ctx) => sendJson(ctx.res, 200, release.releaseReadiness(readConfig(), { requireHttpToken: resolveRequireHttpToken(ctx.parsed, readConfig()) }), ctx.ae);

const configCache = { path: "", mtimeMs: -1, value: null };

module.exports = {
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
  handlePickFolder
};
