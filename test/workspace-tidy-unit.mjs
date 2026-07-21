import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { workspaceTidyPlan, workspaceTidyRun } = require('../src/localRepoBridge.js');
const { writeSessionPolicy } = require('../src/policyResolver.js');

const GIT_EXECUTABLE = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';

function git(args, cwd) {
  execFileSync(GIT_EXECUTABLE, args, { cwd, stdio: 'pipe' });
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tidy-'));
  git(['init'], dir);
  git(['config', 'user.email', 'test@test.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'initial.txt'), 'init');
  git(['add', '.'], dir);
  git(['commit', '-m', 'init'], dir);
  return dir;
}

// 1. Plan discovers session-owned untracked files and run tidies them by planId.
{
  const dir = makeTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tidy-state-'));
  const workspace = { alias: 'test', path: dir };
  const config = { stateDir };
  try {
    // A session must be active for untracked files to be attributable as
    // session-owned; the artifact is created after the session starts.
    writeSessionPolicy(config, workspace.alias, { workspaceRoot: dir });
    const artifact = path.join(dir, 'generated.svg');
    fs.writeFileSync(artifact, '<svg></svg>');

    const plan = await workspaceTidyPlan(workspace, config, {});
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, 'session_untracked');
    assert.equal(plan.candidateCount, 1);
    assert.equal(plan.candidates[0].path, 'generated.svg');
    assert.ok(plan.planId.startsWith('tidy_'));

    const result = await workspaceTidyRun(workspace, config, { planId: plan.planId });
    assert.equal(result.ok, true);
    assert.equal(result.appliedCount, 1);
    assert.equal(fs.existsSync(artifact), false, 'tidy run should retire the planned artifact');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

// 2. Plan run refuses candidates that changed after planning.
{
  const dir = makeTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tidy-state-'));
  const workspace = { alias: 'test', path: dir };
  const config = { stateDir };
  try {
    writeSessionPolicy(config, workspace.alias, { workspaceRoot: dir });
    const artifact = path.join(dir, 'generated.svg');
    fs.writeFileSync(artifact, '<svg>old</svg>');
    const plan = await workspaceTidyPlan(workspace, config, {});
    fs.writeFileSync(artifact, '<svg>changed</svg>');

    const result = await workspaceTidyRun(workspace, config, { planId: plan.planId });
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(result.refused.length, 1);
    assert.match(result.refused[0].reason, /sha256 mismatch/);
    assert.equal(fs.readFileSync(artifact, 'utf8'), '<svg>changed</svg>');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

console.log('workspace tidy unit tests passed.');
