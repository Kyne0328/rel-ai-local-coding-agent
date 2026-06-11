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
  relaiGitMergeRemoteBranchesPlan,
  relaiGitCreatePr,
  relaiApplyPatch,
  relaiClear,
  relaiWrite,
  relaiReset
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

const dryScopedCommit = await relaiGitCommit(workspace, config, { message: 'dry scoped', paths: ['notes.txt'], dryRun: true });
assert.equal(dryScopedCommit.ok, true);
assert.equal(dryScopedCommit.addAll, false);
assert.deepEqual(dryScopedCommit.paths, ['notes.txt']);

const dryPatch = await relaiApplyPatch(workspace, config, {
  updateText: '--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n # Git smoke\n+dry patch\n',
  dryRun: true,
  requireCleanGit: false
});
assert.equal(dryPatch.ok, true);
assert.equal(dryPatch.dryRun, true);
assert.deepEqual(dryPatch.changedFiles, []);
assert.equal(fs.readFileSync(path.join(workspace.path, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), '# Git smoke\n');

const commit = await relaiGitCommit(workspace, config, { message: 'add notes', paths: ['notes.txt'] });
assert.equal(commit.ok, true);
assert.ok(/add notes/.test(JSON.stringify(commit.commit)));

const pushDryRun = await relaiGitPush(workspace, config, { remote: 'origin', branch: 'main', dryRun: true });
assert.equal(pushDryRun.ok, true);

// allowedRemotes enforcement: a remote not on the allowlist is refused (also blocks
// git's command-executing ext:: transport via an unexpected remote name).
await assert.rejects(
  () => relaiGitPush(workspace, config, { remote: 'evil', branch: 'main', dryRun: true }),
  /allowedRemotes/,
  'push to a non-allowlisted remote must be refused'
);

// Fetch with an allowlist that matches no configured remote must report the
// mismatch, not a hollow ok:true with zero results.
{
  const { relaiGitFetch } = require('../src/localRepoBridge.js');
  const noMatch = await relaiGitFetch({ ...workspace, allowedRemotes: ['upstream'] }, config, {});
  assert.equal(noMatch.ok, false, 'fetch with zero allowlisted remotes must not be ok');
  assert.match(noMatch.error, /allowedRemotes/);
}

// addAll commits must refuse secret-looking staged files (e.g. .env picked up by
// `git add -A`) unless the caller passes allowSecretPaths: true.
fs.writeFileSync(path.join(workspace.path, '.env'), 'API_KEY=super-secret\n');
const secretCommit = await relaiGitCommit(workspace, config, { message: 'oops secrets' });
assert.equal(secretCommit.ok, false, 'commit with staged .env should be refused');
assert.ok(Array.isArray(secretCommit.secretStagedFiles) && secretCommit.secretStagedFiles.includes('.env'));
assert.match(secretCommit.error, /allowSecretPaths/);
execFileSync('git', ['restore', '--staged', '.env'], { cwd: workspace.path });

const secretCommitAllowed = await relaiGitCommit(workspace, config, { message: 'intentional env commit', allowSecretPaths: true });
assert.equal(secretCommitAllowed.ok, true, 'allowSecretPaths: true should permit the commit');
execFileSync('git', ['rm', '--cached', '.env'], { cwd: workspace.path, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'remove env'], { cwd: workspace.path, stdio: 'ignore' });
fs.rmSync(path.join(workspace.path, '.env'), { force: true });

const mergePlan = await relaiGitMergeRemoteBranchesPlan(workspace, config, { remote: 'origin', targetBranch: 'production' });
assert.equal(mergePlan.ok, true);
assert.ok(mergePlan.excluded.some((item) => item.name === 'origin/main'));
assert.ok(mergePlan.excluded.some((item) => item.name === 'origin/production'));
assert.ok(mergePlan.recommendedMergeOrder.includes('origin/feature/ui-cleanup'));

const emptyPr = await relaiGitCreatePr(workspace, config, { base: 'main', head: 'main' });
assert.equal(emptyPr.ok, false);
assert.equal(emptyPr.emptyDiff, true);
assert.match(emptyPr.warning, /No diff/);

// merge dry-run of an already-up-to-date source must report ok:true. Previously
// the dry-run ran `git merge --abort` unconditionally, which fails when no merge
// started ("Already up to date"), wrongly flipping ok:false.
const mergeNoop = await relaiGitMergeBranch(workspace, config, { source: 'main', target: 'main', dryRun: true, allowProtected: true });
assert.equal(mergeNoop.ok, true);
assert.equal(mergeNoop.dryRun, true);
assert.ok(/up to date/i.test(JSON.stringify(mergeNoop.merge)));
assert.equal(mergeNoop.abort, undefined);

// relai_restore_changes paths-mode: clean:true must remove an UNTRACKED disposable
// file (git restore alone cannot — it only knows tracked paths). Regression guard for
// the recurring audit finding that cleanup-by-path failed on untracked files.
fs.mkdirSync(path.join(workspace.path, 'tmp'), { recursive: true });
const untrackedRel = 'tmp/restore-untracked.txt';
fs.writeFileSync(path.join(workspace.path, untrackedRel), 'disposable\n');
const restoreUntracked = await relaiReset(workspace, config, { paths: [untrackedRel], clean: true });
assert.equal(restoreUntracked.ok, true, 'clean:true should remove untracked file by path');
assert.equal(fs.existsSync(path.join(workspace.path, untrackedRel)), false, 'untracked file should be gone');

// Without clean:true, an untracked path is still a no-match failure (git restore is
// tracked-only) — unchanged behavior.
fs.writeFileSync(path.join(workspace.path, untrackedRel), 'disposable again\n');
const restoreNoClean = await relaiReset(workspace, config, { paths: [untrackedRel] });
assert.equal(restoreNoClean.ok, false, 'untracked restore without clean still fails');
fs.rmSync(path.join(workspace.path, untrackedRel), { force: true });

const clearDryRun = relaiClear(workspace, config, { path: 'README.md', dryRun: true });
assert.equal(clearDryRun.ok, true);
assert.deepEqual(clearDryRun.cleared, []);
assert.deepEqual(clearDryRun.wouldClear, ['README.md']);
assert.equal(fs.existsSync(path.join(workspace.path, 'README.md')), true);

assert.throws(() => relaiWrite(workspace, config, { path: 'collapsed.js', content: 'const value = 1;'.repeat(400) }), /collapsed source-looking content/);

// Tracked-modified file: restore reverts it (regression: paths-mode still works).
fs.writeFileSync(path.join(workspace.path, 'README.md'), '# Git smoke\nlocal edit\n');
const restoreTracked = await relaiReset(workspace, config, { paths: ['README.md'] });
assert.equal(restoreTracked.ok, true, 'tracked file restore should succeed');
const revertedReadme = fs.readFileSync(path.join(workspace.path, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
assert.equal(revertedReadme, '# Git smoke\n', 'README reverted');

fs.rmSync(root, { recursive: true, force: true });
console.log('Git workflow smoke test passed.');
