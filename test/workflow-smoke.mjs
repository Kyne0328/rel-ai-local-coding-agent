import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient, structuredContentOf } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-mcp-workflow-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const gitExecutable = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';

function git(args, options = {}) {
  return execFileSync(gitExecutable, args, options);
}

fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'README.md'), '# Smoke\n');
fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'console.log("smoke")\n');
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
  scripts: { check: 'node --check src/index.js' }
}, null, 2));

git(['init'], { cwd: workspace, stdio: 'ignore' });
git(['config', 'user.email', 'relai@example.test'], { cwd: workspace });
git(['config', 'user.name', 'RelAI Smoke'], { cwd: workspace });
git(['add', '.'], { cwd: workspace });
git(['commit', '-m', 'init'], { cwd: workspace, stdio: 'ignore' });

const configPath = path.join(temp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: {
    smoke: {
      path: workspace,
      protectedBranches: ['main', 'master'],
      testCommands: { check: 'npm run check' },
      commands: {}
    }
  }
}, null, 2));

const client = startMcpClient({ root, configPath, timeoutMs: 15000 });

try {
  client.send(1, 'initialize', { protocolVersion: '2025-06-18' });
  await client.waitFor(1);

  client.call(3, 'relai_repo_snapshot', { workspace: 'smoke', maxEntries: 100 });
  const snapshot = structuredContentOf(await client.waitFor(3));
  if (!snapshot.files.includes('README.md')) throw new Error('Snapshot missing README.md.');
  for (const mode of ['exact-replace', 'direct-write', 'staged-write', 'apply-update', 'workspace-tidy']) {
    if (!snapshot.writeGuidance?.modes?.[mode]) throw new Error(`Snapshot guidance missing ${mode}.`);
  }
  if (snapshot.writeGuidance?.modes?.['apply-bundle']) throw new Error('Obsolete bundle guidance remains.');

  client.call(4, 'relai_read', { workspace: 'smoke', paths: ['README.md', 'src/index.js'] });
  const read = structuredContentOf(await client.waitFor(4));
  if (!read.items[0].content.includes('# Smoke')) throw new Error('Read failed.');

  client.call(5, 'relai_edit', {
    workspace: 'smoke',
    path: 'README.md',
    oldText: '# Smoke\n',
    newText: '# Smoke\n\nEdited through relai_edit.\n'
  });
  const exactEdit = structuredContentOf(await client.waitFor(5));
  if (!exactEdit.changedFiles.includes('README.md')) throw new Error('Exact edit failed.');

  client.call(6, 'relai_write', {
    workspace: 'smoke',
    path: 'README.md',
    content: '# Smoke\n\nWritten through relai_write.\n',
    dryRun: true
  });
  const dryWrite = structuredContentOf(await client.waitFor(6));
  if (!dryWrite.dryRun || !dryWrite.changedFiles.includes('README.md')) throw new Error('Dry write failed.');

  client.call(7, 'relai_replace', {
    workspace: 'smoke',
    path: 'README.md',
    oldText: 'Edited through relai_edit.',
    newText: 'Updated by exact replacement.'
  });
  const replaced = structuredContentOf(await client.waitFor(7));
  if (!replaced.changedFiles.includes('README.md')) throw new Error('Replacement failed.');

  const patch = `*** Begin Patch
*** Update File: src/index.js
@@
-console.log("smoke")
+console.log("smoke updated")
*** End Patch
`;
  client.call(8, 'relai_edit', { workspace: 'smoke', updateText: patch, returnDiff: true });
  const patched = structuredContentOf(await client.waitFor(8));
  if (!patched.changedFiles.includes('src/index.js')) throw new Error('Patch edit failed.');

  fs.writeFileSync(path.join(workspace, 'obsolete.md'), 'remove me\n');
  git(['add', 'obsolete.md'], { cwd: workspace });
  git(['commit', '-m', 'add obsolete'], { cwd: workspace, stdio: 'ignore' });
  const deletePatch = `*** Begin Patch
*** Delete File: obsolete.md
*** End Patch
`;
  client.call(9, 'relai_edit', { workspace: 'smoke', updateText: deletePatch });
  const deleted = structuredContentOf(await client.waitFor(9));
  if (!deleted.changedFiles.includes('obsolete.md') || fs.existsSync(path.join(workspace, 'obsolete.md'))) {
    throw new Error('Structured delete failed.');
  }

  fs.writeFileSync(path.join(workspace, 'session-artifact.txt'), 'temporary\n');
  client.call(10, 'relai_git_status', { workspace: 'smoke' });
  const status = structuredContentOf(await client.waitFor(10));
  if (!status.untrackedSessionFiles.includes('session-artifact.txt')) throw new Error('Session ownership missing untracked artifact.');

  client.call(11, 'relai_tidy_plan', { workspace: 'smoke' });
  const plan = structuredContentOf(await client.waitFor(11));
  if (!plan.candidates.some(item => item.path === 'session-artifact.txt')) throw new Error('Tidy plan missed session artifact.');
  client.call(12, 'relai_tidy_run', { workspace: 'smoke', planId: plan.planId });
  const tidied = structuredContentOf(await client.waitFor(12));
  if (!tidied.changedFiles.includes('session-artifact.txt')) throw new Error('Tidy run failed.');

  client.call(13, 'relai_run_checks', { workspace: 'smoke', level: 'standard' });
  const checks = structuredContentOf(await client.waitFor(13));
  if (!checks.ok || !checks.checks.includes('npm run check')) throw new Error('Validation failed.');

  client.call(14, 'relai_diff', { workspace: 'smoke' });
  const diff = structuredContentOf(await client.waitFor(14));
  if (!diff.diff.includes('Updated by exact replacement')) throw new Error('Diff missing README change.');
  if (!diff.diff.includes('smoke updated')) throw new Error('Diff missing source change.');

  client.call(15, 'relai_restore_changes', { workspace: 'smoke', paths: ['README.md', 'src/index.js', 'obsolete.md'] });
  const restored = structuredContentOf(await client.waitFor(15));
  if (!restored.ok) throw new Error('Restore failed.');

  client.call(16, 'relai_diff', { workspace: 'smoke' });
  const clean = structuredContentOf(await client.waitFor(16));
  if (clean.diff.trim()) throw new Error('Workspace diff should be clean after restore.');

  console.log('Public tool workflow smoke test passed.');
} finally {
  await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
