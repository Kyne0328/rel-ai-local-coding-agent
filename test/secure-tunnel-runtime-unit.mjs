import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSecureTunnelRuntime } from '../electron/secure-tunnel-runtime.js';
import { makeTunnelProcessEnvironment } from '../src/processEnvironment.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-secure-tunnel-'));
let spawned = null;
let primaryChild;
let operational = true;
const statuses = [];
const logs = [];

function fakeSpawn(executable, args, options) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  const healthIndex = args.indexOf('--health.url-file');
  fs.writeFileSync(args[healthIndex + 1], 'http://127.0.0.1:49001\n');
  spawned = { executable, args, options, child };
  return child;
}

function fetchTunnel(url) {
  if (url === 'http://127.0.0.1:49001/healthz') return Promise.resolve(response(200));
  if (url === 'http://127.0.0.1:49001/readyz') return Promise.resolve(response(operational ? 200 : 503));
  if (url === 'http://127.0.0.1:49001/api/status') {
    return Promise.resolve(response(operational ? 200 : 503, {
      tunnel_metadata: { id: 'tunnel_example123456' },
      mcp_probe: { status: 'ok' }
    }));
  }
  return Promise.resolve(response(404));
}

try {
  const runtime = createSecureTunnelRuntime({
    spawnImpl: fakeSpawn,
    fetchImpl: fetchTunnel,
    stopProcess: async child => { child.exitCode = 0; return { exited: true, forced: false }; },
    resolveExecutable: () => process.execPath,
    makeEnvironment: makeTunnelProcessEnvironment,
    stateDir,
    monitorIntervalMs: 10,
    degradedFailureThreshold: 2,
    onLog: entry => logs.push(entry),
    onStatus: status => statuses.push(status)
  });
  const result = await runtime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-example-123456789', timeoutMs: 2000 });
  primaryChild = spawned.child;
  assert.equal(result.ok, true);
  assert.equal(runtime.snapshot().state, 'running');
  assert.equal(spawned.executable, process.execPath);
  assert.ok(spawned.args.includes('--control-plane.tunnel-id'));
  assert.ok(spawned.args.includes('tunnel_example123456'));
  assert.ok(spawned.args.includes('url=http://127.0.0.1:3333/mcp,channel=main'));
  assert.equal(spawned.options.env.CONTROL_PLANE_API_KEY, 'sk-runtime-example-123456789');
  assert.equal(spawned.options.env.REL_AI_LOCAL_AUTH_HEADER, 'Bearer local-secret');
  assert.equal(spawned.options.env.OPENAI_API_KEY, undefined, 'the tunnel must not inherit unrelated application credentials');
  assert.equal(spawned.options.env.SSH_AUTH_SOCK, undefined, 'the tunnel must not inherit the user SSH agent');
  assert.equal(spawned.args.includes('cloudflared'), false);
  for (const phase of ['starting', 'locally_ready', 'authenticating', 'running']) {
    assert.ok(statuses.some(status => status.state === phase), `startup must publish ${phase}`);
  }

  operational = false;
  await waitFor(() => runtime.snapshot().state === 'degraded');
  assert.equal(runtime.snapshot().errorCode, 'tunnel_connection_interrupted');
  operational = true;
  await waitFor(() => runtime.snapshot().state === 'running');
  assert.equal(runtime.snapshot().error, '');

  const persistentRuntime = createSecureTunnelRuntime({
    spawnImpl: fakeSpawn,
    fetchImpl: fetchTunnel,
    stopProcess: async child => { child.exitCode = 0; return { exited: true, forced: false }; },
    resolveExecutable: () => process.execPath,
    makeEnvironment: makeTunnelProcessEnvironment,
    stateDir,
    monitorIntervalMs: 10,
    degradedFailureThreshold: 2,
    failedFailureThreshold: 4
  });
  await persistentRuntime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-persistent-outage-123456', timeoutMs: 1000 });
  operational = false;
  await waitFor(() => persistentRuntime.snapshot().state === 'failed');
  assert.equal(persistentRuntime.snapshot().errorCode, 'tunnel_connection_interrupted');
  assert.ok(persistentRuntime.snapshot().consecutiveFailures >= 4, 'persistent outage must escalate only after the second failure threshold');

  operational = true;
  await runtime.stop();
  assert.equal(primaryChild.exitCode, 0, 'manual stop must terminate the original tunnel child');
  assert.equal(runtime.snapshot().state, 'stopped');
  assert.ok(logs.some(entry => entry.source === 'openai-tunnel'));

  let authChild = null;
  let authStopped = false;
  const authRuntime = createSecureTunnelRuntime({
    spawnImpl(executable, args, options) {
      authChild = fakeSpawn(executable, args, options);
      setImmediate(() => authChild.stderr.emit('data', '{"level":"ERROR","msg":"request failed","component":"controlplane","status_code":401}'));
      return authChild;
    },
    fetchImpl: async url => url.endsWith('/healthz') ? response(200) : response(503),
    stopProcess: async child => { authStopped = child === authChild; child.exitCode = 0; return { exited: true, forced: false }; },
    resolveExecutable: () => process.execPath,
    makeEnvironment: makeTunnelProcessEnvironment,
    stateDir,
    monitorIntervalMs: 10
  });
  await assert.rejects(
    () => authRuntime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-rejected-123456789', timeoutMs: 1000 }),
    error => error.code === 'tunnel_authentication_failed'
  );
  assert.equal(authRuntime.snapshot().state, 'failed');
  assert.equal(authRuntime.snapshot().errorCode, 'tunnel_authentication_failed');
  assert.equal(authStopped, true, 'authoritative authentication failure must stop endless tunnel retries');

  let statusOnlyChild = null;
  const statusOnlyRuntime = createSecureTunnelRuntime({
    spawnImpl(executable, args, options) {
      statusOnlyChild = fakeSpawn(executable, args, options);
      return statusOnlyChild;
    },
    fetchImpl: async url => {
      if (url.endsWith('/healthz') || url.endsWith('/readyz')) return response(200);
      if (url.endsWith('/api/status')) return response(401);
      return response(404);
    },
    stopProcess: async child => { child.exitCode = 0; return { exited: true, forced: false }; },
    resolveExecutable: () => process.execPath,
    makeEnvironment: makeTunnelProcessEnvironment,
    stateDir
  });
  await assert.rejects(
    () => statusOnlyRuntime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-rejected-status-123456', timeoutMs: 1000 }),
    error => error.code === 'tunnel_authentication_failed'
  );
  assert.equal(statusOnlyRuntime.snapshot().errorCode, 'tunnel_authentication_failed', 'admin status must classify 401 even if no matching log event arrives');

  let revoked = false;
  let revokedChild = null;
  let revokedStopped = false;
  const revokedRuntime = createSecureTunnelRuntime({
    spawnImpl(executable, args, options) {
      revokedChild = fakeSpawn(executable, args, options);
      return revokedChild;
    },
    fetchImpl: async url => {
      if (url.endsWith('/healthz') || url.endsWith('/readyz')) return response(200);
      if (url.endsWith('/api/status')) {
        return revoked
          ? response(401)
          : response(200, { tunnel_metadata: { id: 'tunnel_example123456' }, mcp_probe: { status: 'ok' } });
      }
      return response(404);
    },
    stopProcess: async child => { revokedStopped = child === revokedChild; child.exitCode = 0; return { exited: true, forced: false }; },
    resolveExecutable: () => process.execPath,
    makeEnvironment: makeTunnelProcessEnvironment,
    stateDir,
    monitorIntervalMs: 10
  });
  await revokedRuntime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-revoked-later-123456', timeoutMs: 1000 });
  revoked = true;
  await waitFor(() => revokedRuntime.snapshot().state === 'failed');
  assert.equal(revokedRuntime.snapshot().errorCode, 'tunnel_authentication_failed');
  assert.equal(revokedStopped, true, 'a runtime key rejected after startup must stop the tunnel child instead of degrading forever');

  const unavailableRuntime = createSecureTunnelRuntime({
    spawnImpl: fakeSpawn,
    fetchImpl: fetchTunnel,
    stopProcess: async () => ({ exited: true, forced: false }),
    resolveExecutable: () => '',
    makeEnvironment: makeTunnelProcessEnvironment,
    stateDir
  });
  await assert.rejects(
    () => unavailableRuntime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-missing-client-123456', timeoutMs: 1000 }),
    error => error.code === 'tunnel_runtime_unavailable'
  );
  assert.equal(unavailableRuntime.snapshot().state, 'failed');
  assert.equal(unavailableRuntime.snapshot().errorCode, 'tunnel_runtime_unavailable', 'missing local tunnel runtime must be terminal instead of entering automatic reconnect');

  console.log('secure-tunnel-runtime-unit: ok');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for secure tunnel state transition.');
}
