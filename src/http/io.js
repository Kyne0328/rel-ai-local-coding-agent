const crypto = require("node:crypto");
const zlib = require("node:zlib");

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

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Collect raw buffers and decode once at the end: decoding per-chunk corrupts
    // multi-byte UTF-8 sequences that straddle a chunk boundary.
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function readJsonBody(req, maxBytes) {
  return readRawBody(req, maxBytes).then((body) => {
    try {
      return body.trim() ? JSON.parse(body) : {};
    } catch (error) {
      throw new Error(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}

function tryParseJsonOrNull(raw) {
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

// OAuth /token uses application/x-www-form-urlencoded; /register and some clients use
// JSON. Parse by content-type, with a best-effort fallback for unlabeled JSON bodies.
async function readFormOrJsonBody(req, maxBytes) {
  const raw = await readRawBody(req, maxBytes);
  const contentType = String(req.headers?.["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const parsed = tryParseJsonOrNull(raw);
    if (parsed !== null) return parsed;
    throw new Error(`Invalid JSON body`);
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const obj = {};
    for (const [key, value] of new URLSearchParams(raw)) obj[key] = value;
    if (Object.keys(obj).length) return obj;
  }
  if (raw.trim().startsWith("{")) {
    const parsed = tryParseJsonOrNull(raw);
    if (parsed !== null) return parsed;
  }
  return {};
}

// Origin-scoped CORS. Only local dashboard/tooling origins are allowed to read
// local HTTP responses cross-origin. Requests with no Origin header (server-to-server
// MCP, curl, the same-origin dashboard) are unaffected; CORS only governs browser
// cross-origin reads.
function fixedCorsOrigins(options = {}) {
  const port = Number(options.port || 3333);
  return Object.freeze({
    loopback: `http://127.0.0.1:${port}`,
    localhost: `http://localhost:${port}`,
    ipv6Loopback: `http://[::1]:${port}`
  });
}

function allowedCorsOrigin(origin, options = {}) {
  const origins = fixedCorsOrigins(options);
  const value = String(origin || "");
  if (value === origins.loopback) return origins.loopback;
  if (value === origins.localhost) return origins.localhost;
  if (value === origins.ipv6Loopback) return origins.ipv6Loopback;
  return "";
}

function setBaseHeaders(req, res, options = {}) {
  const corsOrigin = allowedCorsOrigin(req?.headers?.origin ?? "", options);
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Vary", "Origin");
  }
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
    } catch { /* gzip failed; fall through to uncompressed response */ }
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendHtml(res, status, html) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
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
  return JSON.stringify(value).replaceAll("<", String.raw`\u003c`).replaceAll(">", String.raw`\u003e`).replaceAll("&", String.raw`\u0026`);
}

module.exports = {
  sendSse,
  isAuthorized,
  timingSafeEqual,
  unauthorized,
  readJsonBody,
  readFormOrJsonBody,
  setBaseHeaders,
  sendJson,
  sendHtml,
  contentTypeForStaticAsset,
  jsonForHtmlScript
};
