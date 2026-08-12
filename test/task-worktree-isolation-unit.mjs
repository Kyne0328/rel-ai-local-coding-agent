import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { GIT_EXECUTABLE } from './helpers/git-executable.mjs';
import {
  ensureTaskWorktree,
  integrateTaskWorktree,
  managedTaskWorktreeEntry,
  taskExecutionWorkspace
} from '../src/worktreeManager.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-worktree-'));
const repo = path.join(root, 'repo');
const stateDir = path.join(root, 'state');
fs.mkdirSync(repo, { recursive: true });

const git = (...args) => execFileSync(GIT_EXECUTABLE, args, { cwd: repo, encoding: 'utf8' }).trim();
const write = (relative, content) => {
  const target = path.join(repo, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const readNormalized = target => fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n');

try {
  git('init');
  git('config', 'core.autocrlf', 'true');
  write('a.txt', 'a0\n');
  write('b.txt', 'b0\n');
  git('add', '-A');
  git('-c', 'user.name=Rel.AI Test', '-c', 'user.email=test@relai.local', 'commit', '-m', 'initial');

  write('baseline.txt', 'baseline untracked\n');
  write('a.txt', 'a0\nsource dirty baseline\n');

  const branch = git('branch', '--show-current');
  const workspace = {
    alias: 'repo',
    path: repo,
    defaultBaseBranch: branch,
    protectedBranches: ['main', 'master'],
    allowedRemotes: ['origin'],
    testCommands: {},
    commands: {},
    context: {},
    validationRules: {}
  };
  const config = { stateDir, maxOutputBytes: 2 * 1024 * 1024, workspaces: { repo: workspace } };

  const readOnlyBeforeMutation = await taskExecutionWorkspace(workspace, config, 'task-a', 'relai_read');
  assert.equal(readOnlyBeforeMutation.alias, 'repo');
  assert.equal(managedTaskWorktreeEntry(config, 'repo', 'task-a'), null);

  const runtimeA = await taskExecutionWorkspace(workspace, config, 'task-a', 'relai_edit');
  const taskA = managedTaskWorktreeEntry(config, 'repo', 'task-a');
  const runtimeARead = await taskExecutionWorkspace(workspace, config, 'task-a', 'relai_read');
  assert.equal(runtimeA.alias, taskA.alias);
  assert.equal(runtimeARead.alias, taskA.alias);

  const taskB = await ensureTaskWorktree(workspace, config, 'task-b');
  assert.notEqual(taskA.path, taskB.path);
  assert.equal(fs.readFileSync(path.join(taskA.path, 'a.txt'), 'utf8'), fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(taskA.path, 'baseline.txt'), 'utf8'), fs.readFileSync(path.join(repo, 'baseline.txt'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(taskB.path, 'a.txt'), 'utf8'), fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'));

  fs.writeFileSync(path.join(taskA.path, 'a.txt'), 'a0\nsource dirty baseline\ntask a\n');
  fs.writeFileSync(path.join(taskB.path, 'b.txt'), 'b0\ntask b\n');

  const integratedA = await integrateTaskWorktree(workspace, config, 'task-a');
  assert.equal(integratedA.integrated, true);
  assert.deepEqual(integratedA.changedFiles, ['a.txt']);
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'a0\nsource dirty baseline\ntask a\n');
  assert.equal(readNormalized(path.join(repo, 'baseline.txt')), 'baseline untracked\n');
  assert.equal(managedTaskWorktreeEntry(config, 'repo', 'task-a'), null);

  const integratedB = await integrateTaskWorktree(workspace, config, 'task-b');
  assert.equal(integratedB.integrated, true);
  assert.deepEqual(integratedB.changedFiles, ['b.txt']);
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'b0\ntask b\n');

  const taskC = await ensureTaskWorktree(workspace, config, 'task-c');
  const taskD = await ensureTaskWorktree(workspace, config, 'task-d');
  fs.writeFileSync(path.join(taskC.path, 'a.txt'), 'task c owns this line\n');
  fs.writeFileSync(path.join(taskD.path, 'a.txt'), 'task d owns this line\n');

  await integrateTaskWorktree(workspace, config, 'task-c');
  await assert.rejects(
    () => integrateTaskWorktree(workspace, config, 'task-d'),
    error => error?.code === 'TASK_INTEGRATION_CONFLICT'
  );
  assert.equal(readNormalized(path.join(repo, 'a.txt')), 'task c owns this line\n');
  assert.ok(managedTaskWorktreeEntry(config, 'repo', 'task-d'), 'conflicting task worktree must be preserved');

  console.log('Task worktree isolation and integration tests passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
