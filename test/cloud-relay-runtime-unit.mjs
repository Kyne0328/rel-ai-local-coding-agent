import assert from 'node:assert/strict';

import { createCloudRelayRuntime, fallbackStatus } from '../electron/cloud-relay-runtime.js';

const statuses = [];
const logs = [];
let clientOptions = null;
const delegated = [];
const fakeClient = {
  getStatus: () => ({ state: 'connected', connected: true, deviceId: 'device_test' }),
  start: async value => { delegated.push(['start', value]); return { state: 'connecting' }; },
  stop: () => { delegated.push(['stop']); return { state: 'stopped' }; },
  reconnect: async () => { delegated.push(['reconnect']); return { state: 'connecting' }; },
  createPairingCode: async () => { delegated.push(['pair']); return { pairingCode: 'ABCD-EFGH' }; },
  resetRegistration: async () => { delegated.push(['reset']); return { state: 'unregistered' }; }
};
const runtime = createCloudRelayRuntime({
  app: {},
  safeStorage: {},
  baseUrl: 'https://relay.example/',
  onStatusChange: value => statuses.push(value),
  onLog: (message, options) => logs.push({ message, options }),
  createStateStore: options => ({ options }),
  createClient: options => { clientOptions = options; return fakeClient; }
});

assert.equal(runtime.getStatus().mcpUrl, 'https://relay.example/mcp');
assert.equal(runtime.initialize().connected, true);
assert.equal(clientOptions.baseUrl, 'https://relay.example/');
assert.equal(statuses.at(-1).deviceId, 'device_test');
await runtime.start({ localUrl: 'http://127.0.0.1:3333', token: 'token' });
await runtime.reconnect();
await runtime.createPairingCode();
await runtime.resetRegistration();
runtime.stop();
assert.deepEqual(delegated.map(entry => entry[0]), ['start', 'reconnect', 'pair', 'reset', 'stop']);
assert.equal(logs.length, 0);

const failedStatuses = [];
const failedLogs = [];
const failed = createCloudRelayRuntime({
  app: {},
  safeStorage: {},
  baseUrl: 'https://relay.example',
  onStatusChange: value => failedStatuses.push(value),
  onLog: (message, options) => failedLogs.push({ message, options }),
  createStateStore: () => { throw new Error('credential store unavailable'); }
});
assert.equal(failed.initialize().state, 'failed');
assert.match(failed.getStatus().lastError, /credential store unavailable/);
await assert.rejects(failed.createPairingCode(), /credential store unavailable/);
assert.equal(failedStatuses.at(-1).state, 'failed');
assert.match(failedLogs.at(-1).message, /could not initialize/);

const fallback = fallbackStatus('https://relay.example/');
assert.equal(fallback.baseUrl, 'https://relay.example');
assert.equal(fallback.mcpUrl, 'https://relay.example/mcp');

console.log('Cloud relay runtime unit tests passed.');
