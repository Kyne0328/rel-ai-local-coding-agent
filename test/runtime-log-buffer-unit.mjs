import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRuntimeLogBuffer } from "../electron/runtime-log-buffer.js";
import { applyRuntimeLogChange } from '../electron/runtime-log-snapshot.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-runtime-logs-'));
const logPath = path.join(temp, 'diagnostics', 'service.log');
let tick = 0;
const buffer = createRuntimeLogBuffer({
  maxEntries: 3,
  filePath: logPath,
  now: () => `2026-07-25T00:00:0${tick++}.000Z`
});

try {
  const changes = [];
  const unsubscribe = buffer.onChange(change => changes.push(change));
  buffer.append('first');
  buffer.append('Authorization: Bearer secret-token', { source: 'openai-tunnel', code: 'public_endpoint_failed' });
  buffer.append('{"token":"secret-token"}', { level: 'error' });
  buffer.append('OPENAI_API_KEY=runtime-env-secret', { source: 'local-service' });
  buffer.append('fourth');
  await buffer.flush();

  const bounded = buffer.snapshot();
  assert.equal(bounded.count, 3);
  assert.equal(bounded.revision, 5);
  assert.equal(changes.length, 5);
  assert.equal(changes.at(-1).type, 'append');
  assert.equal(changes.at(-1).entry.message, 'fourth');
  assert.equal(changes.at(-1).count, 3);
  assert.equal(changes.at(-1).maxEntries, 3);
  assert.equal(bounded.persistent, true);
  assert.equal(bounded.entries.length, 3);
  assert.equal(bounded.entries.at(-1).message, 'fourth');
  assert.doesNotMatch(JSON.stringify(bounded), /secret-token|runtime-env-secret/);
  assert.match(JSON.stringify(bounded), /\[redacted\]/);
  assert.equal(fs.existsSync(logPath), true);
  assert.doesNotMatch(fs.readFileSync(logPath, 'utf8'), /secret-token|runtime-env-secret/);
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
  assert.ok(messages.includes('OpenAI Secure MCP Tunnel is connected.'));
  assert.ok(messages.includes('Local service stopped.'));
  assert.doesNotMatch(JSON.stringify(messages), /secret-token/);

  const cleared = buffer.clear();
  await buffer.flush();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed, 3);
  assert.equal(changes.at(-1).type, 'reset');
  assert.equal(changes.at(-1).revision, 6);
  unsubscribe();
  assert.equal(buffer.snapshot().count, 0);
  assert.equal(fs.readFileSync(logPath, 'utf8'), '');

  let projected = { available: true, revision: 1, count: 2, entries: [{ message: 'one' }, { message: 'two' }] };
  projected = applyRuntimeLogChange(projected, { type: 'append', revision: 2, count: 3, maxEntries: 2, entry: { message: 'three' } });
  assert.equal(projected.revision, 2);
  assert.equal(projected.count, 3);
  assert.deepEqual(projected.entries.map(entry => entry.message), ['two', 'three']);
  const duplicate = applyRuntimeLogChange(projected, { type: 'append', revision: 2, count: 3, maxEntries: 2, entry: { message: 'duplicate' } });
  assert.equal(duplicate.revision, 2);
  assert.deepEqual(duplicate.entries.map(entry => entry.message), ['two', 'three'], 'replayed runtime-log revisions must be idempotent');
  const staleReset = applyRuntimeLogChange(projected, { type: 'reset', revision: 1, count: 0, maxEntries: 2 });
  assert.deepEqual(staleReset.entries.map(entry => entry.message), ['two', 'three'], 'stale resets must not erase newer runtime logs');
  projected = applyRuntimeLogChange(projected, { type: 'reset', revision: 3, count: 0, maxEntries: 2 });
  assert.equal(projected.revision, 3);
  assert.equal(projected.count, 0);
  assert.deepEqual(projected.entries, []);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Runtime log buffer unit tests passed.');
