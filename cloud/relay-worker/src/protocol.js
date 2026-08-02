const MAX_RELAY_BODY_BYTES = 1024 * 1024;
const RELAY_TIMEOUT_MS = 60_000;

const REQUEST_HEADER_ALLOWLIST = new Set([
  'accept',
  'content-type',
  'mcp-protocol-version',
  'traceparent',
  'tracestate'
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  'cache-control',
  'content-type',
  'mcp-protocol-version'
]);

function collectAllowedHeaders(headers, allowlist) {
  const result = {};
  for (const [name, value] of headers.entries()) {
    const normalized = name.toLowerCase();
    if (allowlist.has(normalized)) result[normalized] = value;
  }
  return result;
}

function relayRequestEnvelope(requestId, request, bodyBase64) {
  const url = new URL(request.url);
  return {
    type: 'request',
    request_id: requestId,
    method: request.method,
    path: url.pathname,
    headers: collectAllowedHeaders(request.headers, REQUEST_HEADER_ALLOWLIST),
    body_base64: bodyBase64
  };
}

function normalizeRelayResponse(value) {
  if (!value || typeof value !== 'object' || value.type !== 'response') return null;
  const requestId = String(value.request_id || '');
  const bodyBase64 = String(value.body_base64 || '');
  const maximumEncodedBodyLength = Math.ceil(MAX_RELAY_BODY_BYTES / 3) * 4 + 4;
  if (!requestId || bodyBase64.length > maximumEncodedBodyLength) return null;
  const status = Number(value.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  const headers = new Headers();
  for (const [name, headerValue] of Object.entries(value.headers || {})) {
    const normalized = String(name).toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(normalized)) headers.set(normalized, String(headerValue));
  }
  return {
    requestId,
    status,
    headers,
    bodyBase64
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  });
}

function errorJson(code, message, status = 400, details = {}, headers = {}) {
  return json({ ok: false, error: { code, message, ...details } }, status, headers);
}

async function readJson(request, maxBytes = 32 * 1024) {
  const bytes = await readBodyBytes(request, maxBytes);
  if (bytes.byteLength === 0) return {};
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
  }
}

async function readBodyBytes(request, maxBytes = MAX_RELAY_BODY_BYTES) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maxBytes} bytes.`);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new HttpError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maxBytes} bytes.`);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

class HttpError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export {
  HttpError,
  MAX_RELAY_BODY_BYTES,
  RELAY_TIMEOUT_MS,
  base64ToBytes,
  bytesToBase64,
  errorJson,
  json,
  normalizeRelayResponse,
  readBodyBytes,
  readJson,
  relayRequestEnvelope
};
