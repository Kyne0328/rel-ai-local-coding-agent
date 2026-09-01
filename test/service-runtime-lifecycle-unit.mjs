import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { saveLauncherConfig } from '../electron/launcher-config.js';
import { createDesktopServiceRuntime } from '../electron/service-runtime.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-service-runtime-'));
const configPath = path.join(stateDir, 'config.json');
const previousState = process.env.REL_AI_MCP_STATE_DIR;
const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_STATE_DIR = stateDir;
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  saveLauncherConfig({ port: 3333, tunnelId: 'tunnel_lifecycle123', token: 'local-token' });

  const localStart = deferred();
  const tunnelStart = deferred();
  let listening = false;
  let localStartCalls = 0;
  let localStopCalls = 0;
  let tunnelStopCalls = 0;
  let dashboardCloseCalls = 0;
  let localStopGate = null;
  let currentStatus = { serverRunning: false, tunnelStatus: 'stopped' };

  const runtime = createDesktopServiceRuntime({
    app: { getVersion: () => '0.26.0' },
    connection: {
      generateToken: () => 'generated-token',
      writeLaunchEnv() {},
      writeConnectionProfile() {}
    },
    configModule: {
      ensureConfig() {},
      getConfigPath: () => configPath
    },
    serviceProcessClient: {
      isListening: () => listening,
      updateContext() {},
      async start() {
        localStartCalls += 1;
        const result = await localStart.promise;
        listening = true;
        return result;
      },
      async stop() {
        localStopCalls += 1;
        if (localStopGate) await localStopGate.promise;
        listening = false;
        return {
          ok: true,
          cleanup: {
            clean: true,
            managedProcesses: { attempted: 0, stopped: 0, orphaned: 0 },
            localService: { closed: true, forced: false }
          }
        };
      },
      async dispose() {}
    },
    dashboardWindowManager: {
      async close() { dashboardCloseCalls += 1; }
    },
    runtimeLogs: { snapshot: () => ({ available: true, revision: 0, count: 0, entries: [] }) },
    fetchImpl: async url => ({ ok: url.endsWith('/health'), status: url.endsWith('/mcp') ? 405 : 200 }),
    secureTunnelRuntime: {
      snapshot: () => ({ state: currentStatus.tunnelStatus || 'stopped', processOwned: currentStatus.tunnelStatus === 'running' }),
      start: () => tunnelStart.promise,
      async stop() {
        tunnelStopCalls += 1;
        tunnelStart.resolve({ cancelled: true });
        return { stopped: true, exited: true };
      }
    },
    tunnelCredentials: { getApiKey: () => 'test-api-key' },
    errorCodes: {
      CONFIGURATION_INVALID: 'configuration_invalid',
      LOCAL_PORT_IN_USE: 'local_port_in_use',
      LOCAL_SERVICE_START_FAILED: 'local_service_start_failed',
      SECURE_TUNNEL_FAILED: 'secure_tunnel_failed',
      TUNNEL_RUNTIME_UNAVAILABLE: 'tunnel_runtime_unavailable'
    },
    getCurrentStatus: () => currentStatus,
    setStatus: next => { currentStatus = { ...currentStatus, ...next }; },
    replaceCurrentStatus: next => { currentStatus = next; },
    pushStatus() {}
  });

  const startPromise = runtime.startServer();
  await new Promise(resolve => setImmediate(resolve));

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let readinessSettled = false;
  try {
    globalThis.setTimeout = callback => { callback(); return 1; };
    globalThis.clearTimeout = () => {};
    const readiness = runtime.waitUntilListening(0).then(status => {
      readinessSettled = true;
      return status;
    });
    await Promise.resolve();
    assert.equal(readinessSettled, false,
      'timeout 0 must follow the in-progress local readiness promise instead of scheduling an early recovery deadline');
    void readiness;
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  const stopPromise = runtime.stopServer();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(localStopCalls, 0, 'shutdown must not race ahead while the local utility service is still binding');

  localStart.resolve({ ok: true, port: 4567 });
  const stopped = await stopPromise;
  await startPromise;
  assert.equal(localStopCalls, 1, 'shutdown must stop the local service after the pending bind resolves');
  assert.equal(tunnelStopCalls, 1, 'shutdown must still stop a tunnel start that follows local readiness');
  assert.equal(dashboardCloseCalls, 1);
  assert.equal(listening, false);
  assert.equal(stopped.cleanup.clean, true);

  listening = true;
  currentStatus = { serverRunning: true, tunnelStatus: 'running' };
  localStopGate = deferred();
  const racingStop = runtime.stopServer({ preserveDashboard: true });
  await new Promise(resolve => setImmediate(resolve));
  let racingStartSettled = false;
  const racingStart = runtime.startServer().then(status => {
    racingStartSettled = true;
    return status;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(racingStartSettled, false, 'a start requested during shutdown must wait for the stop transition instead of being lost');
  assert.equal(localStartCalls, 1, 'the replacement local service must not start until the previous stop finishes');
  localStopGate.resolve();
  await racingStop;
  await racingStart;
  assert.equal(localStartCalls, 2, 'the deferred start must run after shutdown completes');

  let terminalStatus = { serverRunning: false, tunnelStatus: 'stopped' };
  let terminalListening = false;
  const terminalRuntime = createDesktopServiceRuntime({
    app: { getVersion: () => '0.26.0' },
    connection: {
      generateToken: () => 'generated-token',
      writeLaunchEnv() {},
      writeConnectionProfile() {}
    },
    configModule: {
      ensureConfig() {},
      getConfigPath: () => configPath
    },
    serviceProcessClient: {
      isListening: () => terminalListening,
      updateContext() {},
      async start() { terminalListening = true; return { ok: true, port: 4777 }; },
      async stop() { terminalListening = false; return { ok: true, cleanup: { clean: true } }; },
      async dispose() {}
    },
    dashboardWindowManager: { async close() {} },
    runtimeLogs: { snapshot: () => ({ available: true, revision: 0, count: 0, entries: [] }) },
    fetchImpl: async url => ({ ok: url.endsWith('/health'), status: url.endsWith('/mcp') ? 405 : 200 }),
    secureTunnelRuntime: {
      snapshot: () => ({ state: terminalStatus.tunnelStatus || 'stopped', processOwned: false }),
      async start() {
        const error = new Error('Bundled tunnel-client is unavailable.');
        error.code = 'tunnel_runtime_unavailable';
        throw error;
      },
      async stop() { return { stopped: true, exited: true }; }
    },
    tunnelCredentials: { getApiKey: () => 'test-api-key' },
    errorCodes: {
      CONFIGURATION_INVALID: 'configuration_invalid',
      LOCAL_PORT_IN_USE: 'local_port_in_use',
      LOCAL_SERVICE_START_FAILED: 'local_service_start_failed',
      SECURE_TUNNEL_FAILED: 'secure_tunnel_failed',
      TUNNEL_RUNTIME_UNAVAILABLE: 'tunnel_runtime_unavailable'
    },
    getCurrentStatus: () => terminalStatus,
    setStatus: next => { terminalStatus = { ...terminalStatus, ...next }; },
    replaceCurrentStatus: next => { terminalStatus = next; },
    pushStatus() {}
  });
  const terminalFailure = await terminalRuntime.startServer();
  assert.equal(terminalFailure.tunnelStatus, 'failed');
  assert.equal(terminalFailure.errorCode, 'tunnel_runtime_unavailable', 'permanent local tunnel runtime failures must remain terminal through the desktop service layer');
} finally {
  if (previousState === undefined) delete process.env.REL_AI_MCP_STATE_DIR; else process.env.REL_AI_MCP_STATE_DIR = previousState;
  if (previousConfig === undefined) delete process.env.REL_AI_MCP_CONFIG; else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

console.log('Electron service runtime serializes shutdown behind local startup.');
