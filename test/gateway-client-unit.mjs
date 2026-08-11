import assert from 'node:assert/strict';

import { createGatewayClient } from '../electron/gateway-client.js';
import { createGatewayState } from '../electron/gateway-state.js';
import { GATEWAY_PROTOCOL_VERSION, MAX_GATEWAY_MESSAGE_BYTES } from '../src/gateway/protocol.js';

class FakeSocket {
  static instances = [];
  static reset() { FakeSocket.instances = []; }
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  send(value) { this.sent.push(String(value)); }
  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', { code, reason, wasClean: code === 1000 });
  }
  open() { this.readyState = 1; this.emit('open', {}); }
  message(value) { this.emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) }); }
  emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
  frames() { return this.sent.map(value => JSON.parse(value)); }
}

function createClock() {
  let now = 1_800_000_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    random: () => 0.5,
    setTimeout(fn, delay) {
      const id = nextId++;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        await due[1].fn();
        await Promise.resolve();
      }
      now = target;
      await Promise.resolve();
    },
    pending: () => [...timers.values()].map(timer => timer.at - now).sort((a, b) => a - b)
  };
}

function pairedIdentity(overrides = {}) {
  const state = {
    version: 1,
    deviceId: '11111111-1111-4111-8111-111111111111',
    publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', ext: true, key_ops: ['verify'] },
    paired: true,
    principalId: 'prn_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ...overrides
  };
  return {
    async open() { return { ...state }; },
    snapshot() { return { ...state }; },
    principalState() { return { principalId: state.principalId, recoverySecret: 'recovery-local-only' }; },
    async setPrincipalState(value) { state.principalId = value.principalId; state.paired = true; return { ...state }; },
    async clearPrincipalState() { state.principalId = ''; state.paired = false; return { ...state }; },
    async signChallenge(frame) { this.lastChallenge = frame; return 'signed_challenge'; }
  };
}

function createFetch(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const route = Object.entries(routes).sort((a, b) => b[0].length - a[0].length).find(([suffix]) => String(url).includes(suffix));
    if (!route) throw new Error(`Unexpected fetch: ${url}`);
    const value = typeof route[1] === 'function' ? await route[1](url, options, calls) : route[1];
    return new Response(JSON.stringify(value.body ?? value), {
      status: value.status || 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

{
  const state = createGatewayState({ state: 'offline', deviceId: 'dev' });
  const first = state.snapshot();
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => { first.state = 'bad'; }, TypeError);
  const next = state.update({ state: 'connecting' });
  assert.notEqual(next, first);
  assert.equal(next.state, 'connecting');
}

{
  FakeSocket.reset();
  const clock = createClock();
  const identity = pairedIdentity();
  const client = createGatewayClient({
    gatewayOrigin: 'https://gateway.test', identity, WebSocketImpl: FakeSocket,
    fetchImpl: createFetch(), clock
  });
  await client.start();
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.message({
    type: 'authenticated', protocolVersion: GATEWAY_PROTOCOL_VERSION,
    principalId: identity.snapshot().principalId, deviceId: identity.snapshot().deviceId
  });
  await settle();
  const revokePromise = client.revokeDevice(identity.snapshot().deviceId);
  const revokeRequest = socket.frames().at(-1);
  socket.message({ type: 'device_revoke_result', requestId: revokeRequest.requestId, deviceId: revokeRequest.deviceId, ok: true });
  assert.deepEqual(await revokePromise, { ok: true, deviceId: revokeRequest.deviceId, selfRevoked: true });
  assert.equal(identity.snapshot().paired, false, 'self-revoke must clear the local principal pairing');
  assert.equal(client.snapshot().state, 'pairing_required');
  assert.equal(client.snapshot().principalPaired, false);
  assert.equal(socket.readyState, 3);
  assert.deepEqual(clock.pending(), [], 'self-revoke must not schedule a reconnect with revoked credentials');
}

{
  FakeSocket.reset();
  const clock = createClock();
  const identity = pairedIdentity();
  let resolveRequest;
  let requestSignal;
  const onRequest = async request => {
    requestSignal = request.signal;
    return new Promise(resolve => { resolveRequest = resolve; });
  };
  const statuses = [];
  const client = createGatewayClient({
    gatewayOrigin: 'https://gateway.test/', identity, WebSocketImpl: FakeSocket,
    fetchImpl: createFetch(), clock, appVersion: '0.24.1',
    getWorkspaces: () => ['repo', 'repo', 'C:/private/path', 'second_repo'],
    onRequest, onStatus: value => statuses.push(value)
  });
  await client.start();
  assert.equal(client.snapshot().state, 'connecting');
  assert.equal(FakeSocket.instances.length, 1);
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, 'wss://gateway.test/v1/principals/prn_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/devices/11111111-1111-4111-8111-111111111111/socket');
  socket.open();
  socket.message({
    type: 'challenge', protocolVersion: GATEWAY_PROTOCOL_VERSION,
    principalId: identity.snapshot().principalId, deviceId: identity.snapshot().deviceId,
    nonce: 'nonce_1234567890', expiresAt: clock.now() + 30_000
  });
  await settle();
  assert.equal(identity.lastChallenge.nonce, 'nonce_1234567890');
  assert.deepEqual(socket.frames()[0], {
    type: 'authenticate', protocolVersion: GATEWAY_PROTOCOL_VERSION,
    principalId: identity.snapshot().principalId, deviceId: identity.snapshot().deviceId,
    nonce: 'nonce_1234567890', expiresAt: clock.now() + 30_000, signature: 'signed_challenge'
  });
  socket.message({ type: 'authenticated', protocolVersion: GATEWAY_PROTOCOL_VERSION, principalId: identity.snapshot().principalId, deviceId: identity.snapshot().deviceId });
  await settle();
  assert.equal(client.snapshot().state, 'connected');
  assert.equal(client.snapshot().lastConnectedAt, clock.now());
  assert.deepEqual(socket.frames().at(-2), {
    type: 'capabilities', protocolVersion: GATEWAY_PROTOCOL_VERSION, appVersion: '0.24.1',
    mcpProtocolVersion: '2026-07-28', capabilities: {}
  });
  assert.deepEqual(socket.frames().at(-1), { type: 'workspaces', aliases: ['repo', 'second_repo'] });

  const routed = {
    type: 'request', gatewayRequestId: 'gwreq_1', requestKey: 'request_key_1', workspace: 'repo',
    expiresAt: clock.now() + 10_000,
    message: { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'relai://server/help' } }
  };
  socket.message(routed);
  await settle();
  assert.equal(client.snapshot().lastRequestAt, clock.now(), 'gateway state must record an actual routed request for onboarding and status UI');
  assert.deepEqual(socket.frames().at(-1), { type: 'accepted', gatewayRequestId: 'gwreq_1', requestKey: 'request_key_1' });
  assert.equal(requestSignal.aborted, false);
  socket.message({ type: 'cancel', gatewayRequestId: 'gwreq_1', requestKey: 'request_key_1' });
  await settle();
  assert.equal(requestSignal.aborted, true);
  resolveRequest({ ok: false, error: { code: 'CANCELLED', message: 'Cancelled.' } });
  await settle();
  assert.deepEqual(socket.frames().at(-1), {
    type: 'result', gatewayRequestId: 'gwreq_1', requestKey: 'request_key_1', ok: false,
    error: { code: 'CANCELLED', message: 'Cancelled.' }, durationMs: 0
  });

  const usagePromise = client.requestUsage('2026-08');
  const usageRequest = socket.frames().at(-1);
  assert.equal(usageRequest.type, 'usage_request');
  socket.message({ type: 'usage_result', requestId: usageRequest.requestId, month: '2026-08', totals: { requests: 1 }, tools: [], devices: [], workspaces: [] });
  assert.deepEqual(await usagePromise, { month: '2026-08', totals: { requests: 1 }, tools: [], devices: [], workspaces: [] });

  const devicesPromise = client.listDevices();
  const devicesRequest = socket.frames().at(-1);
  assert.equal(devicesRequest.type, 'devices_request');
  socket.message({ type: 'devices_result', requestId: devicesRequest.requestId, devices: [{ deviceId: identity.snapshot().deviceId, displayName: 'Desktop', revokedAt: null }] });
  assert.deepEqual(await devicesPromise, [{ deviceId: identity.snapshot().deviceId, displayName: 'Desktop', revokedAt: null }]);

  const revokePromise = client.revokeDevice('22222222-2222-4222-8222-222222222222');
  const revokeRequest = socket.frames().at(-1);
  assert.deepEqual({ type: revokeRequest.type, deviceId: revokeRequest.deviceId }, { type: 'device_revoke', deviceId: '22222222-2222-4222-8222-222222222222' });
  socket.message({ type: 'device_revoke_result', requestId: revokeRequest.requestId, deviceId: revokeRequest.deviceId, ok: true });
  assert.deepEqual(await revokePromise, { ok: true, deviceId: revokeRequest.deviceId });

  const linkPromise = client.createDeviceLink();
  const linkRequest = socket.frames().at(-1);
  assert.equal(linkRequest.type, 'device_link_request');
  socket.message({ type: 'device_link_result', requestId: linkRequest.requestId, ok: true, linkCode: 'L'.repeat(43), expiresAt: clock.now() + 60_000 });
  assert.deepEqual(await linkPromise, { ok: true, linkCode: 'L'.repeat(43), expiresAt: clock.now() + 60_000 });
  assert.equal(client.snapshot().state, 'connected', 'device link result must settle as a control response without closing the gateway socket');
  assert.ok(statuses.length >= 2);

  socket.emit('close', { code: 1006, reason: 'network', wasClean: false });
  assert.deepEqual(clock.pending(), [1000]);
  await clock.advance(999);
  assert.equal(FakeSocket.instances.length, 1);
  await clock.advance(1);
  assert.equal(FakeSocket.instances.length, 2);
  const secondSocket = FakeSocket.instances[1];
  secondSocket.emit('close', { code: 1006, reason: 'network', wasClean: false });
  assert.deepEqual(clock.pending(), [2000]);
  await client.stop();
  await clock.advance(10_000);
  assert.equal(FakeSocket.instances.length, 2, 'explicit stop must suppress reconnect');
}

{
  FakeSocket.reset();
  const clock = createClock();
  const identity = pairedIdentity();
  const client = createGatewayClient({
    gatewayOrigin: 'https://gateway.test', identity, WebSocketImpl: FakeSocket,
    fetchImpl: createFetch(), clock, onRequest: async () => ({ ok: true, payload: {} })
  });
  await client.start();
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.message({
    type: 'challenge', protocolVersion: GATEWAY_PROTOCOL_VERSION + 1,
    principalId: identity.snapshot().principalId, deviceId: identity.snapshot().deviceId,
    nonce: 'nonce_bad_version', expiresAt: clock.now() + 1000
  });
  await settle();
  assert.equal(client.snapshot().state, 'device_update_required');
  assert.equal(clock.pending().length, 0);
}

{
  FakeSocket.reset();
  const clock = createClock();
  let requestCalls = 0;
  const client = createGatewayClient({
    gatewayOrigin: 'https://gateway.test', identity: pairedIdentity(), WebSocketImpl: FakeSocket,
    fetchImpl: createFetch(), clock, onRequest: async () => { requestCalls += 1; return { ok: true, payload: {} }; }
  });
  await client.start();
  const socket = FakeSocket.instances[0];
  socket.open();
  socket.message('x'.repeat(MAX_GATEWAY_MESSAGE_BYTES + 1));
  await settle();
  assert.equal(requestCalls, 0);
  assert.equal(client.snapshot().state, 'error');
  assert.equal(socket.readyState, 3);
}

{
  FakeSocket.reset();
  const clock = createClock();
  const identity = pairedIdentity({ paired: false, principalId: '' });
  const fetchImpl = createFetch({
    '/v1/pairings': { status: 201, body: { ok: true, pairingId: 'pair_abc', code: 'ABCD-EFGH-JKLM', pollToken: 'poll_secret', expiresAt: clock.now() + 600_000 } },
    '/v1/pairings/pair_abc': { body: { ok: true, status: 'paired', principalId: 'prn_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', deviceId: identity.snapshot().deviceId, recoverySecret: 'recovery_delivered_once' } }
  });
  const client = createGatewayClient({
    gatewayOrigin: 'https://gateway.test', identity, WebSocketImpl: FakeSocket,
    fetchImpl, clock, pairingPollMs: 1000, displayName: 'Desktop', appVersion: '0.24.1'
  });
  await client.start();
  assert.equal(client.snapshot().state, 'pairing_required');
  const pairing = await client.beginPairing();
  assert.equal(pairing.code, 'ABCD-EFGH-JKLM');
  assert.equal(client.snapshot().state, 'pairing');
  await clock.advance(1000);
  assert.equal(identity.snapshot().paired, true);
  assert.equal(client.snapshot().state, 'connecting');
  assert.equal(FakeSocket.instances.length, 1);
  assert.equal(fetchImpl.calls[1].options.headers['X-RelAI-Pairing-Token'], 'poll_secret');
}

console.log('Gateway client unit tests passed.');
