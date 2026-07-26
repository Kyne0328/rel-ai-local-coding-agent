import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiStatus } = require('../src/tools/status.js');
const { relaiGitCommit } = require('../src/repo/gitOps.js');
const { writeSessionPolicy } = require('../src/policyResolver.js');

const gitExecutable = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-status-contract-'));
const repo = path.join(temp, 'repo');
fs.mkdirSync(repo, { recursive: true });

function git(args) {
  return execFileSync(gitExecutable, args, { cwd: repo, encoding: 'utf8' });
}

try {
  git(['init', '-q']);
  git(['config', 'user.email', 'status-test@example.com']);
  git(['config', 'user.name', 'Status Contract Test']);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'saved\n');
  git(['add', 'tracked.txt']);
  git(['commit', '-qm', 'initial']);
  git(['branch', '-M', 'main']);

  const workspace = {
    alias: 'app',
    path: repo,
    commands: { build: 'npm run build' },
    testCommands: { test: 'npm test' }
  };
  const config = {
    stateDir: path.join(temp, 'state'),
    workspaces: { app: workspace }
  };

  writeSessionPolicy(config, workspace.alias, { workspaceRoot: repo });
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'changed\n');
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'new\n');

  const combined = await relaiStatus(config, { workspace: 'app' });
  assert.equal(combined.ok, true);
  assert.equal(combined.workspace.alias, 'app');
  assert.equal(combined.workspace.repository.ok, true);
  assert.equal(combined.workspace.repository.branch, 'main');
  assert.ok(combined.workspace.repository.changedFiles.includes('tracked.txt'));
  assert.ok(combined.workspace.repository.untrackedFiles.includes('untracked.txt'));
  assert.ok(combined.workspace.repository.sessionChangedFiles.includes('tracked.txt'));
  assert.ok(combined.workspace.repository.untrackedSessionFiles.includes('untracked.txt'));
  assert.equal(combined.workspace.repository.deprecated, undefined, 'primary status must not carry compatibility metadata');

  const commitPlan = await relaiGitCommit(workspace, config, {
    message: 'status contract dry run',
    dryRun: true
  });
  assert.equal(commitPlan.ok, true);
  assert.equal(commitPlan.status.deprecated, undefined, 'internal commit status must use the shared core without legacy metadata');
  assert.equal(commitPlan.status.branch, 'main');

  console.log('Combined workspace and repository status contract passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
