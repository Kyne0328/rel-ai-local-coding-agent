import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startManagedProcess, readManagedProcess, writeManagedProcess, stopManagedProcess, listManagedProcesses } from "../src/processManager.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-process-manager-'));
const stateDir = path.join(root, 'state');
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'managed-child.cjs'), `
process.stdout.write('READY\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', value => process.stdout.write('ECHO:' + value));
setInterval(() => {}, 1000);
`);
const config = { stateDir };
const workspace = { alias: 'app', path: workspaceRoot };
const taskContext = { taskId: 'task-process-test' };
let processId = '';

try {
  const started = await startManagedProcess(workspace, config, {
    command: 'node managed-child.cjs',
    startupWaitMs: 0,
    label: 'managed-test'
  }, taskContext);
  processId = started.processId;
  assert.match(processId, /^proc_/);
  assert.equal(started.workspace, 'app');
  assert.ok(['starting', 'running'].includes(started.status));

  const first = await waitForStdout(processId, /READY/);
  assert.match(first.stdout.text, /READY/);
  const nextOffset = first.stdout.nextOffset;

  assert.throws(
    () => readManagedProcess(config, { processId }, { taskId: 'another-task' }),
    error => error?.code === 'TASK_OWNERSHIP_MISMATCH'
  );
  const written = writeManagedProcess(config, { processId, input: 'hello\n' }, taskContext);
  assert.equal(written.acceptedBytes, 6);
  await new Promise(resolve => setTimeout(resolve, 150));
  const second = readManagedProcess(config, { processId, stdoutOffset: nextOffset, stderrOffset: 0 }, taskContext);
  assert.match(second.stdout.text, /ECHO:hello/);

  const listed = listManagedProcesses(config, { workspace: 'app' }, taskContext);
  assert.equal(listed.count, 1);
  assert.equal(listed.processes[0].processId, processId);

  const stopped = await stopManagedProcess(config, { processId, graceMs: 250 }, taskContext);
  assert.ok(['stopped', 'exited', 'failed'].includes(stopped.status));
  assert.ok(stopped.endedAt);
} finally {
  if (processId) await stopManagedProcess(config, { processId, graceMs: 0 }, taskContext).catch(() => {});
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Managed process lifecycle and cursor tests passed.');

async function waitForStdout(id, pattern, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = null;
  while (Date.now() < deadline) {
    snapshot = readManagedProcess(config, { processId: id, stdoutOffset: 0, stderrOffset: 0 }, taskContext);
    if (pattern.test(snapshot.stdout.text)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return snapshot;
}
