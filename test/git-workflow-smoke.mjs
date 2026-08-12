import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { relaiApplyPatch, relaiDiff, relaiGitCommit, relaiGitDraftPr, relaiGitPush, relaiRestorePaths, workspaceWrite } from '../src/localRepoBridge.js';
import { workspaceGitStatus } from "../src/repo/gitOps.js";
import { writeSessionPolicy } from "../src/policyResolver.js";
import { GIT_EXECUTABLE } from './helpers/git-executable.mjs';

function git(args, options = {}) {
  return execFileSync(GIT_EXECUTABLE, args, options);
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-git-workflow-'));
  const remote = path.join(root, 'remote.git');
  const workspacePath = path.join(root, 'workspace');
  fs.mkdirSync(workspacePath, { recursive: true });
  git(['init', '--bare', remote], { stdio: 'ignore' });
  git(['init'], { cwd: workspacePath, stdio: 'ignore' });
  git(['config', 'user.email', 'relai@example.test'], { cwd: workspacePath });
  git(['config', 'user.name', 'RelAI Git Smoke'], { cwd: workspacePath });
  fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Git smoke\n');
  git(['add', 'README.md'], { cwd: workspacePath });
  git(['commit', '-m', 'init'], { cwd: workspacePath, stdio: 'ignore' });
  git(['branch', '-M', 'main'], { cwd: workspacePath });
  git(['remote', 'add', 'origin', remote], { cwd: workspacePath });
  git(['push', '-u', 'origin', 'main'], { cwd: workspacePath, stdio: 'ignore' });
  git(['checkout', '-b', 'production'], { cwd: workspacePath, stdio: 'ignore' });
  git(['push', '-u', 'origin', 'production'], { cwd: workspacePath, stdio: 'ignore' });
  git(['checkout', '-b', 'feature/ui-cleanup'], { cwd: workspacePath, stdio: 'ignore' });
  fs.writeFileSync(path.join(workspacePath, 'ui.txt'), 'feature branch\n');
  git(['add', 'ui.txt'], { cwd: workspacePath });
  git(['commit', '-m', 'feature'], { cwd: workspacePath, stdio: 'ignore' });
  git(['push', '-u', 'origin', 'feature/ui-cleanup'], { cwd: workspacePath, stdio: 'ignore' });
  git(['checkout', 'main'], { cwd: workspacePath, stdio: 'ignore' });
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
  context: { snapshotMaxFiles: 3000 }
};
const config = { stateDir: path.join(root, 'state'), patch: { requireCleanGit: false, backup: false, maxUpdateBytes: 2 * 1024 * 1024 } };

// Start a session against the clean worktree first — this mirrors the real
// connector flow (a write auto-starts a session before git_status is consulted),
// so files created afterward are correctly attributed as session-owned.
writeSessionPolicy(config, workspace.alias, { workspaceRoot: workspacePath });
fs.writeFileSync(path.join(workspacePath, 'notes.txt'), 'dirty session note\n');
const status = await workspaceGitStatus(workspace, config, {});
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
assert.equal(fs.readFileSync(path.join(workspace.path, 'README.md'), 'utf8').replaceAll('\r\n', '\n'), '# Git smoke\n');

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

// addAll commits must refuse secret-looking staged files (e.g. .env picked up by
// `git add -A`) unless every sensitive path has commit-scoped authorization.
fs.writeFileSync(path.join(workspace.path, '.env'), 'API_KEY=super-secret\n');
const secretCommit = await relaiGitCommit(workspace, config, { message: 'oops secrets' });
assert.equal(secretCommit.ok, false, 'commit with staged .env should be refused');
assert.ok(Array.isArray(secretCommit.secretStagedFiles) && secretCommit.secretStagedFiles.includes('.env'));
assert.equal(secretCommit.indexRestored, true, 'secret refusal must restore the pre-operation index');
assert.match(secretCommit.error, /matching commit authorization/);
assert.equal(git(['diff', '--cached', '--name-only'], { cwd: workspace.path }).toString('utf8').trim(), '', 'secret file must not remain staged');

const secretCommitAllowed = await relaiGitCommit(workspace, config, {
  message: 'intentional env commit',
  sensitiveAuthorization: {
    operation: 'commit',
    paths: ['.env'],
    reason: 'The test explicitly approves this environment file.'
  }
});
assert.equal(secretCommitAllowed.ok, true, 'scoped sensitive authorization should permit the commit');
git(['rm', '--cached', '.env'], { cwd: workspace.path, stdio: 'ignore' });
git(['commit', '-m', 'remove env'], { cwd: workspace.path, stdio: 'ignore' });
fs.rmSync(path.join(workspace.path, '.env'), { force: true });

const draftPr = await relaiGitDraftPr(workspace, config, { base: 'main', head: 'feature/ui-cleanup' });
assert.equal(draftPr.ok, true);
assert.equal(draftPr.draftOnly, true);
assert.equal(draftPr.remoteChanged, false);
assert.equal(draftPr.deprecated, undefined);
assert.ok(draftPr.changedFiles.includes('ui.txt'));
assert.match(draftPr.title, /feature\/ui-cleanup/);
assert.match(draftPr.body, /ui\.txt/);

const emptyPr = await relaiGitDraftPr(workspace, config, { base: 'main', head: 'main' });
assert.equal(emptyPr.ok, false);
assert.equal(emptyPr.emptyDiff, true);
assert.equal(emptyPr.remoteChanged, false);
assert.match(emptyPr.warning, /No diff/);

// Path-scoped restore is tracked-only and rejects untracked paths.
fs.mkdirSync(path.join(workspace.path, 'tmp'), { recursive: true });
const untrackedRel = 'tmp/restore-untracked.txt';
fs.writeFileSync(path.join(workspace.path, untrackedRel), 'disposable\n');
const restoreNoClean = await relaiRestorePaths(workspace, config, { paths: [untrackedRel] });
assert.equal(restoreNoClean.ok, false, 'tracked path restore must reject an untracked path');
fs.rmSync(path.join(workspace.path, untrackedRel), { force: true });

assert.throws(() => workspaceWrite(workspace, config, { path: 'collapsed.js', content: 'const value = 1;'.repeat(400) }), /collapsed source-looking content/);

// Tracked-modified file: restore reverts it (regression: paths-mode still works).
fs.writeFileSync(path.join(workspace.path, 'README.md'), '# Git smoke\nlocal edit\n');
const restoreTracked = await relaiRestorePaths(workspace, config, { paths: ['README.md'] });
assert.equal(restoreTracked.ok, true, 'tracked file restore should succeed');
const revertedReadme = fs.readFileSync(path.join(workspace.path, 'README.md'), 'utf8').replaceAll('\r\n', '\n');
assert.equal(revertedReadme, '# Git smoke\n', 'README reverted');

fs.writeFileSync(path.join(workspace.path, 'untracked-review.txt'), 'review this content\n');
const untrackedReview = await relaiDiff(workspace, config, { path: 'untracked-review.txt' });
assert.match(untrackedReview.diff, /new file mode/);
assert.match(untrackedReview.diff, /\+review this content/);

fs.rmSync(root, { recursive: true, force: true });
console.log('Git workflow smoke test passed.');
