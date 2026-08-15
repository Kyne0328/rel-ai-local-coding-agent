import assert from 'node:assert/strict';

import { createShutdownCoordinator } from '../electron/shutdown-coordinator.js';

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

console.log('Desktop shutdown coordinator idempotency and clean-exit gating tests passed.');
