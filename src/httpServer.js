const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { URL } = require("node:url");
const { handleMessage } = require("./server");
const { readConfig, publicConfigSummary, resolveWorkspace } = require("./config");
const productUx = require("./productUx");
const release = require("./release");
const configEditor = require("./configEditor");
const pkg = require("../package.json");
const connection = require("./connectionProfile");

function buildToolMetadata() {
  const { getToolSchemas, APPROVAL_GATES } = require("./tools");
  const categoryMap = {
    relai_repo: "Bridge", relai_read: "Bridge", relai_write: "Bridge", relai_verify: "Bridge",
    relai_browser: "Bridge", relai_diff: "Bridge", relai_reset: "Bridge",
  };
  const config = readConfig({ allowMissing: true });
  return getToolSchemas(config).map(tool => {
    const prefix = Object.keys(categoryMap).find(k => tool.name.startsWith(k)) || "relai";
    return {
      name: tool.name,
      displayName: tool.name.replace(/^relai_/, "").replace(/_/g, " "),
      description: tool.description || "",
      category: categoryMap[prefix] || "Other",
      requiredProfile: "bridge",
      requiresApproval: false,
      parameters: tool.inputSchema ? Object.keys(tool.inputSchema.properties || {}) : [],
    };
  });
}

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const sessions = new Map();

function startHttpServer(options = {}) {
  const launchEnv = connection.readLaunchEnv();
  const savedProfile = connection.readConnectionProfile();
  const host = options.host || process.env.REL_AI_MCP_HOST || savedProfile.host || "127.0.0.1";
  const port = Number(options.port ?? process.env.REL_AI_MCP_PORT ?? savedProfile.port ?? 3333);
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
      console.error("[rel-ai-mcp] WARNING: HTTP/SSE auth is disabled. Use only on a trusted local network.");
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

  if (req.method === "GET" && parsed.pathname === "/api/dashboard") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") || 50), 1), 200);
    sendJson(res, 200, {
      ok: true,
      name: pkg.name,
      version: pkg.version,
      config: publicConfigSummary(config),
      workflow: {
        normal: ["relai_repo_snapshot", "relai_read", "relai_write", "relai_verify", "relai_diff", "relai_reset"],
        removedLegacyWorkflows: ["patch", "shell", "task-runner", "worktree", "multi-agent", "approvals", "docker", "pr-ci-repair"]
      },
      audit: require("./audit").readAudit(config, { limit })
    }, ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/connection") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    sendJson(res, 200, connection.buildConnectionSummary({
      host: options.host,
      port: options.port,
      publicUrl: options.publicUrl,
      token: options.token,
      chatgptSecret: options.chatgptSecret,
      showToken: parsed.searchParams.get("showToken") === "1"
    }), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/dashboard/v9") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, productUx.dashboardData(config, { limit: Number(parsed.searchParams.get("limit") || 100) }), ae);
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

  if (req.method === "GET" && parsed.pathname === "/api/release-manifest") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, release.releaseManifest(config, { maxFiles: Number(parsed.searchParams.get("maxFiles") || 10000) }), ae);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/workspace/preflight") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
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
      dashboardApi: "GET /api/dashboard",
      dashboardV9Api: "GET /api/dashboard/v9",
      dashboardV10Api: "GET /api/dashboard/v10",
      logsApi: "GET /api/logs",
      settingsApi: "GET /api/settings",
      updateSettingsApi: "POST /api/settings",
      updateWorkspacesApi: "POST /api/workspaces",
      healthMonitorApi: "GET /api/health-monitor",
      readinessApi: "GET /api/readiness",
      releaseManifestApi: "GET /api/release-manifest",
      workspacePreflightApi: "GET /api/workspace/preflight?workspace=...",
      events: "GET /events",
      sessionDiffApi: "GET /api/session/diff?workspace=...&sessionId=...",
      taskGraphApi: "GET /api/task/graph?sessionId=...",
      sessionExportApi: "GET /api/session/export?workspace=...&sessionId=...",
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

function mcpGetDiagnostic(pathname, options, mcpAccess, req) {
  const base = options.publicUrl || connection.localBaseUrl?.(options.host, options.port) || `http://${options.host || "127.0.0.1"}:${options.port || 3333}`;
  const secret = String(options.chatgptSecret || "").trim();
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

function resolveApiWorkspace(config, parsed) {
  const workspaceAlias = parsed.searchParams.get("workspace") || "";
  return resolveWorkspace(config, workspaceAlias);
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

function sendJavaScript(res, status, js) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
  res.end(js);
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
    <div class="brand"><div class="logo"><img src="/public/assets/relai-logo.png" alt="Rel.AI logo"></div><div><strong>Rel.AI MCP</strong><span>local agent control</span></div></div>
    <nav class="nav">
      <a class="active" href="#home">Home</a>
      <a href="#workspaces">Workspaces</a>
      <a href="#activity">Activity</a>
      <a href="#settings">Settings</a>
    </nav>
    <div class="sidebar-note">This dashboard mirrors live MCP state.</div>
  </aside>
  <main id="main" class="main">
    <div class="mobile-nav">
      <a href="#home">Home</a><a href="#workspaces">Workspaces</a><a href="#activity">Activity</a><a href="#settings">Settings</a>
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
        <button class="secondary" id="rawToggleBtn">View API response</button>
      </div>
    </header>

    <section class="section" id="overview">
      <div class="section-head"><div><h2>Overview</h2><p>ChatGPT local repo bridge overview.</p></div></div>
      <div class="overview-grid" id="metrics"></div>
    </section>

    <section class="layout-grid" id="workspaces">
      <div class="card">
        <div class="card-head"><h3>Workspaces</h3><span class="section-action" id="workspaceCount">0 configured</span></div>
        <div class="card-body"><div class="workspace-grid" id="workspacesList"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Server configuration</h3><span class="status-pill" id="profilePill">profile</span></div>
        <div class="card-body"><div class="list" id="configList"></div></div>
      </div>
    </section>

    <section class="layout-grid" id="activity">
      <div class="card">
        <div class="card-head"><h3>Recent activity</h3><span class="section-action" id="activityCount">0 events</span></div>
        <div class="card-body"><div class="table-wrap"><table class="data-table"><caption class="sr-only">Recent audit activity</caption><thead><tr><th scope="col">Time</th><th scope="col">Tool</th><th scope="col">Workspace</th><th scope="col">Status</th><th scope="col">Message</th></tr></thead><tbody id="activityRows"></tbody></table></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Live console</h3><span class="section-action">polling-safe view</span></div>
        <div class="card-body"><div class="terminal" id="terminal"><span class="prompt">$</span> relai dashboard<br><span class="warn">…</span> waiting for data</div></div>
      </div>
    </section>

    <section class="columns-3">
      <div class="card">
        <div class="card-head"><h3>Sessions</h3><span class="section-action" id="sessionCount">0</span></div>
        <div class="card-body"><div class="list" id="sessionsList"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Jobs</h3><span class="section-action" id="jobCount">0</span></div>
        <div class="card-body"><div class="list" id="jobsList"></div></div>
      </div>
    </section>

    <section class="card" id="connector">
      <div class="card-head"><h3>ChatGPT connector setup</h3><span class="status-pill" id="connectorStatus">checking</span></div>
      <div class="card-body connector-grid">
        <div class="setup-steps">
          <div class="step"><span class="step-num">1</span><div>Run <code>npm run oneclick -- --public-url https://your-domain.example.com</code>.</div></div>
          <div class="step"><span class="step-num">2</span><div>Use the printed <code>/mcp/&lt;secret&gt;</code> URL as your MCP server in ChatGPT.</div></div>
          <div class="step"><span class="step-num">3</span><div>In ChatGPT, go to <strong>Settings → Connectors → Add MCP server</strong> and paste the URL.</div></div>
          <div class="step"><span class="step-num">4</span><div>Set authentication to <strong>No Authentication</strong>. Keep the bearer token only for local dashboard access.</div></div>
        </div>
        <pre class="copy-box" id="connectorBox">Loading connector profile…</pre>
      </div>
    </section>

    <section class="columns-2" id="diagnostics">
      <div class="card">
        <div class="card-head"><h3>Session diff</h3><span class="section-action">safe read-only endpoint</span></div>
        <div class="card-body utility-grid">
          <div class="field-row"><label for="workspace" class="sr-only">Workspace alias</label><input id="workspace" placeholder="workspace alias" value=""></div>
          <div class="field-row"><label for="sessionId" class="sr-only">Session ID</label><input id="sessionId" placeholder="session id"><button disabled title="Open Settings Diagnostics for this action">Load diff</button></div>
        </div>
        <div class="card-body diff-panel"><pre id="diffOut">No diff loaded.</pre></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Maintenance views</h3><span class="section-action">no write actions</span></div>
        <div class="card-body">
          <div class="setup-steps">
            <button class="secondary" disabled title="Open Settings Diagnostics for this action">Load health monitor</button>
            <button class="secondary" disabled title="Open Settings Diagnostics for this action">Load readiness</button>
            <button class="secondary" disabled title="Open Settings Diagnostics for this action">Load audit tail</button>
          </div>
        </div>
        <div class="card-body diff-panel"><pre id="maintenanceOut">Choose a diagnostic view.</pre></div>
      </div>
    </section>

    <section class="raw-panel" id="rawPanel">
      <div class="card">
        <div class="card-head"><h3>Raw dashboard payload</h3><button class="secondary" id="rawCloseBtn">Close</button></div>
        <div class="card-body"><pre id="rawOut">No data yet.</pre></div>
      </div>
    </section>
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
