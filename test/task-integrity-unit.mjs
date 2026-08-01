import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readTaskIntegrity, readWorkspaceIntegrity, recordTaskIntegrityEvent } from '../src/taskIntegrity.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-integrity-'));
const workspacePath = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
fs.mkdirSync(workspacePath, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: workspacePath, encoding: 'utf8' });
git('init');
git('config', 'user.email', 'relai@example.test');
git('config', 'user.name', 'RelAI Test');
fs.writeFileSync(path.join(workspacePath, 'ambient.txt'), 'baseline\n');
git('add', '.');
git('commit', '-m', 'fixture');
fs.writeFileSync(path.join(workspacePath, 'ambient.txt'), 'pre-existing dirty change\n');

const config = {
  stateDir,
  workspaces: {
    app: { path: workspacePath, commands: {}, testCommands: {} }
  }
};
const taskOne = 'task-one';
const taskTwo = 'task-two';
const event = (taskId, tool, extra = {}) => ({
  taskId,
  workspace: 'app',
  taskIdentityVersion: 2,
  taskHistoryEligible: true,
  tool,
  ok: true,
  ts: new Date().toISOString(),
  ...extra
});

try {
  recordTaskIntegrityEvent(config, event(taskOne, 'relai_start_task'));
  const initial = readTaskIntegrity(config, taskOne, 'app');
  assert.ok(initial.baseline.changedFiles.includes('ambient.txt'));
  assert.deepEqual(initial.taskOwnedChangedFiles, []);
  assert.equal(initial.mutationGeneration, 0);

  fs.writeFileSync(path.join(workspacePath, 'task-one.js'), 'export const one = 1;\n');
  recordTaskIntegrityEvent(config, event(taskOne, 'relai_edit', { changedFiles: ['task-one.js'] }));
  fs.writeFileSync(path.join(workspacePath, 'task-two.js'), 'export const two = 2;\n');
  recordTaskIntegrityEvent(config, event(taskTwo, 'relai_start_task'));
  recordTaskIntegrityEvent(config, event(taskTwo, 'relai_edit', { changedFiles: ['task-two.js'] }));

  const one = readTaskIntegrity(config, taskOne, 'app');
  const two = readTaskIntegrity(config, taskTwo, 'app');
  assert.deepEqual(one.taskOwnedChangedFiles, ['task-one.js']);
  assert.deepEqual(two.taskOwnedChangedFiles, ['task-two.js']);
  assert.equal(one.taskOwnedChangedFiles.includes('ambient.txt'), false);
  assert.equal(one.taskOwnedChangedFiles.includes('task-two.js'), false);
  assert.equal(two.taskOwnedChangedFiles.includes('task-one.js'), false);

  recordTaskIntegrityEvent(config, event(taskOne, 'relai_run_checks', {
    validationStatus: 'passed',
    validationLevel: 'focused',
    validationFingerprint: 'fingerprint-one'
  }));
  const validated = readTaskIntegrity(config, taskOne, 'app');
  assert.equal(validated.latestValidatedMutationGeneration, validated.mutationGeneration);
  assert.equal(validated.validatedRepositoryFingerprint, 'fingerprint-one');

  fs.writeFileSync(path.join(workspacePath, 'task-one.js'), 'export const one = 3;\n');
  recordTaskIntegrityEvent(config, event(taskOne, 'relai_edit', { changedFiles: ['task-one.js'] }));
  const stale = readTaskIntegrity(config, taskOne, 'app');
  assert.equal(stale.validationResult, 'stale');
  assert.notEqual(stale.latestValidatedMutationGeneration, stale.mutationGeneration);

  const workspaceState = readWorkspaceIntegrity(config, 'app');
  assert.equal(workspaceState.generation, 3);
  assert.equal(workspaceState.lastMutation.taskId, taskOne);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Task-local mutation authority, dirty-baseline isolation, validation freshness, and cross-task attribution passed.');
