/* global WebSocketPair */
import { DurableObject } from 'cloudflare:workers';
import {
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
} from './protocol.js';
import {
  bearerToken,
  deviceWebSocketProtocol,
  randomBase64Url,
  randomDeviceId,
  randomPairingCode,
  sha256Base64Url,
  tokenFromDeviceProtocol,
  verifyEd25519Jwk
} from './security.js';
import { authorizeMcpRequest, handleOAuthRoute } from './oauth.js';

const REGISTRATION_TTL_MS = 10 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const CONNECTION_TICKET_TTL_MS = 60 * 1000;
const JSON_BODY_LIMIT = 32 * 1024;

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorJson(error.code, error.message, error.status, error.details);
      }
      console.error('Unhandled Rel.AI Cloud error', error);
      return errorJson('INTERNAL_ERROR', 'The relay service could not process the request.', 500);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  const routeKey = `${request.method.toUpperCase()} ${url.pathname}`;
  const oauthResponse = await handleOAuthRoute(request, env);
  if (oauthResponse) return oauthResponse;

  if (routeKey === 'GET /health') {
    return json({ ok: true, service: 'rel-ai-cloud', version: '0.2.0' });
  }
  if (routeKey === 'POST /v1/devices/register/challenge') {
    return createRegistrationChallenge(request, env);
  }
  if (routeKey === 'POST /v1/devices/register/complete') {
    return completeDeviceRegistration(request, env);
  }
  if (routeKey === 'POST /v1/devices/pairing-code') {
    return createPairingCode(request, env);
  }
  if (routeKey === 'POST /v1/devices/connection-ticket') {
    return createConnectionTicket(request, env);
  }
  if (routeKey === 'GET /v1/devices/connect') {
    return connectDevice(request, env);
  }
  if (url.pathname === '/mcp' && ['POST', 'GET', 'DELETE'].includes(request.method.toUpperCase())) {
    return relayMcpRequest(request, env);
  }

  return errorJson('NOT_FOUND', 'Route not found.', 404);
}

async function createRegistrationChallenge(request, env) {
  const body = await readJson(request, JSON_BODY_LIMIT);
  const publicKeyJwk = body.public_key_jwk;
  if (!validEd25519Jwk(publicKeyJwk)) {
    throw new HttpError(400, 'INVALID_PUBLIC_KEY', 'public_key_jwk must be an Ed25519 public JWK.');
  }

  const now = Date.now();
  const challengeId = crypto.randomUUID();
  const deviceId = randomDeviceId();
  const challenge = `relai-device-registration:${deviceId}:${randomBase64Url(32)}`;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM device_registration_challenges WHERE expires_at <= ?').bind(now),
    env.DB.prepare(
      'INSERT INTO device_registration_challenges (challenge_id, device_id, public_key_jwk, challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(challengeId, deviceId, JSON.stringify(publicKeyJwk), challenge, now + REGISTRATION_TTL_MS, now)
  ]);

  return json({
    ok: true,
    challenge_id: challengeId,
    device_id: deviceId,
    challenge,
    expires_at: new Date(now + REGISTRATION_TTL_MS).toISOString()
  }, 201);
}

async function completeDeviceRegistration(request, env) {
  const body = await readJson(request, JSON_BODY_LIMIT);
  const challengeId = String(body.challenge_id || '');
  const signature = String(body.signature || '');
  if (!challengeId || !signature) {
    throw new HttpError(400, 'REGISTRATION_FIELDS_REQUIRED', 'challenge_id and signature are required.');
  }

  const row = await env.DB.prepare(
    'SELECT challenge_id, device_id, public_key_jwk, challenge, expires_at FROM device_registration_challenges WHERE challenge_id = ?'
  ).bind(challengeId).first();
  if (!row || Number(row.expires_at) <= Date.now()) {
    throw new HttpError(400, 'REGISTRATION_CHALLENGE_EXPIRED', 'The registration challenge is invalid or expired.');
  }

  const publicKeyJwk = JSON.parse(String(row.public_key_jwk));
  const verified = await verifyEd25519Jwk({
    publicKeyJwk,
    signatureBase64Url: signature,
    message: row.challenge
  });
  if (!verified) {
    throw new HttpError(401, 'INVALID_DEVICE_SIGNATURE', 'The device signature could not be verified.');
  }

  const deviceToken = `relai_device_${randomBase64Url(32)}`;
  const deviceTokenHash = await sha256Base64Url(deviceToken);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO devices (device_id, public_key_jwk, device_token_hash, status, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)'
    ).bind(String(row.device_id), JSON.stringify(publicKeyJwk), deviceTokenHash, 'active', now),
    env.DB.prepare('DELETE FROM device_registration_challenges WHERE challenge_id = ?').bind(challengeId)
  ]);

  return json({
    ok: true,
    device_id: String(row.device_id),
    device_token: deviceToken
  }, 201);
}

async function createPairingCode(request, env) {
  const device = await requireDevice(request, env);
  const now = Date.now();
  const code = randomPairingCode();
  const codeHash = await sha256Base64Url(normalizePairingCode(code));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pairing_codes WHERE device_id = ? OR expires_at <= ?').bind(device.device_id, now),
    env.DB.prepare(
      'INSERT INTO pairing_codes (code_hash, device_id, expires_at, created_at, claimed_at) VALUES (?, ?, ?, ?, NULL)'
    ).bind(codeHash, device.device_id, now + PAIRING_TTL_MS, now)
  ]);

  return json({
    ok: true,
    pairing_code: code,
    expires_at: new Date(now + PAIRING_TTL_MS).toISOString()
  }, 201);
}

async function createConnectionTicket(request, env) {
  const device = await requireDevice(request, env);
  const now = Date.now();
  const ticket = `relai_ticket_${randomBase64Url(32)}`;
  const ticketHash = await sha256Base64Url(ticket);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM device_connection_tickets WHERE device_id = ? OR expires_at <= ?').bind(device.device_id, now),
    env.DB.prepare(
      'INSERT INTO device_connection_tickets (ticket_hash, device_id, expires_at, created_at, used_at) VALUES (?, ?, ?, ?, NULL)'
    ).bind(ticketHash, device.device_id, now + CONNECTION_TICKET_TTL_MS, now)
  ]);
  return json({
    ok: true,
    connection_ticket: ticket,
    websocket_protocol: `relai-device.${ticket}`,
    expires_at: new Date(now + CONNECTION_TICKET_TTL_MS).toISOString()
  }, 201);
}

async function connectDevice(request, env) {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new HttpError(426, 'WEBSOCKET_REQUIRED', 'This endpoint requires a WebSocket upgrade.');
  }
  const protocol = deviceWebSocketProtocol(request);
  if (!protocol) {
    throw new HttpError(401, 'DEVICE_PROTOCOL_REQUIRED', 'Use the relai-device.<connection-ticket> WebSocket subprotocol.');
  }
  const ticket = tokenFromDeviceProtocol(protocol);
  const ticketHash = await sha256Base64Url(ticket);
  const now = Date.now();
  const device = await env.DB.prepare(
    `UPDATE device_connection_tickets
        SET used_at = ?
      WHERE ticket_hash = ?
        AND used_at IS NULL
        AND expires_at > ?
        AND EXISTS (
          SELECT 1 FROM devices
           WHERE devices.device_id = device_connection_tickets.device_id
             AND devices.status = 'active'
        )
      RETURNING device_id`
  ).bind(now, ticketHash, now).first();
  if (!device) {
    throw new HttpError(401, 'INVALID_CONNECTION_TICKET', 'The device connection ticket is invalid, expired, or already used.');
  }

  await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
    .bind(now, device.device_id)
    .run();

  const relay = relayStub(env, String(device.device_id));
  const relayRequest = new Request('https://relay.internal/connect', {
    method: 'GET',
    headers: {
      upgrade: 'websocket',
      'sec-websocket-protocol': protocol,
      'x-relai-device-id': String(device.device_id)
    }
  });
  return relay.fetch(relayRequest);
}

async function relayMcpRequest(request, env) {
  const authorization = await authorizeMcpRequest(request, env);
  if (authorization.response) return authorization.response;
  const row = authorization.token;

  const body = await readBodyBytes(request, MAX_RELAY_BODY_BYTES);
  const relayRequest = new Request('https://relay.internal/relay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request: relayRequestEnvelope(crypto.randomUUID(), request, bytesToBase64(body))
    })
  });
  const response = await relayStub(env, String(row.device_id)).fetch(relayRequest);
  if (!response.ok) return response;

  const payload = await response.json();
  const normalized = normalizeRelayResponse(payload);
  if (!normalized) {
    throw new HttpError(502, 'INVALID_DEVICE_RESPONSE', 'The connected device returned an invalid relay response.');
  }
  const responseBody = [204, 205, 304].includes(normalized.status)
    ? null
    : base64ToBytes(normalized.bodyBase64);
  return new Response(responseBody, {
    status: normalized.status,
    headers: normalized.headers
  });
}

async function requireDevice(request, env) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'DEVICE_TOKEN_REQUIRED', 'A device bearer token is required.');
  const tokenHash = await sha256Base64Url(token);
  const row = await env.DB.prepare(
    `SELECT device_id, status FROM devices WHERE device_token_hash = ?`
  ).bind(tokenHash).first();
  if (!row || row.status !== 'active') {
    throw new HttpError(401, 'INVALID_DEVICE_TOKEN', 'The device token is invalid or revoked.');
  }
  return row;
}

function relayStub(env, deviceId) {
  const id = env.DEVICE_RELAY.idFromName(deviceId);
  return env.DEVICE_RELAY.get(id);
}

function validEd25519Jwk(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
    && value.kty === 'OKP'
    && value.crv === 'Ed25519'
    && typeof value.x === 'string'
    && value.x.length >= 40
  );
}

function normalizePairingCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

export class DeviceRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pending = new Map();
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/connect') return this.connect(request);
      if (url.pathname === '/relay' && request.method === 'POST') return this.relay(request);
      if (url.pathname === '/status') {
        return json({ ok: true, connected: this.ctx.getWebSockets('device').length > 0 });
      }
      return errorJson('NOT_FOUND', 'Durable Object route not found.', 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorJson(error.code, error.message, error.status, error.details);
      }
      throw error;
    }
  }

  connect(request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return errorJson('WEBSOCKET_REQUIRED', 'Expected a WebSocket upgrade.', 426);
    }
    const protocol = request.headers.get('sec-websocket-protocol') || '';
    const deviceId = request.headers.get('x-relai-device-id') || '';
    if (!protocol || !deviceId) return errorJson('INVALID_DEVICE_CONNECTION', 'Missing validated device connection metadata.', 401);

    for (const existing of this.ctx.getWebSockets('device')) {
      try { existing.close(1012, 'Replaced by a newer Rel.AI device connection.'); } catch {}
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['device']);
    server.serializeAttachment({ deviceId, connectedAt: Date.now() });
    server.send(JSON.stringify({ type: 'connected', device_id: deviceId }));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'sec-websocket-protocol': protocol }
    });
  }

  async relay(request) {
    const sockets = this.ctx.getWebSockets('device');
    const socket = sockets.at(-1);
    if (!socket) {
      return errorJson('DEVICE_OFFLINE', 'The paired Rel.AI desktop application is offline.', 503);
    }

    const payload = await readJson(request, MAX_RELAY_BODY_BYTES + 64 * 1024);
    const envelope = payload.request;
    const requestId = String(envelope?.request_id || payload.request_id || '');
    if (!requestId || envelope?.type !== 'request') {
      return errorJson('INVALID_RELAY_REQUEST', 'The relay request envelope is invalid.', 400);
    }

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new HttpError(504, 'DEVICE_TIMEOUT', `The device did not respond within ${RELAY_TIMEOUT_MS} ms.`));
      }, RELAY_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });

    try {
      socket.send(JSON.stringify(envelope));
      return json(await responsePromise);
    } finally {
      this.pending.delete(requestId);
    }
  }

  webSocketMessage(socket, message) {
    if (typeof message !== 'string') return;
    if (message.length > Math.ceil(MAX_RELAY_BODY_BYTES / 3) * 4 + 64 * 1024) {
      try { socket.close(1009, 'Rel.AI relay response exceeded the configured limit.'); } catch {}
      return;
    }
    let payload;
    try { payload = JSON.parse(message); } catch { return; }
    if (payload?.type !== 'response') return;
    const requestId = String(payload.request_id || '');
    const pending = this.pending.get(requestId);
    if (!pending) return;
    pending.resolve(payload);
  }

  webSocketClose(socket, code, reason) {
    for (const pending of this.pending.values()) {
      pending.reject(new HttpError(503, 'DEVICE_DISCONNECTED', 'The Rel.AI desktop application disconnected during the request.'));
    }
    this.pending.clear();
    try { socket.close(code, reason); } catch {}
  }

  webSocketError(_socket) {
    for (const pending of this.pending.values()) {
      pending.reject(new HttpError(503, 'DEVICE_CONNECTION_ERROR', 'The Rel.AI device connection failed.'));
    }
    this.pending.clear();
  }
}
