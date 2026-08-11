import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startManagedProcess, stopManagedProcess } from '../src/processManager.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-process-reuse-workspace-'));
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-process-reuse-state-'));
const config = { stateDir: stateRoot, processEnvironment: { allow: [] } };
const workspace = { alias: 'repo', path: root };
const command = `node -e "setInterval(()=>{},1000)"`;
const started = [];
try {
  const first = await startManagedProcess(workspace, config, { command, kind: 'service', purpose: 'reuse fixture', startupWaitMs: 25 }, { taskId: 'task-a', principal: 'principal-a' });
  started.push(first.processId);
  assert.equal(first.reused, false);

  const reused = await startManagedProcess(workspace, config, { command, kind: 'service', purpose: 'reuse fixture', startupWaitMs: 25 }, { taskId: 'task-a', principal: 'principal-a' });
  assert.equal(reused.processId, first.processId);
  assert.equal(reused.reused, true);
  assert.equal(reused.readiness?.verified, true);

  const otherTask = await startManagedProcess(workspace, config, { command, kind: 'service', purpose: 'reuse fixture', startupWaitMs: 25 }, { taskId: 'task-b', principal: 'principal-a' });
  started.push(otherTask.processId);
  assert.notEqual(otherTask.processId, first.processId, 'processes must never be reused across logical tasks');

  const changedPurpose = await startManagedProcess(workspace, config, { command, kind: 'service', purpose: 'different purpose', startupWaitMs: 25 }, { taskId: 'task-a', principal: 'principal-a' });
  started.push(changedPurpose.processId);
  assert.notEqual(changedPurpose.processId, first.processId, 'changed purpose must not reuse a process');

  const changedKind = await startManagedProcess(workspace, config, { command, kind: 'watcher', purpose: 'reuse fixture', startupWaitMs: 25 }, { taskId: 'task-a', principal: 'principal-a' });
  started.push(changedKind.processId);
  assert.notEqual(changedKind.processId, first.processId, 'changed process kind must not reuse a process');

  const reuseDisabled = await startManagedProcess(workspace, config, { command, kind: 'service', purpose: 'reuse fixture', reuseExisting: false, startupWaitMs: 25 }, { taskId: 'task-a', principal: 'principal-a' });
  started.push(reuseDisabled.processId);
  assert.notEqual(reuseDisabled.processId, first.processId, 'reuseExisting:false must force a new managed process');
  const changedEnvKeys = await startManagedProcess(workspace, config, { command, kind: 'service', purpose: 'reuse fixture', env: { RELAI_REUSE_KEY: 'one' }, startupWaitMs: 25 }, { taskId: 'task-a', principal: 'principal-a' });
  started.push(changedEnvKeys.processId);
  assert.notEqual(changedEnvKeys.processId, first.processId, 'changed environment key sets must not reuse a process');
} finally {
  for (const processId of [...new Set(started)]) {
    try { await stopManagedProcess(config, { processId, graceMs: 50 }, { internal: true }); } catch {}
  }
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(stateRoot, { recursive: true, force: true });
}
console.log('Exact same-task managed-process reuse tests passed.');