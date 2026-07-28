import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRuntimeLogBuffer } from "../electron/runtime-log-buffer.js";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-runtime-logs-'));
const logPath = path.join(temp, 'diagnostics', 'service.log');
let tick = 0;
const buffer = createRuntimeLogBuffer({
  maxEntries: 3,
  filePath: logPath,
  now: () => `2026-07-25T00:00:0${tick++}.000Z`
});

try {
  buffer.append('first');
  buffer.append('Authorization: Bearer secret-token', { source: 'ngrok', code: 'public_endpoint_failed' });
  buffer.append('{"token":"secret-token"}', { level: 'error' });
  buffer.append('fourth');

  const bounded = buffer.snapshot();
  assert.equal(bounded.count, 3);
  assert.equal(bounded.persistent, true);
  assert.equal(bounded.entries.length, 3);
  assert.equal(bounded.entries.at(-1).message, 'fourth');
  assert.doesNotMatch(JSON.stringify(bounded), /secret-token/);
  assert.match(JSON.stringify(bounded), /\[redacted\]/);
  assert.equal(fs.existsSync(logPath), true);
  assert.doesNotMatch(fs.readFileSync(logPath, 'utf8'), /secret-token/);
  assert.equal(fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).length, 3);

  bounded.entries[0].message = 'mutated';
  assert.notEqual(buffer.snapshot().entries[0].message, 'mutated');

  const restored = createRuntimeLogBuffer({ maxEntries: 3, filePath: logPath });
  assert.equal(restored.snapshot().entries.length, 3);
  assert.equal(restored.snapshot().entries.at(-1).message, 'fourth');

  const transitions = createRuntimeLogBuffer({ maxEntries: 10, now: () => '2026-07-25T00:00:00.000Z' });
  transitions.recordStatusTransition({}, { serverRunning: true, tunnelStatus: 'connecting' });
  transitions.recordStatusTransition({ serverRunning: true, tunnelStatus: 'connecting' }, { serverRunning: true, tunnelStatus: 'running' });
  transitions.recordStatusTransition({ serverRunning: true }, { serverRunning: false });
  transitions.recordStatusTransition({}, { error: 'token=secret-token', errorCode: 'local_port_in_use' });
  const messages = transitions.snapshot().entries.map(entry => entry.message);
  assert.ok(messages.includes('Local service started.'));
  assert.ok(messages.includes('Public endpoint is available.'));
  assert.ok(messages.includes('Local service stopped.'));
  assert.doesNotMatch(JSON.stringify(messages), /secret-token/);

  const cleared = buffer.clear();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed, 3);
  assert.equal(buffer.snapshot().count, 0);
  assert.equal(fs.readFileSync(logPath, 'utf8'), '');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Runtime log buffer unit tests passed.');
