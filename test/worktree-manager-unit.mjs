import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { createManagedWorktree, listManagedWorktrees, removeManagedWorktree, resolveManagedWorktree } from "../src/worktreeManager.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-worktree-'));
const repository = path.join(root, 'repository');
const stateDir = path.join(root, 'state');
fs.mkdirSync(repository, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
git('init');
git('config', 'user.email', 'relai@example.test');
git('config', 'user.name', 'RelAI Test');
fs.writeFileSync(path.join(repository, 'README.md'), '# fixture\n');
git('add', '.');
git('commit', '-m', 'fixture');
const currentBranch = git('branch', '--show-current').trim();
const config = {
  stateDir,
  workspaces: {
    app: {
      path: repository,
      testCommands: { test: 'node --test' },
      commands: {},
      protectedBranches: [currentBranch],
      defaultBaseBranch: currentBranch,
      allowedRemotes: ['origin'],
      context: { snapshotMaxFiles: 1000 },
      validationRules: {}
    }
  }
};
const workspace = { alias: 'app', ...config.workspaces.app };
const taskContext = { taskId: 'task-worktree' };

try {
  const created = await createManagedWorktree(workspace, config, { name: 'feature', base: currentBranch }, taskContext);
  assert.equal(created.ok, true);
  assert.equal(created.alias, 'app--feature');
  assert.equal(fs.existsSync(created.path), true);
  assert.equal(created.branch, 'relai/feature');

  const dynamic = resolveManagedWorktree(config, created.alias);
  assert.equal(dynamic.alias, created.alias);
  assert.equal(dynamic.sourceAlias, 'app');
  assert.equal(dynamic.managedWorktree, true);
  assert.equal(dynamic.testCommands.test, 'node --test');

  const listed = await listManagedWorktrees(config, { workspace: 'app' }, taskContext);
  assert.equal(listed.count, 1);
  assert.equal(listed.worktrees[0].dirty, false);
  assert.equal((await listManagedWorktrees(config, { workspace: 'app' }, { taskId: 'another-task' })).count, 0);

  fs.writeFileSync(path.join(created.path, 'dirty.txt'), 'dirty\n');
  await assert.rejects(
    () => removeManagedWorktree(workspace, config, { alias: created.alias }, taskContext),
    /dirty/
  );
  await assert.rejects(
    () => removeManagedWorktree(workspace, config, { alias: created.alias }, { taskId: 'another-task' }),
    error => error?.code === 'TASK_OWNERSHIP_MISMATCH'
  );
  fs.rmSync(path.join(created.path, 'dirty.txt'));
  const removed = await removeManagedWorktree(workspace, config, { alias: created.alias }, taskContext);
  assert.equal(removed.ok, true);
  assert.equal(removed.branchPreserved, true);
  assert.equal(fs.existsSync(created.path), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Managed worktree create, resolve, dirty refusal, and removal tests passed.');
