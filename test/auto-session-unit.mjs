import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

function git(args, options = {}) { // NOSONAR - these unit tests intentionally execute the local Git binary.
  return execFileSync('git', args, options);
}

const require = createRequire(import.meta.url);
const {
  ensureSessionStarted,
  touchSessionPolicy,
  readSessionPolicy,
  resolvePolicy,
  writeSessionPolicy,
  SESSION_IDLE_TTL_MS
} = require('../src/policyResolver.js');
const { workspaceTidyPlan } = require('../src/localRepoBridge.js');

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

const sessionFile = (stateDir, alias) => path.join(stateDir, 'sessions', `${alias}-policy.json`);

// 1. ensureSessionStarted creates a session and captures the pre-write baseline.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  // A pre-existing untracked file must be fenced as baseline, not session-owned.
  fs.writeFileSync(path.join(workspacePath, 'preexisting.txt'), 'user file\n');
  const started = ensureSessionStarted(config, 'ws', workspacePath);
  assert.equal(started, true, 'first call must start a session');
  const policy = resolvePolicy({ alias: 'ws', path: workspacePath }, config);
  assert.equal(policy.sessionActive, true);
  assert.ok(policy.baselineDirty.includes('preexisting.txt'), 'pre-existing untracked file must be in baseline');
  fs.rmSync(root, { recursive: true, force: true });
}

// 2. ensureSessionStarted is idempotent — a second call does not restart or
//    recapture the baseline; it only refreshes the idle clock.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  ensureSessionStarted(config, 'ws', workspacePath);
  const first = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws'), 'utf8'));
  // New file appears AFTER the session started — it must NOT enter the baseline.
  fs.writeFileSync(path.join(workspacePath, 'session-made.txt'), 'agent file\n');
  const startedAgain = ensureSessionStarted(config, 'ws', workspacePath);
  assert.equal(startedAgain, false, 'second call must not start a new session');
  const second = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws'), 'utf8'));
  assert.equal(second.createdAt, first.createdAt, 'createdAt must be preserved');
  assert.ok(!(second.baselineDirty || []).includes('session-made.txt'), 'post-session file must not enter baseline');
  fs.rmSync(root, { recursive: true, force: true });
}

// 3. Idle TTL — a session whose last activity is older than the TTL is treated as
//    expired (readSessionPolicy returns null), so the next write recaptures.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath });
  const file = sessionFile(stateDir, 'ws');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.updatedAt = new Date(Date.now() - SESSION_IDLE_TTL_MS - 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(data));
  assert.equal(readSessionPolicy(config, 'ws'), null, 'stale session must read as expired');
  const restarted = ensureSessionStarted(config, 'ws', workspacePath);
  assert.equal(restarted, true, 'expired session must be restartable');
  fs.rmSync(root, { recursive: true, force: true });
}

// 4. touchSessionPolicy refreshes updatedAt without touching the baseline.
{
  const { root, workspacePath, stateDir } = makeRepo();
  const config = { stateDir };
  fs.writeFileSync(path.join(workspacePath, 'preexisting.txt'), 'user file\n');
  writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath });
  const before = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws'), 'utf8'));
  before.updatedAt = new Date(Date.now() - 60_000).toISOString();
  fs.writeFileSync(sessionFile(stateDir, 'ws'), JSON.stringify(before));
  const ok = touchSessionPolicy(config, 'ws');
  assert.equal(ok, true);
  const after = JSON.parse(fs.readFileSync(sessionFile(stateDir, 'ws'), 'utf8'));
  assert.ok(Date.parse(after.updatedAt) > Date.parse(before.updatedAt), 'updatedAt must advance');
  assert.deepEqual(after.baselineDirty, before.baselineDirty, 'baseline must be untouched');
  fs.rmSync(root, { recursive: true, force: true });
}

// 5. Tidy-plan safety fence — with NO session baseline, relai_tidy_plan refuses
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
  writeSessionPolicy(config, 'ws', { workspaceRoot: workspacePath });
  fs.writeFileSync(path.join(workspacePath, 'session-artifact.txt'), 'made during session\n');
  const plan = await workspaceTidyPlan({ alias: 'ws', path: workspacePath }, config, { mode: 'session_untracked' });
  assert.equal(plan.ok, true);
  const paths = new Set(plan.candidates.map((c) => c.path));
  assert.ok(paths.has('session-artifact.txt'), 'session file must be a candidate');
  assert.ok(!paths.has('pre-existing.txt'), 'baseline file must never be a tidy candidate');
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('auto-session unit tests passed.');
