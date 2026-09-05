import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as taskIntegrity from '../src/taskIntegrity.js';
const { readTaskIntegrity, readWorkspaceIntegrity, recordTaskIntegrityEvent } = taskIntegrity;

const taskIntegritySource = fs.readFileSync(new URL('../src/taskIntegrity.js', import.meta.url), 'utf8');
assert.doesNotMatch(taskIntegritySource, /execFileSync/, 'task-integrity Git probes must never block the MCP event loop');
assert.match(taskIntegritySource, /await runProcess\('git'/, 'task-integrity Git probes must use the asynchronous process runner');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-integrity-'));
const workspacePath = path.join(root, 'workspace');
const stateDir = path.join(root, 'state');
fs.mkdirSync(workspacePath, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: workspacePath, encoding: 'utf8' });
git('init');
git('config', 'user.email', 'relai@example.test');
git('config', 'user.name', 'RelAI Test');
fs.writeFileSync(path.join(workspacePath, 'ambient.txt'), 'baseline\n');
fs.writeFileSync(path.join(workspacePath, 'shared.js'), 'export const shared = 0;\n');
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
  const integrityLockDir = path.join(stateDir, 'task-integrity');
  const integrityLock = path.join(integrityLockDir, '.lock');
  fs.mkdirSync(integrityLockDir, { recursive: true });
  fs.writeFileSync(integrityLock, 'other-runtime\n', 'utf8');
  await assert.rejects(
    () => recordTaskIntegrityEvent(config, event('lock-contention-task', 'work.begin')),
    error => error?.code === 'TASK_INTEGRITY_PERSISTENCE_FAILED',
    'fresh task-integrity lock contention must fail fast rather than block the MCP event loop'
  );
  fs.rmSync(integrityLock, { force: true });

  await recordTaskIntegrityEvent(config, event(taskOne, 'work.begin'));
  const initial = readTaskIntegrity(config, taskOne, 'app');
  assert.ok(initial.baseline.changedFiles.includes('ambient.txt'));
  assert.deepEqual(initial.taskOwnedChangedFiles, []);
  assert.equal(initial.mutationGeneration, 0);
  assert.deepEqual(taskIntegrity.taskCommitOwnership(config, taskOne, 'app').ownedFiles, []);
  assert.ok(readWorkspaceIntegrity(config, 'app').uncommittedOwners['ambient.txt']?.some(owner => owner !== taskOne), 'pre-existing dirty work must remain an ambient owner rather than becoming task-owned');

  fs.writeFileSync(path.join(workspacePath, 'task-one.js'), 'export const one = 1;\n');
  await recordTaskIntegrityEvent(config, event(taskOne, 'edit', { changedFiles: ['task-one.js'] }));
  await recordTaskIntegrityEvent(config, event(taskTwo, 'work.begin'));
  fs.writeFileSync(path.join(workspacePath, 'task-two.js'), 'export const two = 2;\n');
  await recordTaskIntegrityEvent(config, event(taskTwo, 'edit', { changedFiles: ['task-two.js'] }));
  fs.writeFileSync(path.join(workspacePath, 'shared.js'), 'export const shared = 1;\n');
  await recordTaskIntegrityEvent(config, event(taskOne, 'edit', { changedFiles: ['shared.js'] }));
  fs.writeFileSync(path.join(workspacePath, 'shared.js'), 'export const shared = 2;\n');
  await recordTaskIntegrityEvent(config, event(taskTwo, 'edit', { changedFiles: ['shared.js'] }));

  assert.equal(typeof taskIntegrity.taskOwnedChangedFiles, 'function', 'task integrity must expose exact task-owned changed files');
  assert.deepEqual(taskIntegrity.taskOwnedChangedFiles(config, taskOne, 'app'), ['task-one.js', 'shared.js']);
  assert.deepEqual(taskIntegrity.taskCommitOwnership(config, taskOne, 'app'), {
    ownedFiles: ['shared.js', 'task-one.js'],
    conflictingFiles: ['shared.js']
  }, 'current ownership must distinguish exclusive task paths from shared concurrent paths');

  const one = readTaskIntegrity(config, taskOne, 'app');
  const two = readTaskIntegrity(config, taskTwo, 'app');
  assert.deepEqual(one.taskOwnedChangedFiles, ['task-one.js', 'shared.js']);
  assert.deepEqual(two.taskOwnedChangedFiles, ['task-two.js', 'shared.js']);
  assert.equal(one.taskOwnedChangedFiles.includes('ambient.txt'), false);
  assert.equal(one.taskOwnedChangedFiles.includes('task-two.js'), false);
  assert.equal(two.taskOwnedChangedFiles.includes('task-one.js'), false);
  assert.deepEqual(taskIntegrity.taskCommitOwnership(config, taskTwo, 'app'), {
    ownedFiles: ['shared.js', 'task-two.js'],
    conflictingFiles: ['shared.js']
  });

  await recordTaskIntegrityEvent(config, event(taskOne, 'validate.checks', {
    validationStatus: 'passed',
    validationLevel: 'focused',
    validationFingerprint: 'fingerprint-one',
    validationScope: ['task-one.js', 'package.json']
  }));
  const validated = readTaskIntegrity(config, taskOne, 'app');
  assert.equal(validated.latestValidatedMutationGeneration, validated.mutationGeneration);
  assert.equal(validated.validatedRepositoryFingerprint, 'fingerprint-one');
  assert.deepEqual(validated.validationScope, ['task-one.js', 'package.json']);

  fs.writeFileSync(path.join(workspacePath, 'task-one.js'), 'export const one = 3;\n');
  await recordTaskIntegrityEvent(config, event(taskOne, 'edit', { changedFiles: ['task-one.js'] }));
  const stale = readTaskIntegrity(config, taskOne, 'app');
  assert.equal(stale.validationResult, 'stale');
  assert.notEqual(stale.latestValidatedMutationGeneration, stale.mutationGeneration);

  await recordTaskIntegrityEvent(config, event(failedMutationTask, 'work.begin'));
  fs.writeFileSync(path.join(workspacePath, 'failed-command.js'), 'export const failed = true;\n');
  await recordTaskIntegrityEvent(config, event(failedMutationTask, 'exec', {
    ok: false,
    changedFiles: ['failed-command.js'],
    mutationTracking: 'git'
  }));
  const failedMutation = readTaskIntegrity(config, failedMutationTask, 'app');
  assert.equal(failedMutation.mutationGeneration, 1, 'a failed command that changed files must still advance mutation authority');
  assert.deepEqual(failedMutation.taskOwnedChangedFiles, ['failed-command.js']);

  await recordTaskIntegrityEvent(config, event(failedPostCheckTask, 'work.begin'));
  fs.writeFileSync(path.join(workspacePath, 'failed-post-check.js'), 'export const changed = true;\n');
  await recordTaskIntegrityEvent(config, event(failedPostCheckTask, 'edit', {
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
  await recordTaskIntegrityEvent(config, event(embeddedValidationTask, 'work.begin'));
  fs.writeFileSync(path.join(workspacePath, 'embedded.js'), 'export const embedded = true;\n');
  await recordTaskIntegrityEvent(config, event(embeddedValidationTask, 'edit', {
    changedFiles: ['embedded.js'],
    validationStatus: 'passed',
    validationLevel: 'focused',
    validationFingerprint: 'embedded-fingerprint'
  }));
  const embedded = readTaskIntegrity(config, embeddedValidationTask, 'app');
  assert.equal(embedded.validationResult, 'passed', 'passing embedded edit checks must establish validation authority');
  assert.equal(embedded.latestValidatedMutationGeneration, embedded.mutationGeneration);
  assert.equal(embedded.validatedRepositoryFingerprint, 'embedded-fingerprint');
  await recordTaskIntegrityEvent(config, event(unavailableTrackingTask, 'work.begin'));
  await recordTaskIntegrityEvent(config, event(unavailableTrackingTask, 'exec', {
    changedFiles: [],
    mutationTracking: 'unavailable'
  }));
  const unavailableTracking = readTaskIntegrity(config, unavailableTrackingTask, 'app');
  assert.equal(unavailableTracking.mutationGeneration, 0, 'read-only exec must not become a mutation only because tracking is unavailable');
  assert.deepEqual(unavailableTracking.taskOwnedChangedFiles, []);

  const beforeTaskless = readWorkspaceIntegrity(config, 'app');
  assert.equal(beforeTaskless.generation, 8);
  fs.writeFileSync(path.join(workspacePath, 'task-one.js'), 'export const one = "taskless";\n');
  await recordTaskIntegrityEvent(config, {
    workspace: 'app',
    tool: 'edit',
    ok: true,
    ts: new Date().toISOString(),
    changedFiles: ['task-one.js']
  });
  const workspaceState = readWorkspaceIntegrity(config, 'app');
  assert.equal(workspaceState.generation, 9, 'taskless mutations must advance the same authoritative workspace generation');
  assert.equal(workspaceState.lastMutation.taskId, '', 'taskless mutations must not invent a logical task owner');
  assert.ok(workspaceState.uncommittedOwners['task-one.js']?.includes('@ambient'), 'taskless mutations must remain ambient/unowned');
  assert.ok(taskIntegrity.taskCommitOwnership(config, taskOne, 'app').conflictingFiles.includes('task-one.js'), 'taskless mutation of a task-owned path must become an ownership conflict');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Task-local mutation authority, dirty-baseline isolation, validation freshness, and cross-task attribution passed.');
