import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { workspaceTidyPlan, workspaceTidyRun } from '../src/localRepoBridge.js';
import { writeSessionPolicy } from '../src/policyResolver.js';
import { GIT_EXECUTABLE } from './helpers/git-executable.mjs';

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
  const workId = 'task-tidy-1';
  try {
    await writeSessionPolicy(config, workspace.alias, { workspaceRoot: dir, taskId: workId });
    const artifact = path.join(dir, 'generated.svg');
    fs.writeFileSync(artifact, '<svg></svg>');

    const plan = await workspaceTidyPlan(workspace, config, { work_id: workId });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, 'session_untracked');
    assert.equal(plan.candidateCount, 1);
    assert.equal(plan.candidates[0].path, 'generated.svg');

    const result = await workspaceTidyRun(workspace, config, { work_id: workId, planId: plan.planId });
    assert.equal(result.ok, true);
    assert.equal(result.appliedCount, 1);
    assert.equal(fs.existsSync(artifact), false);
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
  const workId = 'task-tidy-2';
  try {
    await writeSessionPolicy(config, workspace.alias, { workspaceRoot: dir, taskId: workId });
    const artifact = path.join(dir, 'generated.svg');
    fs.writeFileSync(artifact, '<svg>old</svg>');
    const plan = await workspaceTidyPlan(workspace, config, { work_id: workId });
    fs.writeFileSync(artifact, '<svg>changed</svg>');

    const result = await workspaceTidyRun(workspace, config, { work_id: workId, planId: plan.planId });
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.match(result.refused[0].reason, /sha256 mismatch/);
    assert.equal(fs.readFileSync(artifact, 'utf8'), '<svg>changed</svg>');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

// 3. Explicit work_id selects the correct baseline when two tasks share a workspace.
{
  const dir = makeTempRepo();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tidy-state-'));
  const workspace = { alias: 'test', path: dir };
  const config = { stateDir };
  try {
    await writeSessionPolicy(config, workspace.alias, { workspaceRoot: dir, taskId: 'task-a' });
    fs.writeFileSync(path.join(dir, 'from-a.tmp'), 'a');
    await writeSessionPolicy(config, workspace.alias, { workspaceRoot: dir, taskId: 'task-b' });
    fs.writeFileSync(path.join(dir, 'from-b.tmp'), 'b');

    const plan = await workspaceTidyPlan(workspace, config, { work_id: 'task-b' });
    assert.deepEqual(plan.candidates.map(item => item.path), ['from-b.tmp'], 'task B must not claim task A pre-existing untracked output');
    await assert.rejects(
      () => workspaceTidyRun(workspace, config, { work_id: 'task-a', planId: plan.planId }),
      /different work session/i,
      'a tidy plan must remain bound to the task whose baseline produced it'
    );
    const result = await workspaceTidyRun(workspace, config, { work_id: 'task-b', planId: plan.planId });
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(dir, 'from-a.tmp')), true);
    assert.equal(fs.existsSync(path.join(dir, 'from-b.tmp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

console.log('workspace tidy ownership and preflight unit tests passed.');
