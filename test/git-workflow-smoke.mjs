import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  relaiGitStatus,
  relaiGitCommit,
  relaiGitPush,
  relaiGitMergeBranch,
  relaiGitMergeRemoteBranchesPlan
} = require('../src/localRepoBridge.js');

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-git-workflow-'));
  const remote = path.join(root, 'remote.git');
  const workspacePath = path.join(root, 'workspace');
  fs.mkdirSync(workspacePath, { recursive: true });
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['init'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'relai@example.test'], { cwd: workspacePath });
  execFileSync('git', ['config', 'user.name', 'RelAI Git Smoke'], { cwd: workspacePath });
  fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Git smoke\n');
  execFileSync('git', ['add', 'README.md'], { cwd: workspacePath });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: workspacePath });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: workspacePath });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', 'production'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['push', '-u', 'origin', 'production'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', 'feature/ui-cleanup'], { cwd: workspacePath, stdio: 'ignore' });
  fs.writeFileSync(path.join(workspacePath, 'ui.txt'), 'feature branch\n');
  execFileSync('git', ['add', 'ui.txt'], { cwd: workspacePath });
  execFileSync('git', ['commit', '-m', 'feature'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['push', '-u', 'origin', 'feature/ui-cleanup'], { cwd: workspacePath, stdio: 'ignore' });
  execFileSync('git', ['checkout', 'main'], { cwd: workspacePath, stdio: 'ignore' });
  return { root, workspacePath };
}

const { root, workspacePath } = makeRepo();
const workspace = {
  alias: 'smoke',
  path: workspacePath,
  protectedBranches: ['main', 'production'],
  defaultBaseBranch: 'main',
  allowedRemotes: ['origin'],
  testCommands: {},
  commands: {},
  fastTask: { enabled: false }
};
const config = { stateDir: path.join(root, 'state'), workflow: { prepared: { requireCleanGit: false, backup: false } } };

fs.writeFileSync(path.join(workspacePath, 'notes.txt'), 'dirty session note\n');
const status = await relaiGitStatus(workspace, config, {});
assert.equal(status.ok, true);
assert.equal(status.branch, 'main');
assert.ok(Array.isArray(status.untrackedSessionFiles) && status.untrackedSessionFiles.includes('notes.txt'));
assert.ok(Array.isArray(status.statusEntries) && status.statusEntries.some((item) => item.path === 'notes.txt'));

const dryCommit = await relaiGitCommit(workspace, config, { message: 'dry run', dryRun: true });
assert.equal(dryCommit.ok, true);
assert.equal(dryCommit.dryRun, true);

const commit = await relaiGitCommit(workspace, config, { message: 'add notes', paths: ['notes.txt'] });
assert.equal(commit.ok, true);
assert.ok(/add notes/.test(JSON.stringify(commit.commit)));

const pushDryRun = await relaiGitPush(workspace, config, { remote: 'origin', branch: 'main', dryRun: true });
assert.equal(pushDryRun.ok, true);

const mergePlan = await relaiGitMergeRemoteBranchesPlan(workspace, config, { remote: 'origin', targetBranch: 'production' });
assert.equal(mergePlan.ok, true);
assert.ok(mergePlan.excluded.some((item) => item.name === 'origin/main'));
assert.ok(mergePlan.excluded.some((item) => item.name === 'origin/production'));
assert.ok(mergePlan.recommendedMergeOrder.includes('origin/feature/ui-cleanup'));

// merge dry-run of an already-up-to-date source must report ok:true. Previously
// the dry-run ran `git merge --abort` unconditionally, which fails when no merge
// started ("Already up to date"), wrongly flipping ok:false.
const mergeNoop = await relaiGitMergeBranch(workspace, config, { source: 'main', target: 'main', dryRun: true, allowProtected: true });
assert.equal(mergeNoop.ok, true);
assert.equal(mergeNoop.dryRun, true);
assert.ok(/up to date/i.test(JSON.stringify(mergeNoop.merge)));
assert.equal(mergeNoop.abort, undefined);

fs.rmSync(root, { recursive: true, force: true });
console.log('Git workflow smoke test passed.');
