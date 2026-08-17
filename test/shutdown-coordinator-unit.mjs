import assert from 'node:assert/strict';

import { closeHttpServer, createShutdownCoordinator } from '../electron/shutdown-coordinator.js';

const calls = [];
const coordinator = createShutdownCoordinator({
  stopUpdater: () => calls.push('updater'),
  stopActivity: () => calls.push('activity'),
  closeWindows: () => calls.push('windows'),
  stopService: async () => {
    calls.push('service');
    return { cleanup: { clean: true } };
  },
  shutdownTelemetry: async () => calls.push('telemetry'),
  removeRuntimeMarker: () => calls.push('marker'),
  markCleanShutdown: () => calls.push('clean'),
  flushLogs: async () => calls.push('logs')
});

const first = coordinator.prepare('quit');
const duplicate = coordinator.prepare('duplicate');
assert.equal(first, duplicate, 'shutdown preparation must be idempotent');
const result = await first;
assert.equal(result.clean, true);
assert.equal(coordinator.isPrepared(), true);
assert.deepEqual(calls, ['updater', 'activity', 'windows', 'service', 'telemetry', 'marker', 'clean', 'logs']);

const failureCalls = [];
const failed = createShutdownCoordinator({
  stopService: async () => ({ cleanup: { clean: false } }),
  removeRuntimeMarker: () => failureCalls.push('marker'),
  markCleanShutdown: () => failureCalls.push('clean')
});
const failedResult = await failed.prepare('quit');
assert.equal(failedResult.clean, false);
assert.deepEqual(failureCalls, ['marker'], 'uncertain cleanup must preserve the unclean-shutdown marker');

const forcedClose = deferred();
const shutdownGate = deferred();
let closeCallback = null;
let shutdownPromise = Promise.resolve();
const closing = closeHttpServer({
  close(callback) { closeCallback = callback; },
  closeIdleConnections() {},
  closeAllConnections() { forcedClose.resolve(); },
  waitForShutdown() { return shutdownPromise; }
}, { timeoutMs: 5 });
let closeSettled = false;
void closing.then(() => { closeSettled = true; });
await forcedClose.promise;
await new Promise(resolve => setImmediate(resolve));
assert.equal(closeSettled, false, 'forcing connections closed must not report shutdown complete before the server close event');
shutdownPromise = shutdownGate.promise;
closeCallback();
await new Promise(resolve => setImmediate(resolve));
assert.equal(closeSettled, false, 'server close must still wait for registered MCP shutdown work');
shutdownGate.resolve();
assert.deepEqual(await closing, { closed: true, forced: true });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

console.log('Desktop shutdown coordinator idempotency, clean-exit gating, and forced-close synchronization tests passed.');
