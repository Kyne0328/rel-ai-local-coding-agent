import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSecureTunnelRuntime } from '../electron/secure-tunnel-runtime.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-secure-tunnel-'));
let spawned = null;
let stopped = false;
const statuses = [];

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

try {
  const runtime = createSecureTunnelRuntime({
    spawnImpl: fakeSpawn,
    fetchImpl: async url => ({ ok: url === 'http://127.0.0.1:49001/readyz', status: 200 }),
    stopProcess: async child => { stopped = child === spawned.child; child.exitCode = 0; return { exited: true, forced: false }; },
    resolveExecutable: () => process.execPath,
    stateDir,
    onStatus: status => statuses.push(status)
  });
  const result = await runtime.start({ tunnelId: 'tunnel_example123456', port: 3333, localToken: 'local-secret', apiKey: 'sk-runtime-example-123456789', timeoutMs: 2000 });
  assert.equal(result.ok, true);
  assert.equal(runtime.snapshot().state, 'running');
  assert.equal(spawned.executable, process.execPath);
  assert.ok(spawned.args.includes('--control-plane.tunnel-id'));
  assert.ok(spawned.args.includes('tunnel_example123456'));
  assert.ok(spawned.args.includes('url=http://127.0.0.1:3333/mcp,channel=main'));
  assert.equal(spawned.options.env.CONTROL_PLANE_API_KEY, 'sk-runtime-example-123456789');
  assert.equal(spawned.options.env.REL_AI_LOCAL_AUTH_HEADER, 'Bearer local-secret');
  assert.equal(spawned.args.includes('cloudflared'), false);
  await runtime.stop();
  assert.equal(stopped, true);
  assert.equal(runtime.snapshot().state, 'stopped');
  assert.ok(statuses.some(status => status.state === 'running'));
  console.log('secure-tunnel-runtime-unit: ok');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}
