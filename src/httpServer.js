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
      logsApi: "GET /api/logs",
      healthMonitorApi: "GET /api/health-monitor",
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
:root{color-scheme:light dark;--bg:#0f1115;--card:#171a21;--muted:#8b95a7;--text:#edf2ff;--line:#2a3140;--ok:#4ade80;--warn:#fbbf24;--bad:#fb7185;--accent:#93c5fd}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;background:var(--bg);color:var(--text)}header{position:sticky;top:0;background:rgba(15,17,21,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);padding:1rem 1.25rem;z-index:10}.wrap{max-width:1380px;margin:0 auto;padding:1rem}.row{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}.card{background:var(--card);border:1px solid var(--line);border-radius:1rem;padding:1rem;box-shadow:0 10px 30px rgba(0,0,0,.18)}button,input,select{font:inherit;padding:.6rem .8rem;border-radius:.6rem;border:1px solid var(--line);background:#10131a;color:var(--text)}button{cursor:pointer;background:#1d2736}.muted{color:var(--muted)}.pill{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:.2rem .55rem;margin:.1rem}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}pre{white-space:pre-wrap;word-break:break-word;background:#080a0f;border:1px solid var(--line);padding:.75rem;border-radius:.75rem;max-height:420px;overflow:auto}.list{display:grid;gap:.5rem}.item{border:1px solid var(--line);border-radius:.7rem;padding:.6rem;background:#11151d}a{color:var(--accent)}
</style>
</head>
<body>
<header>
  <div class="row"><h1 style="margin:.1rem 1rem .1rem 0">Rel.AI MCP Dashboard</h1><span class="pill">v9 console</span><span id="status" class="muted">not connected</span></div>
  <div class="row"><input id="token" type="password" placeholder="Bearer token${hasToken ? "" : " not required"}" style="min-width:280px"><button onclick="refresh()">Refresh</button><button onclick="toggleLive()" id="liveBtn">Start live logs</button><button onclick="loadHealth()">Health</button><button onclick="loadDiff()">Load diff</button><input id="workspace" placeholder="workspace"><input id="sessionId" placeholder="sessionId"></div>
</header>
<main class="wrap">
  <section class="grid" id="summary"></section>
  <section class="grid">
    <div class="card"><h2>Sessions</h2><div class="list" id="sessions"></div></div>
    <div class="card"><h2>Jobs</h2><div class="list" id="jobs"></div></div>
    <div class="card"><h2>Approvals</h2><div class="list" id="approvals"></div></div>
    <div class="card"><h2>Health findings</h2><div class="list" id="health"></div></div>
  </section>
  <section class="grid">
    <div class="card"><h2>Audit / live logs</h2><pre id="logs">No logs loaded.</pre></div>
    <div class="card"><h2>Diff viewer</h2><pre id="diff">Enter workspace/sessionId and click Load diff.</pre></div>
  </section>
  <section class="card"><h2>Raw dashboard data</h2><pre id="raw">Click Refresh.</pre></section>
</main>
<script>
let eventSource=null;
function headers(){const t=document.getElementById('token').value;return t?{Authorization:'Bearer '+t}:{}}
async function fetchJson(url){const res=await fetch(url,{headers:headers()});const text=await res.text();try{return JSON.parse(text)}catch(e){return {ok:false,error:text}}}
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function card(label,value,cls=''){return '<div class="card"><div class="muted">'+esc(label)+'</div><div class="'+cls+'" style="font-size:1.6rem;font-weight:700">'+esc(value)+'</div></div>'}
function render(data){
  document.getElementById('status').textContent=data.ok?'connected':'error';
  const c=data.counts||{};document.getElementById('summary').innerHTML=card('Sessions',c.sessions||0)+card('Jobs',c.jobs||0)+card('Approvals',c.approvals||0)+card('Locks',c.locks||0)+card('Findings',(data.health&&data.health.counts&&data.health.counts.findings)||0,((data.health&&data.health.ok)?'ok':'warn'));
  document.getElementById('sessions').innerHTML=(data.sessions||[]).slice(0,20).map(x=>'<div class="item"><b>'+esc(x.id)+'</b><br><span class="muted">'+esc(x.status)+' · '+esc(x.workspace)+' · '+esc(x.updatedAt||x.createdAt)+'</span></div>').join('')||'<span class="muted">none</span>';
  document.getElementById('jobs').innerHTML=(data.jobs||[]).slice(0,20).map(x=>'<div class="item"><b>'+esc(x.id)+'</b><br><span class="muted">'+esc(x.status)+' · '+esc(x.workspace)+' · '+esc(x.commandKey||'')+'</span></div>').join('')||'<span class="muted">none</span>';
  document.getElementById('approvals').innerHTML=(data.approvals||[]).slice(0,20).map(x=>'<div class="item"><b>'+esc(x.id)+'</b><br><span class="muted">'+esc(x.action)+' · '+esc(x.status||'pending')+'</span></div>').join('')||'<span class="muted">none</span>';
  document.getElementById('health').innerHTML=((data.health&&data.health.findings)||[]).slice(0,20).map(x=>'<div class="item"><b class="'+(x.severity==='error'?'bad':x.severity==='warning'?'warn':'ok')+'">'+esc(x.severity)+'</b> '+esc(x.code)+'<br><span class="muted">'+esc(x.message)+'</span></div>').join('')||'<span class="ok">No findings</span>';
  document.getElementById('logs').textContent=JSON.stringify((data.auditTail&&data.auditTail.entries)||[],null,2);
  document.getElementById('raw').textContent=JSON.stringify(data,null,2);
}
async function refresh(){render(await fetchJson('/api/dashboard/v9?limit=100'))}
async function loadHealth(){document.getElementById('raw').textContent=JSON.stringify(await fetchJson('/api/health-monitor'),null,2)}
async function loadDiff(){const w=document.getElementById('workspace').value;const s=document.getElementById('sessionId').value;document.getElementById('diff').textContent=JSON.stringify(await fetchJson('/api/session/diff?workspace='+encodeURIComponent(w)+'&sessionId='+encodeURIComponent(s)),null,2)}
function toggleLive(){if(eventSource){eventSource.close();eventSource=null;document.getElementById('liveBtn').textContent='Start live logs';return}const t=document.getElementById('token').value;eventSource=new EventSource('/events'+(t?'?token='+encodeURIComponent(t):''));eventSource.addEventListener('dashboard',e=>{try{render(JSON.parse(e.data))}catch(_){}});eventSource.addEventListener('error',()=>{document.getElementById('status').textContent='live stream error'});document.getElementById('liveBtn').textContent='Stop live logs'}
refresh();
</script>
</body>
</html>`;
}

module.exports = {
  startHttpServer,
  handleJsonRpcPayload
};
