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

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;
const sessions = new Map();

function startHttpServer(options = {}) {
  const host = options.host || process.env.REL_AI_MCP_HOST || "127.0.0.1";
  const port = Number(options.port ?? process.env.REL_AI_MCP_PORT ?? 3333);
  const token = options.token || process.env.REL_AI_MCP_TOKEN || "";
  const allowNoAuth = Boolean(options.allowNoAuth || process.env.REL_AI_MCP_ALLOW_NO_AUTH === "1");
  const maxBodyBytes = Number(options.maxBodyBytes || process.env.REL_AI_MCP_MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);

  if (!token && !allowNoAuth) {
    throw new Error("REL_AI_MCP_TOKEN is required for the HTTP/SSE server. Set a strong token, or set REL_AI_MCP_ALLOW_NO_AUTH=1 for local-only testing.");
  }

  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, { token, allowNoAuth, maxBodyBytes });
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

  if (req.method === "POST" && parsed.pathname === "/mcp") {
    if (!isAuthorized(req, options)) return unauthorized(res);
    const payload = await readJsonBody(req, options.maxBodyBytes);
    const response = await handleJsonRpcPayload(payload);
    if (response === null) {
      sendJson(res, 202, { ok: true, accepted: true });
      return;
    }
    sendJson(res, 200, response);
    return;
  }

  if (req.method === "GET" && parsed.pathname === "/sse") {
    if (!isAuthorized(req, options)) return unauthorized(res);
    openSseSession(res, req);
    return;
  }

  if (req.method === "POST" && parsed.pathname === "/messages") {
    if (!isAuthorized(req, options)) return unauthorized(res);
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
      streamableHttp: "POST /mcp",
      sse: "GET /sse then POST /messages?sessionId=..."
    }
  });
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

function openSseSession(res, req) {
  const sessionId = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const session = { id: sessionId, res, createdAt: new Date().toISOString() };
  sessions.set(sessionId, session);

  sendSse(res, "endpoint", `/messages?sessionId=${encodeURIComponent(sessionId)}`);
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

function renderDashboardHtml(options) {
  const hasToken = Boolean(options.token);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rel.AI MCP Dashboard</title>
<style>
:root{
  color-scheme:dark;
  --bg:#020611;
  --bg-soft:#060b18;
  --panel:#0b1222;
  --panel-2:#0e1729;
  --panel-3:#101b31;
  --line:#1e3150;
  --line-soft:rgba(107,139,255,.18);
  --text:#f7fbff;
  --muted:#92a4bc;
  --muted-2:#61718a;
  --blue:#35a3ff;
  --blue-2:#5f7cff;
  --purple:#9b4dff;
  --cyan:#49d9ff;
  --green:#3ee883;
  --amber:#ffb83d;
  --red:#ff6680;
  --shadow:0 24px 80px rgba(0,0,0,.48);
  --radius:18px;
  --radius-sm:12px;
  --sidebar:246px;
}
*{box-sizing:border-box}
html{min-height:100%;background:var(--bg)}
body{
  min-height:100%;margin:0;color:var(--text);
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  background:
    radial-gradient(circle at 9% 7%,rgba(111,76,255,.23),transparent 24rem),
    radial-gradient(circle at 92% 14%,rgba(42,151,255,.16),transparent 26rem),
    radial-gradient(circle at 56% 120%,rgba(49,114,255,.14),transparent 30rem),
    linear-gradient(180deg,#020611 0%,#040816 48%,#020611 100%);
}
button,input{font:inherit}
button{
  min-height:40px;border:1px solid rgba(77,123,255,.35);border-radius:12px;
  padding:0 14px;color:var(--text);cursor:pointer;
  background:linear-gradient(180deg,rgba(53,163,255,.18),rgba(95,124,255,.1));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
}
button:hover{border-color:rgba(73,217,255,.55);background:linear-gradient(180deg,rgba(53,163,255,.25),rgba(155,77,255,.16))}
input{
  min-height:40px;border:1px solid rgba(77,123,255,.24);border-radius:12px;
  padding:0 12px;color:var(--text);background:#070d1a;outline:none;
}
input:focus{border-color:rgba(73,217,255,.65);box-shadow:0 0 0 3px rgba(73,217,255,.09)}
a{color:var(--cyan)}
.shell{display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);min-height:100vh;padding:24px;gap:24px}
.sidebar{
  position:sticky;top:24px;height:calc(100vh - 48px);padding:18px 14px;
  border:1px solid rgba(86,132,255,.22);border-radius:22px;background:rgba(6,11,24,.86);
  box-shadow:var(--shadow);backdrop-filter:blur(18px);overflow:auto;
}
.brand{display:flex;align-items:center;gap:12px;padding:2px 8px 18px;border-bottom:1px solid rgba(86,132,255,.14)}
.logo{
  width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:900;font-size:22px;
  background:linear-gradient(135deg,var(--blue),var(--purple));box-shadow:0 0 22px rgba(95,124,255,.42);
}
.brand-title{font-weight:800;letter-spacing:-.02em}.brand-subtitle{font-size:12px;color:var(--muted);margin-top:2px}
.nav{display:grid;gap:6px;padding:18px 0}.nav-item{
  display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:12px;color:#c9d6ea;font-size:14px;
  border:1px solid transparent;
}
.nav-item.active{background:linear-gradient(135deg,#2367dd,#2b5ccf);color:#fff;box-shadow:0 12px 28px rgba(35,103,221,.25)}
.nav-item:not(.active):hover{background:rgba(53,163,255,.07);border-color:rgba(77,123,255,.18)}
.nav-icon{width:18px;text-align:center;color:#91a7ff}.nav-spacer{height:8px}.sidebar-footer{margin-top:auto;padding:14px 10px;border-top:1px solid rgba(86,132,255,.14);color:var(--muted);font-size:12px;line-height:1.5}
.app{min-width:0}.topbar{
  display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px;padding:14px 16px;
  border:1px solid rgba(86,132,255,.2);border-radius:22px;background:rgba(6,11,24,.66);backdrop-filter:blur(18px);
  box-shadow:0 18px 60px rgba(0,0,0,.28);
}
.top-title{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.01em}.home-dot{color:#8fb4ff}.server-state{display:flex;align-items:center;gap:8px;color:#cbd7ea;font-size:13px;white-space:nowrap}.server-state:before{content:"";width:8px;height:8px;border-radius:99px;background:var(--green);box-shadow:0 0 14px rgba(62,232,131,.85)}
.controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}.controls input{width:210px}.controls .short{width:148px}.content{display:grid;gap:20px}.hero-panel{
  display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.72fr);gap:20px;align-items:stretch;
  padding:22px;border:1px solid rgba(86,132,255,.22);border-radius:26px;background:
    linear-gradient(135deg,rgba(12,22,41,.92),rgba(6,10,24,.88)),
    radial-gradient(circle at top right,rgba(155,77,255,.24),transparent 20rem);
  box-shadow:var(--shadow);overflow:hidden;
}
.eyebrow{margin:0 0 10px;color:#71c7ff;text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:800}.hero-copy h1{margin:0;max-width:760px;font-size:clamp(30px,4vw,56px);line-height:.98;letter-spacing:-.055em}.gradient-text{background:linear-gradient(90deg,#fff 0%,#7aa7ff 52%,#a955ff 100%);-webkit-background-clip:text;background-clip:text;color:transparent}.hero-copy p{max-width:720px;margin:18px 0 0;color:#b9c7d9;font-size:16px;line-height:1.65}.chips{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.chip{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 13px;border:1px solid rgba(53,163,255,.34);border-radius:999px;background:rgba(8,15,30,.64);color:#eaf2ff;font-size:13px}.chip.ok:before{content:"✓";color:var(--green)}.chip.lock:before{content:"▣";color:var(--cyan)}.chip.bolt:before{content:"✦";color:var(--amber)}
.terminal-card{display:flex;flex-direction:column;min-height:216px;border:1px solid rgba(86,132,255,.22);border-radius:18px;background:#060b15;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.terminal-top{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;border-bottom:1px solid rgba(86,132,255,.16);color:#9db1c9;font-size:12px}.terminal-dots{display:flex;gap:6px}.terminal-dots span{width:8px;height:8px;border-radius:50%;background:#263850}.terminal-body{padding:14px;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#dce7ff;overflow:auto}.terminal-body .prompt{color:var(--green)}.terminal-body .accent{color:#9b77ff}.terminal-body .ok{color:var(--green)}
.stats-grid{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:14px}.stat-card{
  min-height:112px;padding:18px 18px 16px;border:1px solid rgba(86,132,255,.18);border-radius:18px;
  background:linear-gradient(180deg,rgba(15,26,48,.92),rgba(9,16,31,.92));box-shadow:0 18px 42px rgba(0,0,0,.2);
}
.stat-label{color:#aab9cc;font-size:13px;font-weight:700}.stat-value{margin-top:10px;font-size:34px;line-height:1;font-weight:900;letter-spacing:-.04em}.stat-meta{margin-top:8px;color:var(--muted);font-size:12px}.stat-blue{color:#5ab4ff}.stat-amber{color:var(--amber)}.stat-purple{color:#b374ff}.stat-green{color:var(--green)}.stat-red{color:var(--red)}
.dashboard-grid{display:grid;grid-template-columns:minmax(0,1.36fr) minmax(320px,.64fr);gap:20px}.panel{
  min-width:0;border:1px solid rgba(86,132,255,.2);border-radius:20px;background:rgba(10,18,33,.88);box-shadow:0 18px 46px rgba(0,0,0,.22);overflow:hidden;
}
.panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 18px;border-bottom:1px solid rgba(86,132,255,.14)}
.panel-title{margin:0;font-size:16px;letter-spacing:-.01em}.panel-action{color:#8ea4bd;font-size:12px}.panel-body{padding:14px}.list{display:grid;gap:10px}.item{
  display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px;border:1px solid rgba(86,132,255,.14);border-radius:14px;background:rgba(4,9,19,.54);
}
.item-dot{width:9px;height:9px;border-radius:99px;background:var(--green);box-shadow:0 0 12px rgba(62,232,131,.65)}.item-dot.warn{background:var(--amber);box-shadow:0 0 12px rgba(255,184,61,.55)}.item-dot.bad{background:var(--red);box-shadow:0 0 12px rgba(255,102,128,.55)}
.item-main{min-width:0}.item-title{font-size:13px;color:#eef5ff;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-sub{margin-top:3px;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item-time{color:var(--muted-2);font-size:12px;white-space:nowrap}
.agent-list{display:grid;gap:9px}.agent-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:10px;padding:10px 11px;border-radius:13px;background:rgba(4,9,19,.45);border:1px solid rgba(86,132,255,.12)}.agent-icon{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,rgba(53,163,255,.28),rgba(155,77,255,.24));font-size:14px}.agent-name{font-size:13px;font-weight:750}.agent-status{font-size:12px;color:var(--muted);margin-top:2px}.status-pill{font-size:11px;padding:4px 8px;border-radius:999px;border:1px solid rgba(86,132,255,.2);color:#b8c7dd;background:#07101e}.status-pill.ok{color:var(--green);border-color:rgba(62,232,131,.28);background:rgba(62,232,131,.08)}.status-pill.warn{color:var(--amber);border-color:rgba(255,184,61,.28);background:rgba(255,184,61,.08)}
.three-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.empty{padding:18px;border:1px dashed rgba(86,132,255,.25);border-radius:14px;color:var(--muted);text-align:center;font-size:13px;background:rgba(5,10,20,.38)}
.ops-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.code-box{margin:0;min-height:220px;max-height:440px;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:16px;border:1px solid rgba(86,132,255,.18);border-radius:16px;background:#030813;color:#dce7ff;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.raw-panel{display:none}.raw-panel.open{display:block}
.mobile-tabs{display:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:1180px){.shell{grid-template-columns:1fr}.sidebar{display:none}.topbar{align-items:flex-start;flex-direction:column}.controls{justify-content:flex-start}.hero-panel{grid-template-columns:1fr}.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dashboard-grid,.three-grid,.ops-grid{grid-template-columns:1fr}.mobile-tabs{display:flex}}
@media (max-width:680px){.shell{padding:12px;gap:12px}.topbar,.hero-panel{border-radius:18px}.hero-panel{padding:16px}.controls{width:100%}.controls input,.controls .short,.controls button{width:100%}.stats-grid{grid-template-columns:1fr}.item{grid-template-columns:auto minmax(0,1fr)}.item-time{grid-column:2}.hero-copy h1{font-size:34px}}
</style>
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">R</div>
      <div><div class="brand-title">Rel.AI MCP</div><div class="brand-subtitle">local coding team</div></div>
    </div>
    <nav class="nav" aria-label="Dashboard navigation">
      <div class="nav-item active"><span class="nav-icon">⌂</span>Overview</div>
      <div class="nav-item"><span class="nav-icon">▣</span>Sessions</div>
      <div class="nav-item"><span class="nav-icon">☑</span>Tasks</div>
      <div class="nav-item"><span class="nav-icon">♙</span>Agents</div>
      <div class="nav-item"><span class="nav-icon">▤</span>Workspaces</div>
      <div class="nav-item"><span class="nav-icon">⑂</span>PRs</div>
      <div class="nav-item"><span class="nav-icon">▦</span>Logs</div>
      <div class="nav-spacer"></div>
      <div class="nav-item"><span class="nav-icon">⚙</span>Settings</div>
    </nav>
    <div class="sidebar-footer">100% local by default. Approval gates, snapshots, rollback, and policy checks stay visible while agents work.</div>
  </aside>
  <div class="app">
    <header class="topbar">
      <div>
        <div class="top-title"><span class="home-dot">⌂</span>Dashboard</div>
        <div class="server-state" id="status">Server pending</div>
      </div>
      <div class="controls" aria-label="Dashboard controls">
        <label class="sr-only" for="token">Bearer token</label>
        <input id="token" type="password" autocomplete="off" placeholder="Bearer token${hasToken ? "" : " not required"}">
        <button onclick="refresh()">Refresh</button>
        <button onclick="toggleLive()" id="liveBtn">Start live</button>
        <button onclick="loadHealth()">Health</button>
        <button onclick="toggleRaw()" id="rawBtn">Raw</button>
        <input class="short" id="workspace" placeholder="workspace">
        <input class="short" id="sessionId" placeholder="sessionId">
        <button onclick="loadDiff()">Load diff</button>
      </div>
    </header>
    <main class="content">
      <section class="hero-panel">
        <div class="hero-copy">
          <p class="eyebrow">Overview</p>
          <h1>Run your <span class="gradient-text">local AI coding team</span> from one console.</h1>
          <p>Track sessions, tasks, approvals, health, logs, and agent activity without leaving the browser. The layout mirrors the hero: compact cards, clear status, and operational panels with consistent padding.</p>
          <div class="chips">
            <span class="chip ok">100% Local</span>
            <span class="chip lock">Private & Secure</span>
            <span class="chip bolt">MCP Compatible</span>
            <span class="chip">130+ Tools</span>
          </div>
        </div>
        <div class="terminal-card">
          <div class="terminal-top"><span>rel-ai-mcp</span><div class="terminal-dots"><span></span><span></span><span></span></div></div>
          <div class="terminal-body" id="terminal">$ relai dashboard --live<br><span class="ok">✓</span> Waiting for dashboard data...</div>
        </div>
      </section>
      <section class="stats-grid" id="summary"></section>
      <section class="dashboard-grid">
        <div class="panel">
          <div class="panel-head"><h2 class="panel-title">Recent Activity</h2><span class="panel-action" id="activityCount">0 events</span></div>
          <div class="panel-body"><div class="list" id="activity"></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2 class="panel-title">Agent Team</h2><span class="panel-action" id="agentCount">7 roles</span></div>
          <div class="panel-body"><div class="agent-list" id="agents"></div></div>
        </div>
      </section>
      <section class="three-grid">
        <div class="panel"><div class="panel-head"><h2 class="panel-title">Sessions</h2><span class="panel-action" id="sessionCount">0</span></div><div class="panel-body"><div class="list" id="sessions"></div></div></div>
        <div class="panel"><div class="panel-head"><h2 class="panel-title">Tasks</h2><span class="panel-action" id="jobCount">0</span></div><div class="panel-body"><div class="list" id="jobs"></div></div></div>
        <div class="panel"><div class="panel-head"><h2 class="panel-title">Approvals</h2><span class="panel-action" id="approvalCount">0</span></div><div class="panel-body"><div class="list" id="approvals"></div></div></div>
      </section>
      <section class="ops-grid">
        <div class="panel"><div class="panel-head"><h2 class="panel-title">Health Findings</h2><span class="panel-action" id="healthCount">0</span></div><div class="panel-body"><div class="list" id="health"></div></div></div>
        <div class="panel"><div class="panel-head"><h2 class="panel-title">Diff Viewer</h2><span class="panel-action">workspace + session</span></div><div class="panel-body"><pre class="code-box" id="diff">Enter workspace/sessionId and click Load diff.</pre></div></div>
      </section>
      <section class="panel raw-panel" id="rawPanel"><div class="panel-head"><h2 class="panel-title">Raw Dashboard Data</h2><span class="panel-action">debug</span></div><div class="panel-body"><pre class="code-box" id="raw">Click Refresh.</pre></div></section>
    </main>
  </div>
</div>
<script>
let eventSource=null;
let lastData=null;
const AGENT_ROLES=[
  ['Planner','Planning','♙'],['Coder','Implementing','⌘'],['Reviewer','Reviewing','◆'],['Tester','Running tests','✓'],['CI Engineer','Monitoring','◈'],['Docs Writer','Writing docs','✎'],['Security Guard','Scanning','▰']
];
function headers(){const t=document.getElementById('token').value;return t?{Authorization:'Bearer '+t}:{}}
async function fetchJson(url){const res=await fetch(url,{headers:headers()});const text=await res.text();try{return JSON.parse(text)}catch(e){return {ok:false,error:text,status:res.status}}}
function esc(value){return String(value??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function statusClass(value){const s=String(value||'').toLowerCase();if(s.includes('fail')||s.includes('error')||s.includes('denied'))return 'bad';if(s.includes('run')||s.includes('pending')||s.includes('wait')||s.includes('cancel'))return 'warn';return 'ok'}
function shortId(value){const s=String(value||'');return s.length>24?s.slice(0,12)+'...'+s.slice(-6):s}
function timeAgo(value){const ts=Date.parse(value||'');if(!Number.isFinite(ts))return '';const diff=Math.max(0,Date.now()-ts);const mins=Math.floor(diff/60000);if(mins<1)return 'now';if(mins<60)return mins+'m ago';const hours=Math.floor(mins/60);if(hours<24)return hours+'h ago';return Math.floor(hours/24)+'d ago'}
function empty(message){return '<div class="empty">'+esc(message)+'</div>'}
function stat(label,value,meta,cls){return '<div class="stat-card"><div class="stat-label">'+esc(label)+'</div><div class="stat-value '+(cls||'')+'">'+esc(value)+'</div><div class="stat-meta">'+esc(meta||'')+'</div></div>'}
function listItem(title,sub,time,kind){return '<div class="item"><span class="item-dot '+(kind||'')+'"></span><div class="item-main"><div class="item-title">'+esc(title)+'</div><div class="item-sub">'+esc(sub||'')+'</div></div><div class="item-time">'+esc(time||'')+'</div></div>'}
function render(data){
  lastData=data||{};
  const ok=Boolean(data&&data.ok);
  document.getElementById('status').textContent=ok?'Server Online':'Server Error';
  const c=data.counts||{};
  const sessions=data.sessions||[];
  const jobs=data.jobs||[];
  const approvals=data.approvals||[];
  const locks=data.locks||[];
  const health=data.health||{};
  const audit=(data.auditTail&&data.auditTail.entries)||[];
  const subtasks=(data.multiAgent&&data.multiAgent.subtasks)||[];
  const runningJobs=jobs.filter(function(x){return ['running','cancelling'].includes(String(x.status||'').toLowerCase())}).length;
  const activeSessions=sessions.filter(function(x){return !['completed','closed','cancelled','failed'].includes(String(x.status||'').toLowerCase())}).length;
  const openApprovals=approvals.filter(function(x){return !['approved','denied','resolved'].includes(String(x.status||'').toLowerCase())}).length;
  const findings=(health.counts&&health.counts.findings)||0;
  document.getElementById('summary').innerHTML=
    stat('Sessions',c.sessions||0,activeSessions+' active','stat-blue')+
    stat('Tasks',c.jobs||0,runningJobs+' running','stat-amber')+
    stat('PR / Gates',approvals.length,openApprovals+' open','stat-purple')+
    stat('Agents',subtasks.length||AGENT_ROLES.length,(subtasks.length?'from subtasks':'ready'),'stat-green')+
    stat('Health',findings,health.ok===false?'needs attention':'all clear',health.ok===false?'stat-red':'stat-green');
  document.getElementById('activityCount').textContent=audit.length+' events';
  document.getElementById('sessionCount').textContent=String(sessions.length);
  document.getElementById('jobCount').textContent=String(jobs.length);
  document.getElementById('approvalCount').textContent=String(approvals.length);
  document.getElementById('healthCount').textContent=String(findings);
  document.getElementById('activity').innerHTML=audit.slice(0,8).map(function(x,index){
    const title=x.tool||x.type||x.event||x.action||('Activity #'+(index+1));
    const sub=x.workspace||x.sessionId||x.message||x.path||JSON.stringify(x).slice(0,120);
    return listItem(title,sub,timeAgo(x.at||x.createdAt||x.timestamp),statusClass(x.status||x.ok));
  }).join('')||empty('No recent activity yet. Start a task or enable live logs.');
  document.getElementById('sessions').innerHTML=sessions.slice(0,8).map(function(x){return listItem(shortId(x.id),String(x.status||'unknown')+' · '+String(x.workspace||'workspace'),timeAgo(x.updatedAt||x.createdAt),statusClass(x.status))}).join('')||empty('No sessions found.');
  document.getElementById('jobs').innerHTML=jobs.slice(0,8).map(function(x){return listItem(shortId(x.id),String(x.status||'unknown')+' · '+String(x.workspace||'workspace')+' · '+String(x.commandKey||x.command||''),timeAgo(x.updatedAt||x.startedAt||x.createdAt),statusClass(x.status))}).join('')||empty('No tasks are running.');
  document.getElementById('approvals').innerHTML=approvals.slice(0,8).map(function(x){return listItem(shortId(x.id),String(x.action||'approval')+' · '+String(x.status||'pending'),timeAgo(x.updatedAt||x.createdAt),statusClass(x.status||'pending'))}).join('')||empty('No approval gates pending.');
  document.getElementById('health').innerHTML=((health.findings)||[]).slice(0,8).map(function(x){return listItem(String(x.code||x.severity||'finding'),String(x.message||''),'',statusClass(x.severity))}).join('')||empty('No health findings.');
  renderAgents(subtasks,jobs,approvals,health);
  renderTerminal(data,audit,jobs,subtasks);
  document.getElementById('raw').textContent=JSON.stringify(data,null,2);
}
function renderAgents(subtasks,jobs,approvals,health){
  const rows=AGENT_ROLES.map(function(role){
    const name=role[0], fallback=role[1], icon=role[2];
    const item=subtasks.find(function(x){return String(x.role||'').toLowerCase().includes(name.toLowerCase().split(' ')[0])});
    let status=item?String(item.status||fallback):fallback;
    if(name==='Tester'&&jobs.some(function(x){return String(x.commandKey||x.command||'').toLowerCase().includes('test')}))status='Running tests';
    if(name==='Reviewer'&&approvals.length)status='Reviewing gates';
    if(name==='Security Guard'&&health&&health.ok===false)status='Needs attention';
    const cls=statusClass(status);
    return '<div class="agent-row"><div class="agent-icon">'+esc(icon)+'</div><div><div class="agent-name">'+esc(name)+'</div><div class="agent-status">'+esc(status)+'</div></div><span class="status-pill '+cls+'">'+(cls==='ok'?'online':cls==='warn'?'active':'check')+'</span></div>';
  });
  document.getElementById('agentCount').textContent=rows.length+' roles';
  document.getElementById('agents').innerHTML=rows.join('');
}
function renderTerminal(data,audit,jobs,subtasks){
  const lines=[];
  lines.push('<span class="prompt">$</span> relai dashboard --live');
  if(data&&data.ok)lines.push('<span class="ok">✓</span> Dashboard data loaded');
  else lines.push('<span class="accent">!</span> Waiting for server data');
  if(jobs.length)lines.push('<span class="ok">✓</span> '+jobs.length+' task record(s) found');
  if(subtasks.length)lines.push('<span class="ok">✓</span> '+subtasks.length+' agent subtask(s) tracked');
  if(audit.length){const latest=audit[0];lines.push('<span class="accent">›</span> '+esc(latest.tool||latest.type||latest.event||'recent activity')+' '+esc(timeAgo(latest.at||latest.createdAt||latest.timestamp)));}
  if(data&&data.readiness&&typeof data.readiness.score!=='undefined')lines.push('<span class="ok">✓</span> Release readiness score: '+esc(data.readiness.score));
  lines.push('<span class="accent">{ AI + YOU }</span> better together');
  document.getElementById('terminal').innerHTML=lines.join('<br>');
}
async function refresh(){render(await fetchJson('/api/dashboard/v10?limit=100&requireHttpToken=0'))}
async function loadHealth(){const payload=await fetchJson('/api/health-monitor');document.getElementById('rawPanel').classList.add('open');document.getElementById('raw').textContent=JSON.stringify(payload,null,2)}
async function loadDiff(){const w=document.getElementById('workspace').value;const s=document.getElementById('sessionId').value;document.getElementById('diff').textContent=JSON.stringify(await fetchJson('/api/session/diff?workspace='+encodeURIComponent(w)+'&sessionId='+encodeURIComponent(s)),null,2)}
function toggleLive(){if(eventSource){eventSource.close();eventSource=null;document.getElementById('liveBtn').textContent='Start live';return}const t=document.getElementById('token').value;eventSource=new EventSource('/events'+(t?'?token='+encodeURIComponent(t):''));eventSource.addEventListener('dashboard',function(e){try{render(JSON.parse(e.data))}catch(_){}});eventSource.addEventListener('error',function(){document.getElementById('status').textContent='Live stream error'});document.getElementById('liveBtn').textContent='Stop live'}
function toggleRaw(){const panel=document.getElementById('rawPanel');panel.classList.toggle('open');if(lastData)document.getElementById('raw').textContent=JSON.stringify(lastData,null,2)}
refresh();
</script>
</body>
</html>`;
}

module.exports = {
  startHttpServer,
  handleJsonRpcPayload
};
