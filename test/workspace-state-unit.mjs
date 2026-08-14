import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildWorkspaceStates, onWorkspaceStateChange, resolveGitExecutable } from "../src/workspaceState.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workspace-state-'));
const repo = path.join(sandbox, 'repo');
fs.mkdirSync(repo);

function git(args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
}

try {
  const trustedGit = resolveGitExecutable();
  assert.ok(path.isAbsolute(trustedGit), 'workspace state must use an absolute trusted Git executable');
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'RelAI Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'initial\n');
  git(['add', 'README.md']);
  git(['commit', '-m', 'initial']);
  git(['remote', 'add', 'origin', 'https://example.com/repo.git']);
  fs.appendFileSync(path.join(repo, 'README.md'), 'changed\n');

  const config = {
    stateDir: path.join(sandbox, 'state'),
    workspaces: { repo: { path: repo } }
  };
  const tasks = [{ workspace: 'repo', status: 'completed', validation: 'passed', completedAt: '2026-07-11T06:00:00.000Z' }];
  const activity = { state: 'working', workspace: 'repo', tool: 'relai_read', startedAt: Date.now() };
  let unsubscribe = () => {};
  const refreshedState = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('workspace Git state refresh timed out'));
    }, 5000);
    unsubscribe = onWorkspaceStateChange(event => {
      if (event.alias !== 'repo') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event.state);
    });
  });
  buildWorkspaceStates(config, tasks, activity);
  await refreshedState;
  const states = buildWorkspaceStates(config, tasks, activity);
  const state = states.repo;
  assert.equal(state.exists, true);
  assert.equal(state.isGit, true);
  assert.equal(state.dirty, true);
  assert.equal(state.changedFileCount, 1);
  assert.equal(state.remoteAvailable, true);
  assert.deepEqual(state.remotes, ['origin']);
  assert.ok(state.branch);
  assert.equal(state.lastValidation.status, 'passed');
  assert.equal(state.currentActivity.state, 'working');

  const refreshed = buildWorkspaceStates(config, tasks, { state: 'working', workspace: 'repo', tool: 'relai_edit', startedAt: Date.now() });
  assert.equal(refreshed.repo.currentActivity.tool, 'relai_edit', 'dynamic activity must not be frozen by the Git-state cache');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Operational workspace state tests passed.');
