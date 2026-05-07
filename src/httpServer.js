const http = require("node:http");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { handleMessage } = require("./server");
const { readConfig, publicConfigSummary, resolveWorkspace } = require("./config");
const sessionsStore = require("./sessions");
const { listJobs } = require("./jobs");
const approvals = require("./approvals");
const locks = require("./locks");
const taskRunner = require("./taskRunner");
const multiagent = require("./multiagent");
const productUx = require("./productUx");
const release = require("./release");
const { workspaceFromSession } = require("./worktrees");
const pkg = require("../package.json");
const connection = require("./connectionProfile");

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

  if (req.method === "GET" && parsed.pathname === "/api/dashboard") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") || 50), 1), 200);
    sendJson(res, 200, {
      ok: true,
      name: pkg.name,
      version: pkg.version,
      config: publicConfigSummary(config),
      sessions: sessionsStore.listSessions(config, { limit }),
      jobs: listJobs(config, { limit }),
      approvals: approvals.listApprovals(config, { limit }),
      locks: locks.listLocks(config).locks,
      multiAgent: multiagent.multiagentStatus(config, { limit })
    });
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
    }));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/dashboard/v9") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, productUx.dashboardData(config, { limit: Number(parsed.searchParams.get("limit") || 100) }));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/dashboard/v10") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const limit = Number(parsed.searchParams.get("limit") || 100);
    sendJson(res, 200, {
      ...productUx.dashboardData(config, { limit }),
      readiness: release.releaseReadiness(config, { requireHttpToken: parsed.searchParams.get("requireHttpToken") !== "0" })
    });
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/logs") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, productUx.liveLogTail(config, { limit: Number(parsed.searchParams.get("limit") || 100) }));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/health-monitor") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, productUx.healthMonitor(config, { limit: Number(parsed.searchParams.get("limit") || 100) }));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/readiness") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, release.releaseReadiness(config, { requireHttpToken: parsed.searchParams.get("requireHttpToken") !== "0" }));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/release-manifest") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    sendJson(res, 200, release.releaseManifest(config, { maxFiles: Number(parsed.searchParams.get("maxFiles") || 10000) }));
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/workspace/preflight") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const payload = await release.workspacePreflight(config, { workspace: parsed.searchParams.get("workspace") || "", requireClean: parsed.searchParams.get("requireClean") !== "0" });
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/events") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    openDashboardEvents(res, req, options);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/task/graph") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const payload = multiagent.taskGraph(config, {
      sessionId: parsed.searchParams.get("sessionId") || undefined,
      parentSessionId: parsed.searchParams.get("parentSessionId") || undefined
    });
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/session/export") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const workspace = resolveApiWorkspace(config, parsed);
    const payload = await taskRunner.sessionExport(config, workspace, {
      workspace: parsed.searchParams.get("workspace") || undefined,
      sessionId: parsed.searchParams.get("sessionId") || undefined,
      auditLimit: Number(parsed.searchParams.get("auditLimit") || 200)
    });
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/api/session/diff") {
    if (!isAuthorized(req, options) && parsed.searchParams.get("token") !== options.token) return unauthorized(res);
    const config = readConfig();
    const workspace = resolveApiWorkspace(config, parsed);
    const payload = await taskRunner.sessionDiff(config, workspace, {
      workspace: parsed.searchParams.get("workspace") || undefined,
      sessionId: parsed.searchParams.get("sessionId") || undefined,
      staged: parsed.searchParams.get("staged") === "1"
    });
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      name: pkg.name,
      version: pkg.version,
      transports: ["streamable-http", "sse"],
      auth: options.token ? "bearer" : "disabled"
    });
    return;
  }

  const mcpAccess = getMcpAccess(parsed.pathname, options);

  if (req.method === "GET" && (parsed.pathname === "/mcp" || mcpAccess.kind === "streamable-http")) {
    sendJson(res, 200, mcpGetDiagnostic(parsed.pathname, options, mcpAccess, req));
    return;
  }

  if (req.method === "POST" && mcpAccess.kind === "streamable-http") {
    if (!mcpAccess.allowed && !isAuthorized(req, options)) return unauthorized(res);
    const payload = await readJsonBody(req, options.maxBodyBytes);
    const response = await handleJsonRpcPayload(payload);
    if (response === null) {
      sendJson(res, 202, { ok: true, accepted: true });
      return;
    }
    sendJson(res, 200, response);
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
      sendJson(res, 404, { ok: false, error: "Unknown or expired SSE session." });
      return;
    }
    const payload = await readJsonBody(req, options.maxBodyBytes);
    const response = await handleJsonRpcPayload(payload);
    if (response !== null) {
      sendSse(session.res, "message", response);
    }
    sendJson(res, 202, { ok: true, accepted: true });
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
  });
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
  const sessionId = parsed.searchParams.get("sessionId") || "";
  let baseAlias = workspaceAlias;
  if (!baseAlias && sessionId) baseAlias = sessionsStore.readSession(config, sessionId).workspace;
  const base = resolveWorkspace(config, baseAlias);
  return sessionId ? workspaceFromSession(config, base, sessionId) : base;
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
      sendSse(res, "dashboard", productUx.dashboardData(config, { limit: 100 }));
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

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload)}\n`);
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

function jsonForHtmlScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function renderDashboardHtml(options) {
  const tokenQuery = options.token ? `?token=${encodeURIComponent(options.token)}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rel.AI MCP Dashboard</title>
<style>
:root{
  color-scheme:dark;
  --bg:#070b13;
  --surface:#0b1220;
  --surface-2:#111a2c;
  --surface-3:#162238;
  --line:#22304a;
  --line-soft:rgba(154,173,212,.14);
  --text:#edf4ff;
  --muted:#9aa9bf;
  --muted-2:#718098;
  --blue:#4ea1ff;
  --cyan:#50d7ff;
  --green:#47dd8a;
  --amber:#ffc24b;
  --red:#ff6680;
  --purple:#9b7cff;
  --radius:16px;
  --radius-sm:10px;
  --shadow:0 22px 65px rgba(0,0,0,.38);
  --page-pad:clamp(14px,2vw,28px);
}
*{box-sizing:border-box}
html{height:100%;background:var(--bg);scroll-behavior:smooth}
body{
  min-height:100%;margin:0;color:var(--text);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  background:
    radial-gradient(circle at 0 0,rgba(78,161,255,.16),transparent 30rem),
    radial-gradient(circle at 100% -10%,rgba(155,124,255,.14),transparent 32rem),
    linear-gradient(180deg,#070b13 0%,#080d17 100%);
}
button,input,select{font:inherit}
button{
  min-height:38px;border:1px solid rgba(125,164,255,.32);border-radius:10px;padding:0 12px;
  color:var(--text);background:linear-gradient(180deg,rgba(78,161,255,.18),rgba(78,161,255,.07));cursor:pointer;
}
button:hover{border-color:rgba(80,215,255,.66);background:linear-gradient(180deg,rgba(78,161,255,.25),rgba(155,124,255,.12))}
button.secondary{background:rgba(255,255,255,.04);border-color:var(--line);color:#d8e4f7}
button.danger{border-color:rgba(255,102,128,.45);background:rgba(255,102,128,.08)}
input,select{
  min-height:38px;border:1px solid var(--line);border-radius:10px;padding:0 11px;color:var(--text);
  background:#090f1b;outline:none;min-width:0;
}
input:focus,select:focus{border-color:rgba(80,215,255,.68);box-shadow:0 0 0 3px rgba(80,215,255,.1)}
a{color:var(--cyan)} code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cfe0ff}
.app-shell{display:grid;grid-template-columns:220px minmax(0,1fr);gap:22px;min-height:100vh;padding:var(--page-pad);max-width:1720px;margin:0 auto}
.sidebar{
  position:sticky;top:var(--page-pad);height:calc(100vh - (var(--page-pad) * 2));padding:16px;
  border:1px solid var(--line-soft);border-radius:22px;background:rgba(9,15,27,.82);box-shadow:var(--shadow);overflow:auto;
}
.brand{display:flex;align-items:center;gap:11px;padding-bottom:14px;border-bottom:1px solid var(--line-soft)}
.logo{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-weight:900;background:linear-gradient(135deg,var(--blue),var(--purple))}
.brand strong{display:block;letter-spacing:-.02em}.brand span{display:block;margin-top:2px;color:var(--muted);font-size:12px}
.nav{display:grid;gap:7px;margin-top:16px}.nav a{display:flex;align-items:center;gap:9px;padding:10px 11px;border-radius:10px;color:#c9d6e8;text-decoration:none;border:1px solid transparent;font-size:13px}.nav a:hover{background:rgba(78,161,255,.08);border-color:rgba(78,161,255,.16)}.nav a.active{background:#173b73;color:#fff;border-color:rgba(78,161,255,.35)}
.sidebar-note{margin-top:18px;padding-top:14px;border-top:1px solid var(--line-soft);color:var(--muted);font-size:12px;line-height:1.45}
.main{min-width:0;display:grid;gap:18px}.topbar{
  position:sticky;top:var(--page-pad);z-index:5;display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:13px 14px;border:1px solid var(--line-soft);border-radius:18px;background:rgba(8,13,23,.86);backdrop-filter:blur(14px);box-shadow:0 12px 34px rgba(0,0,0,.26)
}
.title-wrap{min-width:0}.page-title{margin:0;font-size:20px;letter-spacing:-.025em}.page-subtitle{margin-top:3px;color:var(--muted);font-size:13px}.top-controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.top-controls input{width:min(230px,36vw)}
.status-pill{display:inline-flex;align-items:center;gap:7px;min-height:28px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid var(--line);background:rgba(255,255,255,.04);white-space:nowrap}.status-pill:before{content:"";width:8px;height:8px;border-radius:999px;background:var(--muted-2)}.status-pill.ok:before{background:var(--green);box-shadow:0 0 14px rgba(71,221,138,.65)}.status-pill.warn:before{background:var(--amber)}.status-pill.bad:before{background:var(--red)}
.section{display:grid;gap:12px}.section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.section-head h2{margin:0;font-size:15px;letter-spacing:-.01em}.section-head p{margin:3px 0 0;color:var(--muted);font-size:12px}.section-action{color:var(--muted-2);font-size:12px}
.overview-grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:12px}.metric{
  min-width:0;padding:14px;border:1px solid var(--line-soft);border-radius:var(--radius);background:linear-gradient(180deg,rgba(17,26,44,.94),rgba(11,18,32,.94));box-shadow:0 14px 34px rgba(0,0,0,.2)
}.metric-label{font-size:12px;color:var(--muted);font-weight:700}.metric-value{margin-top:8px;font-size:30px;line-height:1;font-weight:850;letter-spacing:-.04em}.metric-meta{margin-top:7px;color:var(--muted-2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.metric.good .metric-value{color:var(--green)}.metric.warn .metric-value{color:var(--amber)}.metric.bad .metric-value{color:var(--red)}.metric.blue .metric-value{color:var(--blue)}.metric.purple .metric-value{color:var(--purple)}
.layout-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr);gap:14px}.columns-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.columns-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.card{min-width:0;border:1px solid var(--line-soft);border-radius:var(--radius);background:rgba(11,18,32,.88);box-shadow:0 16px 38px rgba(0,0,0,.22);overflow:hidden}.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;border-bottom:1px solid var(--line-soft)}.card-head h3{margin:0;font-size:14px}.card-body{padding:12px}.card-foot{padding:11px 14px;border-top:1px solid var(--line-soft);color:var(--muted);font-size:12px;background:rgba(255,255,255,.02)}
.table-wrap{overflow:auto}.data-table{width:100%;border-collapse:collapse;font-size:13px}.data-table th{position:sticky;top:0;background:#0d1728;color:#9fb0c8;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.08em}.data-table th,.data-table td{padding:10px 9px;border-bottom:1px solid rgba(154,173,212,.09);vertical-align:top}.data-table td{color:#dfe8f6}.data-table tr:hover td{background:rgba(78,161,255,.04)}.nowrap{white-space:nowrap}.truncate{max-width:270px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.muted{color:var(--muted)}.small{font-size:12px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.list{display:grid;gap:9px}.list-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px;border:1px solid rgba(154,173,212,.1);border-radius:12px;background:rgba(255,255,255,.025)}.dot{width:9px;height:9px;border-radius:99px;background:var(--green);margin-top:4px}.dot.warn{background:var(--amber)}.dot.bad{background:var(--red)}.item-title{font-weight:750;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-sub{margin-top:3px;color:var(--muted);font-size:12px;line-height:1.4;word-break:break-word}.item-time{color:var(--muted-2);font-size:11px;white-space:nowrap}.empty{padding:18px;border:1px dashed rgba(154,173,212,.18);border-radius:12px;color:var(--muted);font-size:13px;text-align:center;background:rgba(255,255,255,.02)}
.workspace-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.workspace-card{padding:12px;border:1px solid rgba(154,173,212,.12);border-radius:13px;background:rgba(255,255,255,.025)}.workspace-card strong{display:block}.workspace-card .path{margin-top:5px;color:var(--muted);font-size:12px;line-height:1.4;word-break:break-all}.badge-row{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.badge{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border-radius:999px;background:rgba(78,161,255,.1);border:1px solid rgba(78,161,255,.16);color:#cfe3ff;font-size:11px;font-weight:700}.badge.warn{background:rgba(255,194,75,.08);border-color:rgba(255,194,75,.22);color:#ffe2a1}.badge.good{background:rgba(71,221,138,.08);border-color:rgba(71,221,138,.2);color:#c6f8dc}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:9px}.agent{padding:10px;border:1px solid rgba(154,173,212,.11);border-radius:12px;background:rgba(255,255,255,.025)}.agent-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.agent-name{font-weight:760;font-size:13px}.agent-state{margin-top:5px;color:var(--muted);font-size:12px}.agent-icon{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;background:rgba(78,161,255,.12);color:#b8d7ff}
.connector-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.5fr);gap:12px}.setup-steps{display:grid;gap:8px}.step{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px;padding:10px;border:1px solid rgba(154,173,212,.11);border-radius:12px;background:rgba(255,255,255,.024);font-size:13px;color:#dce8f8;line-height:1.4}.step-num{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#173b73;color:#fff;font-size:12px;font-weight:800}.copy-box{min-height:164px;white-space:pre-wrap;word-break:break-word;border:1px solid rgba(154,173,212,.12);border-radius:12px;background:#070c15;padding:12px;color:#d9e7fa;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:auto}
.utility-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}.field-row{display:flex;gap:8px;align-items:center}.field-row input{flex:1}.terminal{min-height:176px;max-height:280px;overflow:auto;background:#070c15;border:1px solid rgba(154,173,212,.12);border-radius:12px;padding:12px;color:#d8e8fb;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.terminal .ok{color:var(--green)}.terminal .warn{color:var(--amber)}.terminal .bad{color:var(--red)}.terminal .prompt{color:var(--cyan)}
.raw-panel{display:none}.raw-panel.open{display:block}.raw-panel pre,.diff-panel pre{max-height:440px;overflow:auto;margin:0;border:1px solid rgba(154,173,212,.12);border-radius:12px;background:#060a12;padding:12px;color:#cfe0f8;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.mobile-nav{display:none;gap:8px;overflow:auto;padding:2px}.mobile-nav a{white-space:nowrap;text-decoration:none;color:#d8e6fb;border:1px solid var(--line);border-radius:999px;padding:8px 10px;font-size:12px;background:rgba(255,255,255,.035)}
@media (max-width:1250px){.app-shell{grid-template-columns:1fr}.sidebar{display:none}.mobile-nav{display:flex}.overview-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.layout-grid,.connector-grid{grid-template-columns:1fr}.topbar{top:8px}}
@media (max-width:860px){.topbar{position:relative;top:auto;align-items:flex-start;flex-direction:column}.top-controls{justify-content:flex-start;width:100%}.top-controls input{width:100%;flex:1 1 180px}.overview-grid,.columns-2,.columns-3,.utility-grid{grid-template-columns:1fr}.card-head,.section-head{align-items:flex-start;flex-direction:column}.data-table th,.data-table td{padding:9px 7px}.truncate{max-width:180px}}
@media (max-width:520px){:root{--page-pad:10px}.metric-value{font-size:26px}.card-body{padding:10px}.top-controls button{flex:1}.field-row{flex-direction:column;align-items:stretch}.list-item{grid-template-columns:auto minmax(0,1fr)}.item-time{grid-column:2}.data-table{min-width:560px}}
</style>
</head>
<body>
<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="logo">R</div><div><strong>Rel.AI MCP</strong><span>local agent control</span></div></div>
    <nav class="nav">
      <a class="active" href="#overview">Overview</a>
      <a href="#workspaces">Workspaces</a>
      <a href="#activity">Activity</a>
      <a href="#agents">Agents</a>
      <a href="#connector">ChatGPT setup</a>
      <a href="#diagnostics">Diagnostics</a>
    </nav>
    <div class="sidebar-note">This dashboard mirrors live MCP state. It is intentionally dense and operational, not a landing page.</div>
  </aside>
  <main class="main">
    <div class="mobile-nav">
      <a href="#overview">Overview</a><a href="#workspaces">Workspaces</a><a href="#activity">Activity</a><a href="#agents">Agents</a><a href="#connector">Connector</a><a href="#diagnostics">Diagnostics</a>
    </div>
    <header class="topbar">
      <div class="title-wrap">
        <h1 class="page-title">Dashboard</h1>
        <div class="page-subtitle" id="subtitle">Loading server state…</div>
      </div>
      <div class="top-controls">
        <span class="status-pill ok" id="serverStatus">Online</span>
        <input id="token" type="password" placeholder="Dashboard token, if required" value="${options.token ? "" : ""}">
        <button onclick="refresh()">Refresh</button>
        <button class="secondary" id="liveBtn" onclick="toggleLive()">Start live</button>
        <button class="secondary" onclick="toggleRaw()">Raw</button>
      </div>
    </header>

    <section class="section" id="overview">
      <div class="section-head"><div><h2>Overview</h2><p>Live counts from sessions, jobs, approvals, locks, health, and readiness.</p></div><span class="section-action" id="lastUpdated">Server-rendered</span></div>
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
        <div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Tool</th><th>Workspace</th><th>Status</th><th>Message</th></tr></thead><tbody id="activityRows"></tbody></table></div></div>
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
      <div class="card">
        <div class="card-head"><h3>Approvals</h3><span class="section-action" id="approvalCount">0</span></div>
        <div class="card-body"><div class="list" id="approvalsList"></div></div>
      </div>
    </section>

    <section class="layout-grid" id="agents">
      <div class="card">
        <div class="card-head"><h3>Agent roles</h3><span class="section-action" id="agentCount">0 roles</span></div>
        <div class="card-body"><div class="agent-grid" id="agentGrid"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Health findings</h3><span class="section-action" id="findingCount">0 findings</span></div>
        <div class="card-body"><div class="list" id="healthList"></div></div>
      </div>
    </section>

    <section class="card" id="connector">
      <div class="card-head"><h3>ChatGPT connector setup</h3><span class="status-pill" id="connectorStatus">checking</span></div>
      <div class="card-body connector-grid">
        <div class="setup-steps">
          <div class="step"><span class="step-num">1</span><div>Run <code>npm run oneclick -- --public-url https://your-domain.example.com</code>.</div></div>
          <div class="step"><span class="step-num">2</span><div>Use the printed <code>/mcp/&lt;secret&gt;</code> URL for ChatGPT Developer Mode.</div></div>
          <div class="step"><span class="step-num">3</span><div>Set ChatGPT authentication to <strong>No Authentication</strong>. Do not add a bearer token in ChatGPT.</div></div>
          <div class="step"><span class="step-num">4</span><div>Keep the bearer token only for local/API dashboard clients that need it.</div></div>
        </div>
        <pre class="copy-box" id="connectorBox">Loading connector profile…</pre>
      </div>
    </section>

    <section class="columns-2" id="diagnostics">
      <div class="card">
        <div class="card-head"><h3>Session diff</h3><span class="section-action">safe read-only endpoint</span></div>
        <div class="card-body utility-grid">
          <div class="field-row"><input id="workspace" placeholder="workspace alias" value=""></div>
          <div class="field-row"><input id="sessionId" placeholder="session id"><button onclick="loadDiff()">Load diff</button></div>
        </div>
        <div class="card-body diff-panel"><pre id="diffOut">No diff loaded.</pre></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Maintenance views</h3><span class="section-action">no write actions</span></div>
        <div class="card-body">
          <div class="setup-steps">
            <button class="secondary" onclick="loadHealth()">Load health monitor</button>
            <button class="secondary" onclick="loadReadiness()">Load readiness</button>
            <button class="secondary" onclick="loadLogs()">Load audit tail</button>
          </div>
        </div>
        <div class="card-body diff-panel"><pre id="maintenanceOut">Choose a diagnostic view.</pre></div>
      </div>
    </section>

    <section class="raw-panel" id="rawPanel">
      <div class="card">
        <div class="card-head"><h3>Raw dashboard payload</h3><button class="secondary" onclick="toggleRaw()">Close</button></div>
        <div class="card-body"><pre id="rawOut">No data yet.</pre></div>
      </div>
    </section>
  </main>
</div>
<script type="application/json" id="initialDashboardData">${initialDashboardJson}</script>
<script>
let lastData=null;
let eventSource=null;
let autoTimer=null;
const queryParams=new URLSearchParams(location.search);
const urlToken=queryParams.get('token')||sessionStorage.getItem('relai_dashboard_token')||'';
if(urlToken)document.getElementById('token').value=urlToken;
const AGENTS=[['Planner','Plans tasks','♙'],['Implementer','Applies changes','⌘'],['Tester','Runs checks','✓'],['Reviewer','Reviews diffs','◆'],['CI Repair','Watches checks','◈'],['Docs','Updates notes','✎'],['Security','Flags risk','▰']];
function currentToken(){const el=document.getElementById('token');const token=el?el.value.trim():'';if(token)sessionStorage.setItem('relai_dashboard_token',token);return token}
function headers(){const token=currentToken();return token?{Authorization:'Bearer '+token}:{}}
function withToken(url){const token=currentToken();if(!token)return url;const u=new URL(url,location.origin);if(u.origin===location.origin&&!u.searchParams.has('token'))u.searchParams.set('token',token);return u.pathname+u.search+u.hash}
async function fetchJson(url){
  let timeout=null;
  const controller=typeof AbortController!=='undefined'?new AbortController():null;
  try{
    if(controller)timeout=setTimeout(function(){controller.abort()},8000);
    const opts={headers:headers()};
    if(controller)opts.signal=controller.signal;
    const res=await fetch(withToken(url),opts);
    const text=await res.text();
    let data;
    try{data=JSON.parse(text)}catch(_){data={ok:false,error:text,status:res.status}}
    if(!res.ok&&data.ok!==true)data.ok=false;
    if(res.status===401)data.error=data.error||'Unauthorized. Paste the dashboard token or open /dashboard?token=<token>.';
    return data;
  }catch(error){
    const isAbort=error&&error.name==='AbortError';
    return {ok:false,error:isAbort?'Dashboard API request timed out after 8 seconds. Check that the server is still running and that the dashboard token is correct.':String(error)};
  }finally{
    if(timeout)clearTimeout(timeout);
  }
}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function cls(value){const s=String(value==null?'':value).toLowerCase();if(s.includes('fail')||s.includes('error')||s.includes('denied')||s.includes('blocked')||s==='false')return 'bad';if(s.includes('pending')||s.includes('run')||s.includes('warn')||s.includes('wait')||s.includes('active'))return 'warn';return 'ok'}
function dot(value){const c=cls(value);return '<span class="dot '+(c==='ok'?'':c)+'"></span>'}
function statusPill(value){const c=cls(value);return '<span class="status-pill '+c+'">'+esc(String(value||'ok'))+'</span>'}
function short(value){const s=String(value||'');return s.length>28?s.slice(0,14)+'…'+s.slice(-7):s}
function timeAgo(value){const raw=value||'';const ts=Date.parse(raw);if(!Number.isFinite(ts))return raw?String(raw):'';const diff=Math.max(0,Date.now()-ts);const m=Math.floor(diff/60000);if(m<1)return 'now';if(m<60)return m+'m ago';const h=Math.floor(m/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago'}
function metric(label,value,meta,type){return '<div class="metric '+(type||'')+'"><div class="metric-label">'+esc(label)+'</div><div class="metric-value">'+esc(value)+'</div><div class="metric-meta">'+esc(meta||'')+'</div></div>'}
function empty(message){return '<div class="empty">'+esc(message)+'</div>'}
function item(title,sub,time,state){return '<div class="list-item">'+dot(state||'ok')+'<div><div class="item-title">'+esc(title)+'</div><div class="item-sub">'+esc(sub||'')+'</div></div><div class="item-time">'+esc(time||'')+'</div></div>'}
function rowsEmpty(colspan,message){return '<tr><td colspan="'+colspan+'"><div class="empty">'+esc(message)+'</div></td></tr>'}
function render(data){
  lastData=data||{};
  const ok=Boolean(data&&data.ok);
  document.getElementById('serverStatus').className='status-pill '+(ok?'ok':'bad');
  document.getElementById('serverStatus').textContent=ok?'Online':'Error';
  document.getElementById('subtitle').textContent=ok?'Rel.AI MCP '+(data.config&&data.config.permissionProfile?('· '+data.config.permissionProfile+' profile'):''):'Could not load dashboard data';
  document.getElementById('lastUpdated').textContent='Updated '+new Date().toLocaleTimeString();
  const cfg=data.config||{};
  const counts=data.counts||{};
  const sessions=Array.isArray(data.sessions)?data.sessions:[];
  const jobs=Array.isArray(data.jobs)?data.jobs:[];
  const approvals=Array.isArray(data.approvals)?data.approvals:[];
  const locks=Array.isArray(data.locks)?data.locks:[];
  const health=data.health||{};
  const findings=Array.isArray(health.findings)?health.findings:[];
  const audit=(data.auditTail&&Array.isArray(data.auditTail.entries))?data.auditTail.entries:[];
  const subtasks=(data.multiAgent&&Array.isArray(data.multiAgent.subtasks))?data.multiAgent.subtasks:[];
  const readiness=data.readiness||{};
  const activeSessions=sessions.filter(function(x){return !['completed','closed','cancelled','failed'].includes(String(x.status||'').toLowerCase())}).length;
  const runningJobs=jobs.filter(function(x){return ['running','cancelling','queued'].includes(String(x.status||'').toLowerCase())}).length;
  const openApprovals=approvals.filter(function(x){return !['approved','denied','resolved','cancelled'].includes(String(x.status||'').toLowerCase())}).length;
  document.getElementById('metrics').innerHTML=
    metric('Sessions',counts.sessions||sessions.length,activeSessions+' active','blue')+
    metric('Jobs',counts.jobs||jobs.length,runningJobs+' running','warn')+
    metric('Approvals',counts.approvals||approvals.length,openApprovals+' open',openApprovals?'warn':'purple')+
    metric('Locks',counts.locks||locks.length,'cooperative locks','blue')+
    metric('Health',findings.length,health.ok===false?'needs attention':'all clear',health.ok===false?'bad':'good')+
    metric('Readiness',readiness.score!=null?readiness.score:'—',readiness.ok===false?'review needed':'release check',readiness.ok===false?'warn':'good');
  renderConfig(cfg,data);
  renderWorkspaces(cfg,health);
  renderActivity(audit);
  renderLists(sessions,jobs,approvals,findings);
  renderAgents(subtasks,jobs,approvals,health);
  renderTerminal(data,audit,jobs,subtasks,findings);
  document.getElementById('rawOut').textContent=JSON.stringify(data,null,2);
}
function renderConfig(cfg,data){
  const profile=cfg.permissionProfile||'unknown';
  const pill=document.getElementById('profilePill');
  pill.className='status-pill '+(profile==='admin'?'warn':'ok');
  pill.textContent=profile+' profile';
  const configItems=[
    ['State dir',cfg.stateDir||'not reported','ok'],
    ['Dashboard',cfg.dashboardEnabled===false?'disabled':'enabled',cfg.dashboardEnabled===false?'bad':'ok'],
    ['Arbitrary commands',cfg.allowArbitraryCommands?'enabled':'disabled',cfg.allowArbitraryCommands?'warn':'ok'],
    ['Docker',cfg.allowDocker?'enabled':'disabled',cfg.allowDocker?'warn':'ok'],
    ['GitHub CLI',cfg.allowGitHubCli?'enabled':'disabled',cfg.allowGitHubCli?'warn':'ok'],
    ['Multi-agent',cfg.multiAgent&&cfg.multiAgent.enabled?'enabled':'disabled',cfg.multiAgent&&cfg.multiAgent.enabled?'ok':'warn']
  ];
  document.getElementById('configList').innerHTML=configItems.map(function(x){return item(x[0],x[1],'',x[2])}).join('')||empty('No configuration summary available.');
}
function renderWorkspaces(cfg,health){
  const workspaces=Array.isArray(cfg.workspaces)?cfg.workspaces:[];
  const healthWorkspaces=Array.isArray(health.workspaces)?health.workspaces:[];
  document.getElementById('workspaceCount').textContent=workspaces.length+' configured';
  if(workspaces[0]&&!document.getElementById('workspace').value)document.getElementById('workspace').value=workspaces[0].alias||'';
  document.getElementById('workspacesList').innerHTML=workspaces.map(function(w){
    const h=healthWorkspaces.find(function(x){return x.alias===w.alias})||{};
    const badges=[];
    badges.push('<span class="badge '+(h.ok===false?'warn':'good')+'">'+(h.ok===false?'check':'healthy')+'</span>');
    badges.push('<span class="badge">base '+esc(w.defaultBaseBranch||'main')+'</span>');
    badges.push('<span class="badge">tests '+esc((w.testCommandKeys||[]).length)+'</span>');
    if(h.worktreeCount!=null)badges.push('<span class="badge">worktrees '+esc(h.worktreeCount)+'</span>');
    return '<div class="workspace-card"><strong>'+esc(w.alias||'workspace')+'</strong><div class="path">'+esc(w.path||'')+'</div><div class="badge-row">'+badges.join('')+'</div></div>';
  }).join('')||empty('No workspaces configured.');
}
function renderActivity(audit){
  document.getElementById('activityCount').textContent=audit.length+' events';
  document.getElementById('activityRows').innerHTML=audit.slice(0,12).map(function(x){
    const ok=x.ok===false?'failed':'ok';
    const message=x.error||x.message||x.path||'';
    return '<tr><td class="nowrap">'+esc(timeAgo(x.ts||x.at||x.createdAt||x.timestamp))+'</td><td class="truncate mono">'+esc(x.tool||x.type||x.event||'activity')+'</td><td class="truncate">'+esc(x.workspace||'—')+'</td><td>'+statusPill(ok)+'</td><td class="truncate">'+esc(message)+'</td></tr>';
  }).join('')||rowsEmpty(5,'No audit events yet.');
}
function renderLists(sessions,jobs,approvals,findings){
  document.getElementById('sessionCount').textContent=String(sessions.length);
  document.getElementById('jobCount').textContent=String(jobs.length);
  document.getElementById('approvalCount').textContent=String(approvals.length);
  document.getElementById('findingCount').textContent=String(findings.length);
  document.getElementById('sessionsList').innerHTML=sessions.slice(0,8).map(function(x){return item(short(x.id),String(x.workspace||'workspace')+' · '+String(x.status||'unknown'),timeAgo(x.updatedAt||x.createdAt),x.status)}).join('')||empty('No task sessions yet.');
  document.getElementById('jobsList').innerHTML=jobs.slice(0,8).map(function(x){return item(short(x.id),String(x.workspace||'workspace')+' · '+String(x.commandKey||x.command||'command'),timeAgo(x.updatedAt||x.startedAt||x.createdAt),x.status)}).join('')||empty('No background jobs.');
  document.getElementById('approvalsList').innerHTML=approvals.slice(0,8).map(function(x){return item(short(x.id),String(x.action||'approval')+' · '+String(x.status||'pending'),timeAgo(x.updatedAt||x.createdAt),x.status||'pending')}).join('')||empty('No pending approvals.');
  document.getElementById('healthList').innerHTML=findings.slice(0,8).map(function(x){return item(x.code||x.severity||'finding',x.message||'', '',x.severity||'warn')}).join('')||empty('No health findings.');
}
function renderAgents(subtasks,jobs,approvals,health){
  const html=AGENTS.map(function(role){
    const label=role[0], fallback=role[1], icon=role[2];
    const match=subtasks.find(function(x){return String(x.role||'').toLowerCase().includes(label.toLowerCase().split(' ')[0])});
    let state=match?String(match.status||fallback):fallback;
    if(label==='Tester'&&jobs.some(function(x){return String(x.commandKey||x.command||'').toLowerCase().includes('test')}))state='Running tests';
    if(label==='Reviewer'&&approvals.length)state='Reviewing gates';
    if(label==='Security'&&health&&health.ok===false)state='Needs attention';
    return '<div class="agent"><div class="agent-top"><span class="agent-icon">'+esc(icon)+'</span>'+statusPill(state)+'</div><div class="agent-name">'+esc(label)+'</div><div class="agent-state">'+esc(state)+'</div></div>';
  }).join('');
  document.getElementById('agentCount').textContent=AGENTS.length+' roles';
  document.getElementById('agentGrid').innerHTML=html;
}
function renderTerminal(data,audit,jobs,subtasks,findings){
  const lines=[];
  lines.push('<span class="prompt">$</span> relai dashboard');
  if(data&&data.ok)lines.push('<span class="ok">✓</span> server responded'); else lines.push('<span class="bad">✕</span> '+esc(data&&data.error?data.error:'failed to load'));
  lines.push('<span class="ok">✓</span> sessions '+esc((data.sessions||[]).length)+', jobs '+esc((data.jobs||[]).length)+', approvals '+esc((data.approvals||[]).length));
  if(subtasks.length)lines.push('<span class="ok">✓</span> subtasks tracked: '+esc(subtasks.length));
  if(findings.length)lines.push('<span class="warn">!</span> health findings: '+esc(findings.length)); else lines.push('<span class="ok">✓</span> health findings: 0');
  if(audit[0])lines.push('<span class="prompt">›</span> latest '+esc(audit[0].tool||'activity')+' '+esc(timeAgo(audit[0].ts||audit[0].at||audit[0].createdAt)));
  document.getElementById('terminal').innerHTML=lines.join('<br>');
}
async function refresh(){render(await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0'))}
async function loadConnection(){
  const payload=await fetchJson('/api/connection');
  const status=document.getElementById('connectorStatus');
  status.className='status-pill '+(payload&&payload.permanentUrlConfigured?'ok':'warn');
  status.textContent=payload&&payload.permanentUrlConfigured?'permanent URL':'local only';
  const lines=[];
  lines.push('Dashboard: '+(payload.dashboardUrl||''));
  lines.push('ChatGPT MCP URL: '+(payload.chatgptMcpUrl||''));
  lines.push('ChatGPT auth: No Authentication');
  lines.push('Health: '+(payload.chatgptHealthUrl||''));
  lines.push('Profile: '+(payload.profileFile||''));
  lines.push('Token file: '+(payload.tokenFile||''));
  lines.push('');
  lines.push(payload.permanentUrlConfigured?'Stable public URL is configured.':'No stable public URL configured yet.');
  document.getElementById('connectorBox').textContent=lines.join('\n');
}
async function loadHealth(){document.getElementById('maintenanceOut').textContent=JSON.stringify(await fetchJson('/api/health-monitor'),null,2)}
async function loadReadiness(){document.getElementById('maintenanceOut').textContent=JSON.stringify(await fetchJson('/api/readiness?requireHttpToken=0'),null,2)}
async function loadLogs(){document.getElementById('maintenanceOut').textContent=JSON.stringify(await fetchJson('/api/logs?limit=100'),null,2)}
async function loadDiff(){const w=document.getElementById('workspace').value.trim();const s=document.getElementById('sessionId').value.trim();document.getElementById('diffOut').textContent=JSON.stringify(await fetchJson('/api/session/diff?workspace='+encodeURIComponent(w)+'&sessionId='+encodeURIComponent(s)),null,2)}
function toggleRaw(){document.getElementById('rawPanel').classList.toggle('open');if(lastData)document.getElementById('rawOut').textContent=JSON.stringify(lastData,null,2)}
function toggleLive(){
  const btn=document.getElementById('liveBtn');
  if(eventSource){eventSource.close();eventSource=null;btn.textContent='Start live';if(autoTimer){clearInterval(autoTimer);autoTimer=null}return}
  const token=currentToken();
  eventSource=new EventSource(withToken('/events'));
  eventSource.addEventListener('dashboard',function(e){try{render(JSON.parse(e.data))}catch(_){}});
  eventSource.addEventListener('error',function(){document.getElementById('serverStatus').className='status-pill bad';document.getElementById('serverStatus').textContent='Live error'});
  autoTimer=setInterval(refresh,15000);
  btn.textContent='Stop live';
}
function initialDashboardPayload(){
  try{
    const el=document.getElementById('initialDashboardData');
    return el&&el.textContent?JSON.parse(el.textContent):null;
  }catch(error){
    return {ok:false,error:'Initial dashboard payload could not be parsed: '+String(error)};
  }
}
async function boot(){
  const initial=initialDashboardPayload();
  if(initial)render(initial);
  const refreshed=await refresh();
  await loadConnection();
  if(refreshed&&refreshed.ok){
    const status=document.getElementById('serverStatus');
    status.className='status-pill ok';
    status.textContent='Online';
  }
}
boot();
</script>
</body>
</html>`;
}

module.exports = {
  startHttpServer,
  handleJsonRpcPayload
};
