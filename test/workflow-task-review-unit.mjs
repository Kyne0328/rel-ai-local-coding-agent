import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { relaiDiff } from '../src/bridge/review.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-review-'));
try {
  fs.writeFileSync(path.join(root, 'task.txt'), 'base task\n');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'base unrelated\n');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
  fs.writeFileSync(path.join(root, 'task.txt'), 'changed task\n');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'changed unrelated\n');
  const workspace = { alias: 'repo', path: root };
  const config = {};

  const taskOnly = await relaiDiff(workspace, config, { _taskOwnedPaths: ['task.txt'] });
  assert.equal(taskOnly.reviewScope, 'task');
  assert.equal(taskOnly.reviewedScope, 'task');
  assert.match(taskOnly.reviewHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(taskOnly.reviewedFiles, ['task.txt']);
  assert.deepEqual(taskOnly.excludedWorkspaceFiles, ['unrelated.txt']);
  assert.match(taskOnly.diff, /task\.txt/);
  assert.doesNotMatch(taskOnly.diff, /unrelated\.txt/);

  const workspaceWide = await relaiDiff(workspace, config, { _taskOwnedPaths: ['task.txt'], scope: 'workspace' });
  assert.equal(workspaceWide.reviewScope, 'workspace');
  assert.equal(workspaceWide.reviewedScope, 'workspace');
  assert.deepEqual(new Set(workspaceWide.reviewedFiles), new Set(['task.txt', 'unrelated.txt']));
  assert.match(workspaceWide.diff, /task\.txt/);
  assert.match(workspaceWide.diff, /unrelated\.txt/);

  await assert.rejects(
    () => relaiDiff(workspace, config, { _taskOwnedPaths: ['task.txt'], path: 'unrelated.txt' }),
    /task-owned review scope/i
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Task-owned review scoping tests passed.');