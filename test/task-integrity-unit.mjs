import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as taskIntegrity from '../src/taskIntegrity.js';
const { readTaskIntegrity, readWorkspaceIntegrity, recordTaskIntegrityEvent } = taskIntegrity;

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
const failedMutationTask = 'failed-mutation-task';
const embeddedValidationTask = 'embedded-validation-task';
const failedPostCheckTask = 'failed-post-check-task';
const unavailableTrackingTask = 'unavailable-tracking-task';
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
  recordTaskIntegrityEvent(config, event(taskOne, 'relai_begin_work'));
  const initial = readTaskIntegrity(config, taskOne, 'app');
  assert.ok(initial.baseline.changedFiles.includes('ambient.txt'));
  assert.deepEqual(initial.taskOwnedChangedFiles, []);
  assert.equal(initial.mutationGeneration, 0);

  fs.writeFileSync(path.join(workspacePath, 'task-one.js'), 'export const one = 1;\n');
  recordTaskIntegrityEvent(config, event(taskOne, 'relai_edit', { changedFiles: ['task-one.js'] }));
  fs.writeFileSync(path.join(workspacePath, 'task-two.js'), 'export const two = 2;\n');
  recordTaskIntegrityEvent(config, event(taskTwo, 'relai_begin_work'));
  recordTaskIntegrityEvent(config, event(taskTwo, 'relai_edit', { changedFiles: ['task-two.js'] }));

  assert.equal(typeof taskIntegrity.taskOwnedChangedFiles, 'function', 'task integrity must expose exact task-owned changed files');
  assert.deepEqual(taskIntegrity.taskOwnedChangedFiles(config, taskOne, 'app'), ['task-one.js']);

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

  recordTaskIntegrityEvent(config, event(failedMutationTask, 'relai_begin_work'));
  fs.writeFileSync(path.join(workspacePath, 'failed-command.js'), 'export const failed = true;\n');
  recordTaskIntegrityEvent(config, event(failedMutationTask, 'relai_exec', {
    ok: false,
    changedFiles: ['failed-command.js'],
    mutationTracking: 'git'
  }));
  const failedMutation = readTaskIntegrity(config, failedMutationTask, 'app');
  assert.equal(failedMutation.mutationGeneration, 1, 'a failed command that changed files must still advance mutation authority');
  assert.deepEqual(failedMutation.taskOwnedChangedFiles, ['failed-command.js']);

  recordTaskIntegrityEvent(config, event(failedPostCheckTask, 'relai_begin_work'));
  fs.writeFileSync(path.join(workspacePath, 'failed-post-check.js'), 'export const changed = true;\n');
  recordTaskIntegrityEvent(config, event(failedPostCheckTask, 'relai_edit', {
    ok: false,
    changedFiles: ['failed-post-check.js'],
    validationStatus: 'failed',
    validationLevel: 'focused',
    validationFingerprint: 'failed-post-check-fingerprint'
  }));
  const failedPostCheck = readTaskIntegrity(config, failedPostCheckTask, 'app');
  assert.equal(failedPostCheck.mutationGeneration, 1, 'failed post-checks must preserve the edit mutation');
  assert.deepEqual(failedPostCheck.taskOwnedChangedFiles, ['failed-post-check.js']);
  assert.equal(failedPostCheck.validationResult, 'failed');
  recordTaskIntegrityEvent(config, event(embeddedValidationTask, 'relai_begin_work'));
  fs.writeFileSync(path.join(workspacePath, 'embedded.js'), 'export const embedded = true;\n');
  recordTaskIntegrityEvent(config, event(embeddedValidationTask, 'relai_edit', {
    changedFiles: ['embedded.js'],
    validationStatus: 'passed',
    validationLevel: 'focused',
    validationFingerprint: 'embedded-fingerprint'
  }));
  const embedded = readTaskIntegrity(config, embeddedValidationTask, 'app');
  assert.equal(embedded.validationResult, 'passed', 'passing embedded edit checks must establish validation authority');
  assert.equal(embedded.latestValidatedMutationGeneration, embedded.mutationGeneration);
  assert.equal(embedded.validatedRepositoryFingerprint, 'embedded-fingerprint');
  recordTaskIntegrityEvent(config, event(unavailableTrackingTask, 'relai_begin_work'));
  recordTaskIntegrityEvent(config, event(unavailableTrackingTask, 'relai_exec', {
    changedFiles: [],
    mutationTracking: 'unavailable'
  }));
  const unavailableTracking = readTaskIntegrity(config, unavailableTrackingTask, 'app');
  assert.equal(unavailableTracking.mutationGeneration, 0, 'read-only exec must not become a mutation only because tracking is unavailable');
  assert.deepEqual(unavailableTracking.taskOwnedChangedFiles, []);

  const workspaceState = readWorkspaceIntegrity(config, 'app');
  assert.equal(workspaceState.generation, 6);
  assert.equal(workspaceState.lastMutation.taskId, embeddedValidationTask);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Task-local mutation authority, dirty-baseline isolation, validation freshness, and cross-task attribution passed.');
