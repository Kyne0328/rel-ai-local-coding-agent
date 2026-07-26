import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { workspaceGitStatus } = require('../src/repo/gitOps.js');
const { relaiDiff } = require('../src/bridge/review.js');
const { writeSessionPolicy, captureBaselineDirty } = require('../src/policyResolver.js');

const gitExecutable = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-status-z-'));
const stateDir = path.join(root, '.state');
const workspace = { alias: 'repo', path: root };
const config = { stateDir };
const git = (args) => execFileSync(gitExecutable, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

try {
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Rel AI Status Test']);
  fs.writeFileSync(path.join(root, 'space file.txt'), 'space base\n');
  fs.writeFileSync(path.join(root, 'café.txt'), 'unicode base\n');
  fs.writeFileSync(path.join(root, 'old name.txt'), 'rename base\n');
  git(['add', '.']);
  git(['commit', '-qm', 'base']);

  writeSessionPolicy(config, workspace.alias, { workspaceRoot: root });
  fs.appendFileSync(path.join(root, 'space file.txt'), 'space changed\n');
  fs.appendFileSync(path.join(root, 'café.txt'), 'unicode changed\n');
  git(['mv', 'old name.txt', 'new café name.txt']);
  fs.writeFileSync(path.join(root, 'untracked café file.txt'), 'untracked\n');

  const status = await workspaceGitStatus(workspace, config);
  assert.equal(status.ok, true);
  const paths = new Set(status.statusEntries.map((entry) => entry.path));
  for (const expected of ['space file.txt', 'café.txt', 'new café name.txt', 'untracked café file.txt']) {
    assert.ok(paths.has(expected), `status must preserve exact path: ${expected}`);
    assert.match(status.status, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const rename = status.statusEntries.find((entry) => entry.path === 'new café name.txt');
  assert.equal(rename.originalPath, 'old name.txt');

  const review = await relaiDiff(workspace, config, {});
  assert.match(review.diff, /space changed/);
  assert.match(review.diff, /unicode changed/);
  assert.ok(review.statusEntries.some((entry) => entry.path === 'café.txt'));
  assert.ok(review.statusEntries.some((entry) => entry.path === 'space file.txt'));

  const baseline = captureBaselineDirty(root);
  assert.ok(baseline.includes('café.txt'));
  assert.ok(baseline.includes('space file.txt'));
  assert.ok(baseline.includes('new café name.txt'));
  assert.ok(baseline.includes('untracked café file.txt'));

  console.log('NUL-delimited Git status preserves quoted and non-ASCII paths.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
