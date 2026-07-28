'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  PROTOCOL_VERSION_META_KEY,
  CLIENT_INFO_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
  BAGGAGE_META_KEY
} = require('@modelcontextprotocol/server');
const { getStateDir } = require('../audit');

const SERVER_INSTANCE_ID = crypto.randomUUID();

function toolContext(context, options) {
  const envelope = context?.mcpReq?.envelope || {};
  const client = envelope[CLIENT_INFO_META_KEY] || {};
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY] || {};
  const requestHeaders = httpHeaders(context?.http?.req);
  for (const key of [TRACEPARENT_META_KEY, TRACESTATE_META_KEY, BAGGAGE_META_KEY]) {
    if (envelope[key]) requestHeaders[key] = String(envelope[key]);
  }
  return {
    publicHttpOnly: options.publicHttpOnly === true || Boolean(context?.http),
    requestId: context?.mcpReq?.id,
    serverInstanceId: SERVER_INSTANCE_ID,
    transportType: String(options.transportType || (context?.http ? 'streamable-http' : 'stdio')),
    protocolVersion: String(envelope[PROTOCOL_VERSION_META_KEY] || '2026-07-28'),
    clientName: String(client.name || ''),
    clientVersion: String(client.version || ''),
    clientCapabilities: capabilities,
    requestHeaders,
    mcp: { envelope, method: context?.mcpReq?.method, authInfo: context?.http?.authInfo || null }
  };
}

function clientName(context) {
  return String(context?.mcpReq?.envelope?.[CLIENT_INFO_META_KEY]?.name || '');
}

function httpHeaders(request) {
  const result = {};
  try {
    for (const [key, value] of request?.headers?.entries?.() || []) result[String(key).toLowerCase()] = String(value);
  } catch {}
  return result;
}

function requestStateKey(config) {
  const explicit = String(process.env.REL_AI_REQUEST_STATE_KEY || '').trim();
  if (Buffer.byteLength(explicit, 'utf8') >= 32) return explicit;
  const file = path.join(getStateDir(config), 'request-state.key');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const existing = fs.readFileSync(file);
    if (existing.length >= 32) return existing;
  } catch {}
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

module.exports = { toolContext, clientName, requestStateKey, SERVER_INSTANCE_ID };
