const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { ERROR_CODES, errorPayload } = require("../desktopUxContracts");

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

function unauthorized(res, options = {}) {
  const code = options.rejected === true
    ? ERROR_CODES.APPROVAL_TOKEN_REJECTED
    : ERROR_CODES.APPROVAL_TOKEN_REQUIRED;
  sendJson(res, 401, errorPayload(
    code,
    "Unauthorized. Send Authorization: Bearer <REL_AI_MCP_TOKEN>."
  ));
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.errorCode = ERROR_CODES.REQUEST_INVALID;
  return error;
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    // Decode once at the end so split UTF-8 sequences remain intact.
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(requestError(`Request body exceeds ${maxBytes} bytes.`, 413));
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
      throw requestError(`Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
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
    throw requestError('Invalid JSON body.');
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
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-protocol-version, mcp-method, mcp-name, traceparent, tracestate, baggage');
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

const configuredMinGzipBytes = Number(process.env.REL_AI_MCP_MIN_GZIP_BYTES || 2048);
const MIN_GZIP_BYTES = Number.isFinite(configuredMinGzipBytes) ? Math.max(0, configuredMinGzipBytes) : 2048;

function acceptsGzip(acceptEncoding = "") {
  return String(acceptEncoding)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .some((value) => value.startsWith("gzip") && !/;\s*q=0(?:\.0+)?(?:\s*;|$)/.test(value));
}

function mergedVaryHeader(res, value) {
  const values = String(res.getHeader("Vary") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) values.push(value);
  return values.join(", ");
}

function sendJson(res, status, payload, ae = "") {
  if (res.headersSent) return;
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  const compressible = body.length >= MIN_GZIP_BYTES;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...(compressible ? { "Vary": mergedVaryHeader(res, "Accept-Encoding") } : {})
  };
  if (!compressible || !acceptsGzip(ae)) {
    res.writeHead(status, { ...headers, "Content-Length": body.length });
    res.end(body);
    return;
  }

  zlib.gzip(body, { level: 4 }, (error, compressed) => {
    if (res.headersSent || res.destroyed) return;
    if (error) {
      res.writeHead(status, { ...headers, "Content-Length": body.length });
      res.end(body);
      return;
    }
    res.writeHead(status, {
      ...headers,
      "Content-Encoding": "gzip",
      "Content-Length": compressed.length
    });
    res.end(compressed);
  });
}

function sendSse(res, event, data, options = {}) {
  if (options.id != null && options.id !== '') res.write(`id: ${String(options.id).replace(/[\r\n]/g, '')}\n`);
  res.write(`event: ${event}\n`);
  const text = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of text.split(/\r?\n/)) res.write(`data: ${line}\n`);
  res.write("\n");
}

function sendHtml(res, status, html, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
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
  isAuthorized,
  timingSafeEqual,
  unauthorized,
  readRawBody,
  readJsonBody,
  readFormOrJsonBody,
  setBaseHeaders,
  sendJson,
  sendSse,
  sendHtml,
  contentTypeForStaticAsset,
  jsonForHtmlScript
};
