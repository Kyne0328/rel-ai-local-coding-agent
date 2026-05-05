const http = require("node:http");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { handleMessage } = require("./server");
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
      streamableHttp: "POST /mcp",
      sse: "GET /sse then POST /messages?sessionId=..."
    }
  });
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

module.exports = {
  startHttpServer,
  handleJsonRpcPayload
};
