import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { planEdit } from '../src/executionPlanner.js';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

function createRepo(scripts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-post-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'edit-post-fixture', private: true, scripts }, null, 2));
  fs.writeFileSync(path.join(root, 'app.js'), 'export const value = 1;\n');
  git(root, ['init']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'RelAI Test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

const safeRoot = createRepo({
  lint: 'node -e "setTimeout(() => process.exit(0), 120)"',
  typecheck: 'node -e "setTimeout(() => process.exit(0), 120)"'
});
const safeState = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-post-state-'));
try {
  const result = await planEdit(
    { alias: 'safe', path: safeRoot, commands: {}, testCommands: {} },
    { stateDir: safeState },
    {
      path: 'app.js',
      oldText: 'value = 1',
      newText: 'value = 2',
      runChecks: true,
      returnDiff: true
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.checks.ok, true);
  assert.equal(result.execution.mode, 'parallel');
  assert.equal(result.execution.maxParallelism, 2, 'safe validation and diff should overlap');
  assert.match(String(result.diff.diff || ''), /value = 2/);
} finally {
  fs.rmSync(safeRoot, { recursive: true, force: true });
  fs.rmSync(safeState, { recursive: true, force: true });
}

const unsafeRoot = createRepo({
  build: 'node -e "setTimeout(() => process.exit(0), 40)"'
});
const unsafeState = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-edit-post-state-'));
try {
  const result = await planEdit(
    { alias: 'unsafe', path: unsafeRoot, commands: {}, testCommands: {} },
    { stateDir: unsafeState },
    {
      path: 'app.js',
      oldText: 'value = 1',
      newText: 'value = 2',
      runChecks: true,
      returnDiff: true
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.execution.mode, 'serial');
  assert.equal(result.execution.maxParallelism, 1, 'build validation should remain a barrier before diff');
} finally {
  fs.rmSync(unsafeRoot, { recursive: true, force: true });
  fs.rmSync(unsafeState, { recursive: true, force: true });
}

console.log('Edit post-action parallelism tests passed.');
