import * as crypto from "node:crypto";
import { ERROR_CODES } from "../desktopUxContracts.js";

const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

function isAuthorized(req, options) {
  if (!options.token && options.allowNoAuth) return true;
  const header = String(req.headers.authorization || "").trim();
  const expected = `Bearer ${String(options.token || "").trim()}`;
  return timingSafeEqual(header, expected);
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.errorCode = ERROR_CODES.REQUEST_INVALID;
  return error;
}

function normalizeMaxBodyBytes(value, fallback = DEFAULT_MAX_BODY_BYTES) {
  const number = Number(value);
  if (Number.isSafeInteger(number) && number > 0) return number;
  const fallbackNumber = Number(fallback);
  if (Number.isSafeInteger(fallbackNumber) && fallbackNumber > 0) return fallbackNumber;
  return DEFAULT_MAX_BODY_BYTES;
}

function readRawBody(req, maxBytes) {
  const limit = normalizeMaxBodyBytes(maxBytes);
  return new Promise((resolve, reject) => {
    const declaredBytes = Number(req.headers?.["content-length"]);
    if (Number.isSafeInteger(declaredBytes) && declaredBytes >= 0 && declaredBytes > limit) {
      req.resume?.();
      reject(requestError(`Request body exceeds ${limit} bytes.`, 413));
      return;
    }

    // Buffer bytes until JSON parsing. Keeping native chunks and concatenating once is
    // measurably faster than incremental string decoding or manual preallocation here.
    const chunks = [];
    let bytes = 0;
    let rejected = false;
    req.on("data", (chunk) => {
      if (rejected) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limit) {
        rejected = true;
        req.resume?.();
        reject(requestError(`Request body exceeds ${limit} bytes.`, 413));
        return;
      }
      chunks.push(buffer);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks, bytes).toString("utf8"));
    });
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

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length
  });
  res.end(body);
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
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'self'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...headers
  });
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

export { DEFAULT_MAX_BODY_BYTES, isAuthorized, normalizeMaxBodyBytes, readRawBody, readJsonBody, setBaseHeaders, sendJson, sendSse, sendHtml, contentTypeForStaticAsset, jsonForHtmlScript };
