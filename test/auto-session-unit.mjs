import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GIT_EXECUTABLE } from './helpers/git-executable.mjs';

function git(args, options = {}) {
  return execFileSync(GIT_EXECUTABLE, args, options);
}

import { ensureSessionStarted, touchSessionPolicy, readSessionPolicy, resolvePolicy, writeSessionPolicy, POLICY_CACHE_RECHECK_MS, SESSION_IDLE_TTL_MS } from "../src/policyResolver.js";
import { relaiRead, workspaceTidyPlan } from "../src/localRepoBridge.js";

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-auto-session-'));
  const workspacePath = path.join(root, 'workspace');
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Auto session\n');
  git(['init'], { cwd: workspacePath, stdio: 'ignore' });
  git(['config', 'user.email', 'relai@example.test'], { cwd: workspacePath });
  git(['config', 'user.name', 'RelAI Auto'], { cwd: workspacePath });
  git(['add', '.'], { cwd: workspacePath });
  git(['commit', '-m', 'init'], { cwd: workspacePath, stdio: 'ignore' });
  return { root, workspacePath, stateDir: path.join(root, 'state') };
}

const sessionFile = (stateDir, alias, taskId) => path.join(stateDir, 'sessions', `${encodeURIComponent(alias)}--${encodeURIComponent(taskId)}-policy.json`);

// 1. ensureSessionStarted creates a session and captures the pre-write baseline.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  // A pre-existing untracked file must be fenced as baseline, not session-owned.
  fs.writeFileSync(path.join(workspacePath, 'preexisting.txt'), 'user file\n');
  const started = await ensureSessionStarted(config, 'ws', workspacePath, { taskId: 'task-baseline' });
  assert.equal(started, true, 'first call must start a session');
  const policy = resolvePolicy({ alias: 'ws', path: workspacePath }, config);
  assert.equal(policy.sessionActive, true);
  assert.equal(policy.baselineCaptured, true);
  assert.equal(policy.trusted, true);
  assert.ok(policy.baselineDirty.includes('preexisting.txt'), 'pre-existing untracked file must be in baseline');
  fs.rmSync(root, { recursive: true, force: true });
}

// 2b. A new task ID must recapture ownership rather than inheriting another task.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  await ensureSessionStarted(config, 'ws', workspacePath, { taskId: 'task-a' });
  fs.writeFileSync(path.join(workspacePath, 'between-tasks.txt'), 'new baseline\n');
  const restarted = await ensureSessionStarted(config, 'ws', workspacePath, { taskId: 'task-b' });
  assert.equal(restarted, true);
  const sessionA = readSessionPolicy(config, 'ws', 'task-a');
  const sessionB = readSessionPolicy(config, 'ws', 'task-b');
  assert.equal(sessionA.taskId, 'task-a');
  assert.equal(sessionB.taskId, 'task-b');
  assert.ok(sessionB.baselineDirty.includes('between-tasks.txt'));
  assert.equal(readSessionPolicy(config, 'ws'), null, 'implicit policy lookup must reject multiple active tasks');
  fs.rmSync(root, { recursive: true, force: true });
}

// 2. ensureSessionStarted is idempotent — a second call does not restart or
//    recapture the baseline; it only refreshes the idle clock.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  const taskId = 'task-idempotent';
  await ensureSessionStarted(config, 'ws', workspacePath, { taskId });
  const first = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws', taskId), 'utf8'));
  // New file appears AFTER the session started — it must NOT enter the baseline.
  fs.writeFileSync(path.join(workspacePath, 'session-made.txt'), 'agent file\n');
  const startedAgain = await ensureSessionStarted(config, 'ws', workspacePath, { taskId });
  assert.equal(startedAgain, false, 'second call must not start a new session');
  const second = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws', taskId), 'utf8'));
  assert.equal(second.createdAt, first.createdAt, 'createdAt must be preserved');
  assert.ok(!(second.baselineDirty || []).includes('session-made.txt'), 'post-session file must not enter baseline');
  fs.rmSync(root, { recursive: true, force: true });
}

// 3. Idle TTL — a session whose last activity is older than the TTL is treated as
//    expired (readSessionPolicy returns null), so the next write recaptures.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  const taskId = 'task-expired';
  await writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath, taskId });
  const file = sessionFile(stateDir, 'ws', taskId);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.updatedAt = new Date(Date.now() - SESSION_IDLE_TTL_MS - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(data));
  await new Promise(resolve => setTimeout(resolve, POLICY_CACHE_RECHECK_MS + 20));
  assert.equal(readSessionPolicy(config, 'ws', taskId), null, 'stale session must read as expired after the bounded external-file cache window');
  const restarted = await ensureSessionStarted(config, 'ws', workspacePath, { taskId });
  assert.equal(restarted, true, 'expired session must be restartable');
  fs.rmSync(root, { recursive: true, force: true });
}

// 4. touchSessionPolicy refreshes updatedAt without touching the baseline.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  fs.writeFileSync(path.join(workspacePath, 'preexisting.txt'), 'user file\n');
  const taskId = 'task-touch';
  await writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath, taskId });
  const before = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws', taskId), 'utf8'));
  before.updatedAt = new Date(Date.now() - 60_000).toISOString();
  fs.writeFileSync(sessionFile(stateDir, 'ws', taskId), JSON.stringify(before));
  await new Promise(resolve => setTimeout(resolve, POLICY_CACHE_RECHECK_MS + 20));
  const ok = touchSessionPolicy(config, 'ws', taskId);
  assert.equal(ok, true);
  const after = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws', taskId), 'utf8'));
  assert.ok(Date.parse(after.updatedAt) > Date.parse(before.updatedAt), 'updatedAt must advance');
  assert.deepEqual(after.baselineDirty, before.baselineDirty, 'baseline must be untouched');
  fs.rmSync(root, { recursive: true, force: true });
}

// 5. Tidy-plan safety fence — with NO session baseline, relai_changes tidy_plan refuses
//    instead of offering pre-existing untracked files for deletion.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  fs.writeFileSync(path.join(workspacePath, 'user-untracked.txt'), 'not from any session\n');
  const plan = await workspaceTidyPlan({ alias: 'ws', path: workspacePath }, config, { mode: 'session_untracked' });
  assert.equal(plan.ok, false, 'tidy must refuse without a session baseline');
  assert.equal(plan.reason, 'no_session_baseline');
  assert.equal(plan.candidateCount, 0);
  assert.deepEqual(plan.candidates, []);
  fs.rmSync(root, { recursive: true, force: true });
}

// 6. Tidy-plan WITH a session only offers session-owned untracked files, never
//    the pre-existing baseline file.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  fs.writeFileSync(path.join(workspacePath, 'pre-existing.txt'), 'baseline\n');
  await writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath, taskId: 'task-tidy' });
  fs.writeFileSync(path.join(workspacePath, 'session-artifact.txt'), 'made during session\n');
  const plan = await workspaceTidyPlan({ alias: 'ws', path: workspacePath }, config, { mode: 'session_untracked' });
  assert.equal(plan.ok, true);
  const paths = new Set(plan.candidates.map((c) => c.path));
  assert.ok(paths.has('session-artifact.txt'), 'session file must be a candidate');
  assert.ok(!paths.has('pre-existing.txt'), 'baseline file must never be a tidy candidate');
  fs.rmSync(root, { recursive: true, force: true });
}

// 7. Repeated reads during an active session must return cached text instead of
//    misclassifying the cache hit as a binary file.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  const workspace = { alias: 'ws', path: workspacePath };
  await writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath, taskId: 'task-read' });
  const first = relaiRead(workspace, config, { paths: ['README.md'] });
  const second = relaiRead(workspace, config, { paths: ['README.md'] });
  assert.equal(first.items[0]?.content, '# Auto session\n');
  assert.equal(first.items[0]?.cacheHit, false);
  assert.equal(second.items[0]?.content, '# Auto session\n');
  assert.equal(second.items[0]?.cacheHit, true);
  assert.deepEqual(second.skipped, []);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('auto-session unit tests passed.');
