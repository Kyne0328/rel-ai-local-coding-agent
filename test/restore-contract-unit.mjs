import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { relaiResetWorkspace, relaiRestorePaths } from "../src/bridge/restore.js";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-restore-contract-'));
const repo = path.join(temp, 'repo');
fs.mkdirSync(repo, { recursive: true });

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

function write(relativePath, content) {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function read(relativePath) {
  return fs.readFileSync(path.join(repo, relativePath), 'utf8').replaceAll('\r\n', '\n');
}

const workspace = { alias: 'repo', path: repo };

try {
  git('init', '-q');
  git('config', 'user.email', 'restore-test@example.com');
  git('config', 'user.name', 'Restore Contract Test');
  write('tracked.txt', 'saved\n');
  git('add', 'tracked.txt');
  git('commit', '-qm', 'initial');

  write('tracked.txt', 'changed\n');
  write('untracked.txt', 'keep\n');
  const scoped = await relaiRestorePaths(workspace, {}, { paths: ['tracked.txt'] });
  assert.equal(scoped.ok, true);
  assert.equal(read('tracked.txt'), 'saved\n');
  assert.equal(fs.existsSync(path.join(repo, 'untracked.txt')), true, 'scoped restore must not remove untracked files');

  write('tracked.txt', 'changed again\n');
  const trackedReset = await relaiResetWorkspace(workspace, {}, {});
  assert.equal(trackedReset.ok, true);
  assert.equal(trackedReset.removeUntracked, false);
  assert.equal(read('tracked.txt'), 'saved\n');
  assert.equal(fs.existsSync(path.join(repo, 'untracked.txt')), true, 'tracked-only reset must leave untracked files intact');

  write('tracked.txt', 'changed for clean\n');
  write('nested/generated.txt', 'remove\n');
  const cleanReset = await relaiResetWorkspace(workspace, {}, { removeUntracked: true });
  assert.equal(cleanReset.ok, true);
  assert.equal(cleanReset.removeUntracked, true);
  assert.equal(read('tracked.txt'), 'saved\n');
  assert.equal(fs.existsSync(path.join(repo, 'untracked.txt')), false);
  assert.equal(fs.existsSync(path.join(repo, 'nested')), false);

  console.log('Restore contract passed for scoped restore and approval-owned workspace reset semantics.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
