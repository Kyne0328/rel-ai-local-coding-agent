import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GIT_EXECUTABLE = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';

function git(args, options = {}) {
  return spawnSync(GIT_EXECUTABLE, args, options);
}

import { writeSessionPolicy, resolvePolicy, captureBaselineDirty } from "../src/policyResolver.js";
import { classifyStatusOwnership } from "../src/localRepoBridge.js";

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-baseline-'));
  const run = (args) => git(args, { cwd: root, encoding: 'utf8' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n');
  run(['add', 'tracked.txt']);
  run(['commit', '-qm', 'init']);
  return root;
}

// 1. captureBaselineDirty returns dirty file list from real git status
{
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'pre-existing.txt'), 'dirty\n');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'modified\n');
  const baseline = captureBaselineDirty(repo);
  assert.ok(baseline.includes('pre-existing.txt'), 'untracked file must appear in baseline');
  assert.ok(baseline.includes('tracked.txt'), 'modified tracked file must appear in baseline');
  fs.rmSync(repo, { recursive: true, force: true });
}

// 2. captureBaselineDirty returns [] for non-git dir
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-baseline-nogit-'));
  const baseline = captureBaselineDirty(dir);
  assert.deepEqual(baseline, [], 'non-git dir must return empty array');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 3. captureBaselineDirty with null/undefined → []
assert.deepEqual(captureBaselineDirty(null), []);
assert.deepEqual(captureBaselineDirty(undefined), []);
assert.deepEqual(captureBaselineDirty(''), []);

// 4. writeSessionPolicy persists baselineDirty and resolvePolicy exposes it
{
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'leftover.txt'), 'x\n');
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-pr-'));
  const config = { stateDir };
  writeSessionPolicy(config, 'myapp', { taskHint: 'fix bug', workspaceRoot: repo });
  const policy = resolvePolicy({ alias: 'myapp', path: repo }, config);
  assert.equal(policy.sessionActive, true);
  assert.ok(Array.isArray(policy.baselineDirty), 'baselineDirty must be array');
  assert.ok(policy.baselineDirty.includes('leftover.txt'), 'pre-existing dirty file must be in policy.baselineDirty');
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 5. classifyStatusOwnership splits files into baseline vs. session
{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-pr-'));
  const config = { stateDir };
  // Seed session file with baseline
  writeSessionPolicy(config, 'myapp', { taskHint: 'x' });
  // Manually inject baselineDirty into the session file
  const sessionFile = path.join(stateDir, 'sessions', 'myapp-policy.json');
  const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  data.baselineDirty = ['old/generated.cmake', 'old/registrant.swift'];
  data.baselineCaptured = true;
  fs.writeFileSync(sessionFile, JSON.stringify(data));

  const statusOutput = ' M old/generated.cmake\n M old/registrant.swift\n M lib/new_edit.dart\n?? new/untracked.dart\n';
  const workspace = { alias: 'myapp' };
  const { sessionChanged, baselineChanged, baselineSource } = classifyStatusOwnership(workspace, config, statusOutput);
  assert.deepEqual([...baselineChanged].sort((a, b) => a.localeCompare(b)), ['old/generated.cmake', 'old/registrant.swift']);
  assert.deepEqual([...sessionChanged].sort((a, b) => a.localeCompare(b)), ['lib/new_edit.dart', 'new/untracked.dart']);
  assert.equal(baselineSource, 'session');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 6. classifyStatusOwnership with no session: ownership is UNKNOWN, not session.
// Claiming session ownership without a captured baseline is a safety bug: it let
// relai_tidy_plan treat pre-existing untracked user files as disposable session
// artifacts. With no session the session-owned arrays must stay empty.
{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-pr-'));
  const config = { stateDir };
  const workspace = { alias: 'noses' };
  const statusOutput = ' M a.txt\n M b.txt\n?? c.txt\n';
  const { sessionChanged, baselineChanged, untrackedSession, unknownChanged, untrackedUnknown, hasSession, baselineSource } = classifyStatusOwnership(workspace, config, statusOutput);
  assert.deepEqual(sessionChanged, []);
  assert.deepEqual(untrackedSession, []);
  assert.deepEqual(baselineChanged, []);
  assert.deepEqual([...unknownChanged].sort((a, b) => a.localeCompare(b)), ['a.txt', 'b.txt', 'c.txt']);
  assert.deepEqual(untrackedUnknown, ['c.txt']);
  assert.equal(hasSession, false);
  assert.equal(baselineSource, null);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// 7. Rename status line ("R  from -> to") classifies destination file
{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-pr-'));
  const config = { stateDir };
  writeSessionPolicy(config, 'myapp', {});
  const sessionFile = path.join(stateDir, 'sessions', 'myapp-policy.json');
  const data = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  data.baselineDirty = ['lib/old/zone_validator.dart'];
  data.baselineCaptured = true;
  fs.writeFileSync(sessionFile, JSON.stringify(data));
  const status = 'R  lib/old/zone_validator.dart -> lib/new/schedule_validator.dart\n';
  const { sessionChanged, baselineChanged } = classifyStatusOwnership({ alias: 'myapp' }, config, status);
  // Destination path is what shows in current worktree, so classify on destination
  assert.deepEqual(sessionChanged, ['lib/new/schedule_validator.dart']);
  assert.deepEqual(baselineChanged, []);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('baseline-tracking unit tests passed.');
