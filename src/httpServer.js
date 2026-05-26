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
const autoApprove = require("./autoApproveExtension");

function buildToolMetadata() {
  const { getToolSchemas } = require("./tools");
  const config = readConfig({ allowMissing: true });
  return getToolSchemas(config).map(tool => ({
    name: tool.name,
    displayName: tool.name.replace(/^relai_/, "").replace(/_/g, " "),
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
  const chatgptSecret = String(options.chatgptSecret || process.env.REL_AI_MCP_CHATGPT_SECRET || launchEnv.REL_AI_MCP_CHATGPT_SECRET || savedProfile.chatgptSecret || "").trim();
  const publicUrl = connection.normalizePublicUrl(options.publicUrl || process.env.REL_AI_MCP_PUBLIC_URL || launchEnv.REL_AI_MCP_PUBLIC_URL || savedProfile.publicUrl || "");
  const allowNoAuth = Boolean(options.allowNoAuth || process.env.REL_AI_MCP_ALLOW_NO_AUTH === "1");
  const maxBodyBytes = Number(options.maxBodyBytes || process.env.REL_AI_MCP_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);

  if (!token && !allowNoAuth) {
    throw new Error("REL_AI_MCP_TOKEN is required for the HTTP/SSE server. Set a strong token, or set REL_AI_MCP_ALLOW_NO_AUTH=1 for local-only testing.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { token, chatgptSecret, allowNoAuth, maxBodyBytes, host, port, publicUrl });
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
    connection.writeConnectionProfile({ host, port: actualPort, publicUrl, chatgptSecret, configPath: require("./config").getConfigPath() });
    const summary = connection.buildConnectionSummary({ host, port: actualPort, publicUrl, token, chatgptSecret });
    console.error(`[rel-ai-mcp] Dashboard: ${summary.dashboardUrl}`);
    if (publicUrl) {
      console.error(`[rel-ai-mcp] ChatGPT MCP URL: ${summary.chatgptMcpUrl}`);
      console.error("[rel-ai-mcp] ChatGPT Auth: No Authentication");
      console.error("[rel-ai-mcp] Do not use the plain /mcp URL in ChatGPT.");
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

async function routeRequest(req, res, options) {
  setBaseHeaders(res);
  const ae = req.headers["accept-encoding"] || "";
  const parsed = new URL(req.url || "/", "http://127.0.0.1");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/dashboard") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    sendHtml(res, 200, renderDashboardHtml(options));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/favicon.ico") {
    try {
      const content = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "favicon.ico"));
      res.writeHead(200, { "Content-Type": "image/x-icon", "Cache-Control": "no-cache" });
      res.end(content);
    } catch (_) {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }


  // Serve src/ui/* and public/* without token (static assets only; API data remains token-gated)
  if (req.method === "GET" && (parsed.pathname.startsWith("/ui/") || parsed.pathname.startsWith("/public/"))) {
    const safePath = parsed.pathname.replace(/\\/g, "/");
    if (safePath.includes("..")) { res.writeHead(400); res.end("Bad path"); return; }
    let filePath;
    if (safePath.startsWith("/ui/")) {
      filePath = path.join(__dirname, "ui", safePath.slice(4));
    } else {
      filePath = path.join(__dirname, "..", "public", safePath.slice(8));
    }
    try {
      const content = fs.readFileSync(filePath);
      const ct = contentTypeForStaticAsset(safePath);
      const charset = ct.startsWith("text/") || ct === "application/javascript" ? "; charset=utf-8" : "";
      res.writeHead(200, { "Content-Type": ct + charset, "Cache-Control": "no-cache" });
      res.end(content);
    } catch (_) {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/settings") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, configEditor.settingsPayload(config), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/tools") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    try {
      sendJson(res, 200, buildToolMetadata(), ae);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message }, ae);
    }
    return;
  }


  if (req.method === "GET" && parsed.pathname === "/api/auto-approve/settings") {
    const config = readConfig();
    sendJson(res, 200, autoApprove.autoApproveSettings(config), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/onboarding/status") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const onboardingPath = path.join(require("node:os").homedir(), ".rel-ai-mcp", "onboarding.json");
    let flag = null;
    try { flag = JSON.parse(fs.readFileSync(onboardingPath, "utf8")); } catch (_) {}
    const needsOnboarding = !flag || flag.completed !== true;
    sendJson(res, 200, { ok: true, completed: flag ? flag.completed : false, skipped: flag ? flag.skipped : false, needsOnboarding }, ae);
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/onboarding/complete") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const payload = await readJsonBody(req, options.maxBodyBytes);
    const onboardingDir = path.join(require("node:os").homedir(), ".rel-ai-mcp");
    fs.mkdirSync(onboardingDir, { recursive: true });
    const onboardingPath = path.join(onboardingDir, "onboarding.json");
    fs.writeFileSync(onboardingPath, JSON.stringify({ completed: Boolean(payload.completed), skipped: Boolean(payload.skipped), updatedAt: new Date().toISOString() }));
    sendJson(res, 200, { ok: true }, ae);
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/settings") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const current = readConfig();
    const payload = await readJsonBody(req, options.maxBodyBytes);
    sendJson(res, 200, configEditor.updateSettings(current, payload), ae);
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/api/workspaces") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const current = readConfig();
    const payload = await readJsonBody(req, options.maxBodyBytes);
    sendJson(res, 200, configEditor.updateWorkspace(current, payload), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/connection") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const latestProfile = connection.readConnectionProfile();
    sendJson(res, 200, connection.buildConnectionSummary({
      host: latestProfile.host || options.host,
      port: latestProfile.port || options.port,
      publicUrl: latestProfile.publicUrl || options.publicUrl,
      token: options.token,
      chatgptSecret: latestProfile.chatgptSecret || options.chatgptSecret,
      tunnelProvider: latestProfile.tunnelProvider || "none",
      showToken: parsed.searchParams.get("showToken") === "1"
    }), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/dashboard/v10") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const limit = Number(parsed.searchParams.get("limit") || 100);
    sendJson(res, 200, {
      ...productUx.dashboardData(config, { limit }),
      readiness: release.releaseReadiness(config, { requireHttpToken: parsed.searchParams.get("requireHttpToken") !== "0" })
    }, ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/logs") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, productUx.liveLogTail(config, { limit: Number(parsed.searchParams.get("limit") || 100) }), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/health-monitor") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, productUx.healthMonitor(config, { limit: Number(parsed.searchParams.get("limit") || 100) }), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/readiness") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, release.releaseReadiness(config, { requireHttpToken: parsed.searchParams.get("requireHttpToken") !== "0" }), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/workspace/preflight") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const rawPath = parsed.searchParams.get("path") || "";
    if (rawPath) {
      sendJson(res, 200, workspacePathPreflight(rawPath), ae);
      return;
    }
    const config = readConfig();
    const payload = await release.workspacePreflight(config, { workspace: parsed.searchParams.get("workspace") || "", requireClean: parsed.searchParams.get("requireClean") !== "0" });
    sendJson(res, 200, payload, ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/events") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    openDashboardEvents(res, req, options);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      name: pkg.name,
      version: pkg.version,
      transports: ["streamable-http", "sse"],
      auth: options.token ? "bearer" : "disabled"
    }, ae);
    return;
  }

  const mcpAccess = getMcpAccess(parsed.pathname, options);

  if (req.method === "GET" && (parsed.pathname === "/mcp" || mcpAccess.kind === "streamable-http")) {
    sendJson(res, 200, mcpGetDiagnostic(parsed.pathname, options, mcpAccess, req), ae);
    return;
  }

  if (req.method === "POST" && mcpAccess.kind === "streamable-http") {
    if (!mcpAccess.allowed && !isAuthorized(req, options)) return unauthorized(res);
    const payload = await readJsonBody(req, options.maxBodyBytes);
    const response = await handleJsonRpcPayload(payload);
    if (response === null) {
      sendJson(res, 202, { ok: true, accepted: true }, ae);
      return;
    }
    sendJson(res, 200, response, ae);
    return;
  }

  if (req.method === "GET" && mcpAccess.kind === "sse") {
    if (!mcpAccess.allowed && !isAuthorized(req, options)) return unauthorized(res);
    openSseSession(res, req, mcpAccess.messagePath);
    return;
  }

  if (req.method === "POST" && mcpAccess.kind === "messages") {
    if (!mcpAccess.allowed && !isAuthorized(req, options)) return unauthorized(res);
    const sessionId = parsed.searchParams.get("sessionId") || "";
    const session = sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, error: "Unknown or expired SSE session." }, ae);
      return;
    }
    const payload = await readJsonBody(req, options.maxBodyBytes);
    const response = await handleJsonRpcPayload(payload);
    if (response !== null) {
      sendSse(session.res, "message", response);
    }
    sendJson(res, 202, { ok: true, accepted: true }, ae);
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "Not found.",
    endpoints: {
      health: "GET /health",
      dashboard: "GET /dashboard",
      dashboardV10Api: "GET /api/dashboard/v10",
      logsApi: "GET /api/logs",
      settingsApi: "GET /api/settings",
      updateSettingsApi: "POST /api/settings",
      updateWorkspacesApi: "POST /api/workspaces",
      healthMonitorApi: "GET /api/health-monitor",
      readinessApi: "GET /api/readiness",
      workspacePreflightApi: "GET /api/workspace/preflight?workspace=...",
      events: "GET /events",
      streamableHttp: "POST /mcp or POST /mcp/<chatgpt-secret>",
      sse: "GET /sse or GET /sse/<chatgpt-secret> then POST /messages...?sessionId=..."
    }
  }, ae);
}


function getMcpAccess(pathname, options) {
  const secret = String(options.chatgptSecret || "").trim();
  if (pathname === "/mcp") return { kind: "streamable-http", allowed: false };
  if (pathname === "/sse") return { kind: "sse", allowed: false, messagePath: "/messages" };
  if (pathname === "/messages") return { kind: "messages", allowed: false };
  if (!secret) return { kind: "none", allowed: false };
  const encoded = encodeURIComponent(secret);
  if (pathname === `/mcp/${encoded}` || pathname === `/mcp/${secret}`) return { kind: "streamable-http", allowed: true };
  if (pathname === `/sse/${encoded}` || pathname === `/sse/${secret}`) return { kind: "sse", allowed: true, messagePath: `/messages/${encoded}` };
  if (pathname === `/messages/${encoded}` || pathname === `/messages/${secret}`) return { kind: "messages", allowed: true };
  return { kind: "none", allowed: false };
}

function workspacePathPreflight(rawPath) {
  const target = path.resolve(String(rawPath || ""));
  const findings = [];
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch (_error) {
    findings.push({ severity: "error", code: "path_not_found", message: `Path does not exist: ${target}` });
  }
  const exists = Boolean(stat);
  const isDirectory = Boolean(stat && stat.isDirectory());
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
  const latestProfile = connection.readConnectionProfile();
  const base = latestProfile.publicUrl || options.publicUrl || connection.localBaseUrl?.(options.host, options.port) || `http://${options.host || "127.0.0.1"}:${options.port || 3333}`;
  const secret = String(latestProfile.chatgptSecret || options.chatgptSecret || "").trim();
  const chatgptPath = secret ? `/mcp/${encodeURIComponent(secret)}` : "/mcp/<missing-secret>";
  const bearerAuthorized = isAuthorized(req, options);
  const usableWithPost = Boolean(mcpAccess.allowed || bearerAuthorized || options.allowNoAuth);
  return {
    ok: true,
    endpoint: pathname,
    reachable: true,
    note: "This is a GET browser diagnostic. MCP clients must send JSON-RPC with POST.",
    correctChatGPTUrl: `${String(base || "").replace(/\/+$/, "")}${chatgptPath}`,
    chatgptAuth: "No Authentication",
    plainMcpUrl: "/mcp is for non-ChatGPT clients using Bearer auth. It is not the ChatGPT app URL.",
    postRequired: true,
    usableWithPost,
    examples: {
      health: "/health",
      dashboard: "/dashboard",
      chatgptMcp: chatgptPath,
      localBearerMcp: "/mcp"
    }
  };
}

async function handleJsonRpcPayload(payload) {
  if (Array.isArray(payload)) {
    const responses = [];
    for (const item of payload) {
      const response = await handleMessage(item);
      if (response) responses.push(response);
    }
    return responses.length > 0 ? responses : null;
  }
  return handleMessage(payload);
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
  sendSse(res, "ready", { ok: true, sessionId, name: pkg.name, version: pkg.version });

  const keepAlive = setInterval(() => {
    if (!sessions.has(sessionId)) return clearInterval(keepAlive);
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    sessions.delete(sessionId);
  });
}

function openDashboardEvents(res, req, options) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const sendSnapshot = () => {
    try {
      const config = readConfig();
      sendSse(res, "dashboard", {
        ...productUx.dashboardData(config, { limit: 100 }),
        readiness: release.releaseReadiness(config, { requireHttpToken: false })
      });
    } catch (error) {
      sendSse(res, "error", { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  sendSnapshot();
  const intervalMs = Math.max(1000, Number(readConfig({ allowMissing: true }).productUx?.liveLogPollSeconds || 3) * 1000);
  const timer = setInterval(sendSnapshot, intervalMs);
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

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    req.on("error", reject);
    req.on("end", () => {
      try {
        resolve(body.trim() ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

function setBaseHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
    } catch (_) {}
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
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function renderDashboardHtml(options) {
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
        <h1 class="page-title">Dashboard</h1>
        <div class="page-subtitle" id="subtitle">Loading server state…</div>
      </div>
      <div class="top-controls">
        <span class="status-pill ok" id="serverStatus">Online</span>
        <label for="token" class="sr-only">Dashboard token</label>
        <input id="token" type="password" placeholder="Dashboard token" autocomplete="off" spellcheck="false">
        <button id="refreshBtn" type="button">Refresh</button>
        <button class="secondary" id="liveBtn">Start live</button>
        <span class="section-action" id="lastUpdated">Server-rendered</span>
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
