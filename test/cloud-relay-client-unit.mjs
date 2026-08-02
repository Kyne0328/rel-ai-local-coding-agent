import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createCloudRelayClient } from '../electron/cloud-relay-client.js';

class FakeWebSocket extends EventEmitter {
  static instances = [];
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }
  send(value) { this.sent.push(value); }
  close(code, reason) {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}

let stored = { deviceId: '', publicKeyJwk: null, privateKeyJwk: null, deviceToken: '' };
const stateStore = {
  load: () => structuredClone(stored),
  save: value => { stored = structuredClone(value); return structuredClone(stored); },
  clear: () => { stored = { deviceId: '', publicKeyJwk: null, privateKeyJwk: null, deviceToken: '' }; return true; }
};
const cloudCalls = [];
let localAuthorization = '';
const fetchImpl = async (url, options = {}) => {
  const parsed = new URL(url);
  if (parsed.hostname === '127.0.0.1') {
    localAuthorization = options.headers.get('authorization');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'blocked=true' }
    });
  }
  cloudCalls.push({ path: parsed.pathname, options });
  if (parsed.pathname === '/v1/devices/register/challenge') {
    return jsonResponse({
      ok: true,
      challenge_id: 'challenge_1',
      device_id: 'device_1',
      challenge: 'sign-this'
    }, 201);
  }
  if (parsed.pathname === '/v1/devices/register/complete') {
    const body = JSON.parse(options.body);
    assert.equal(body.challenge_id, 'challenge_1');
    assert.match(body.signature, /^[A-Za-z0-9_-]+$/);
    return jsonResponse({ ok: true, device_id: 'device_1', device_token: 'relai_device_token' }, 201);
  }
  if (parsed.pathname === '/v1/devices/connection-ticket') {
    assert.equal(options.headers.authorization, 'Bearer relai_device_token');
    return jsonResponse({ ok: true, websocket_protocol: 'relai-device.relai_ticket_test' }, 201);
  }
  if (parsed.pathname === '/v1/devices/pairing-code') {
    return jsonResponse({ ok: true, pairing_code: 'ABCD-EFGH', expires_at: '2026-08-02T01:00:00.000Z' }, 201);
  }
  throw new Error(`Unexpected fetch: ${parsed.href}`);
};

const statusUpdates = [];
const client = createCloudRelayClient({
  stateStore,
  baseUrl: 'https://relay.example',
  fetchImpl,
  WebSocketImpl: FakeWebSocket,
  onStatusChange: status => statusUpdates.push(status)
});

await client.start({ localUrl: 'http://127.0.0.1:3333', token: 'local-bearer' });
await new Promise(resolve => setImmediate(resolve));
assert.equal(client.getStatus().registered, true);
assert.equal(client.getStatus().connected, true);
assert.equal(client.getStatus().deviceId, 'device_1');
assert.equal(FakeWebSocket.instances.length, 1);
assert.match(FakeWebSocket.instances[0].url, /^wss:\/\/relay\.example\/v1\/devices\/connect/);
assert.deepEqual(FakeWebSocket.instances[0].protocols, ['relai-device.relai_ticket_test']);
assert.ok(statusUpdates.some(entry => entry.state === 'connected'));

const pairing = await client.createPairingCode();
assert.equal(pairing.pairingCode, 'ABCD-EFGH');
assert.equal(client.getStatus().pairingCode, 'ABCD-EFGH');

const socket = FakeWebSocket.instances[0];
socket.emit('message', JSON.stringify({
  type: 'request',
  request_id: 'request_1',
  method: 'POST',
  path: '/mcp',
  headers: {
    authorization: 'Bearer cloud-token-must-not-pass',
    'content-type': 'application/json',
    'x-untrusted': 'blocked'
  },
  body_base64: Buffer.from('{}').toString('base64')
}));
await new Promise(resolve => setImmediate(resolve));
assert.equal(localAuthorization, 'Bearer local-bearer');
assert.equal(socket.sent.length, 1);
const response = JSON.parse(socket.sent[0]);
assert.equal(response.type, 'response');
assert.equal(response.request_id, 'request_1');
assert.equal(response.status, 200);
assert.equal(response.headers['set-cookie'], undefined);

client.stop();
assert.equal(client.getStatus().state, 'stopped');
assert.equal(client.getStatus().connected, false);
assert.throws(
  () => createCloudRelayClient({ stateStore, baseUrl: 'http://relay.example', fetchImpl, WebSocketImpl: FakeWebSocket }),
  /must use HTTPS/
);

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

console.log('Cloud relay client unit tests passed.');
