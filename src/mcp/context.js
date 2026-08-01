import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BAGGAGE_META_KEY,
  createRequestStateCodec,
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY
} from '@modelcontextprotocol/server';
import { getStateDir } from '../statePaths.js';
import { MCP_PROTOCOL_VERSION } from './protocol.js';
import { principalIdentity } from './principal.js';

const SERVER_INSTANCE_ID = crypto.randomUUID();

function toolContext(context, options = {}) {
  const envelope = context?.mcpReq?.envelope || {};
  const client = objectValue(envelope[CLIENT_INFO_META_KEY]);
  const capabilities = objectValue(envelope[CLIENT_CAPABILITIES_META_KEY]);
  const requestHeaders = httpHeaders(context?.http?.req);
  for (const key of [TRACEPARENT_META_KEY, TRACESTATE_META_KEY, BAGGAGE_META_KEY]) {
    if (envelope[key] != null) requestHeaders[key] = String(envelope[key]);
  }
  return {
    publicHttpOnly: options.publicHttpOnly === true || Boolean(context?.http),
    requestId: context?.mcpReq?.id,
    serverInstanceId: SERVER_INSTANCE_ID,
    transportType: String(options.transportType || (context?.http ? 'streamable-http' : 'stdio')),
    protocolVersion: String(envelope[PROTOCOL_VERSION_META_KEY] || MCP_PROTOCOL_VERSION),
    clientName: String(client.name || ''),
    clientVersion: String(client.version || ''),
    clientCapabilities: capabilities,
    requestHeaders,
    principal: principalIdentity(options.principal || context?.http?.authInfo),
    signal: options.signal || context?.http?.req?.signal,
    mcp: {
      envelope,
      method: context?.mcpReq?.method,
      authInfo: context?.http?.authInfo || null,
      inputResponses: context?.mcpReq?.inputResponses || null
    }
  };
}

function clientName(context) {
  return String(context?.mcpReq?.envelope?.[CLIENT_INFO_META_KEY]?.name || '');
}

function httpHeaders(request) {
  const result = {};
  try {
    for (const [key, value] of request?.headers?.entries?.() || []) {
      result[String(key).toLowerCase()] = String(value);
    }
  } catch {}
  return result;
}

function createRelaiRequestStateCodec(config, principal) {
  return createRequestStateCodec({
    key: requestStateKey(config),
    ttlSeconds: 10 * 60,
    bind: context => `${context?.mcpReq?.method || ''}\0${principalIdentity(principal || context?.principal || context?.http?.authInfo)}`
  });
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

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export { SERVER_INSTANCE_ID, clientName, createRelaiRequestStateCodec, requestStateKey, toolContext };
