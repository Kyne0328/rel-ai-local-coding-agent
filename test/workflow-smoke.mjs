import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, REL_AI_MCP_CONFIG: configPath }
});

let buffer = '';
const responses = [];
child.stdout.on('data', chunk => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) responses.push(JSON.parse(line));
  }
});

function send(id, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}

function call(id, name, args = {}) {
  send(id, 'tools/call', { name, arguments: args });
}

function waitFor(id, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = responses.find(item => item.id === id);
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for response ${id}.`));
      }
    }, 25);
  });
}

function contentOf(response) {
  const payload = response.result?.structuredContent;
  if (!payload || payload.ok === false) throw new Error(JSON.stringify(payload || response));
  return payload;
}

try {
  send(1, 'initialize', { protocolVersion: '2025-06-18' });
  await waitFor(1);

  send(2, 'tools/list');
  const listed = await waitFor(2);
  const names = listed.result.tools.map(tool => tool.name);
  if (names.length !== 17) throw new Error(`Expected 17 tools, got ${names.length}.`);
  for (const removed of ['relai_apply_bundle', 'relai_package_snapshot', 'relai_clear_files', 'relai_git_fetch']) {
    if (names.includes(removed)) throw new Error(`${removed} must not be listed.`);
  }

  call(3, 'relai_repo_snapshot', { workspace: 'smoke', maxEntries: 100 });
  const snapshot = contentOf(await waitFor(3));
  if (!snapshot.files.includes('README.md')) throw new Error('Snapshot missing README.md.');
  for (const mode of ['exact-replace', 'direct-write', 'staged-write', 'apply-update', 'workspace-tidy']) {
    if (!snapshot.writeGuidance?.modes?.[mode]) throw new Error(`Snapshot guidance missing ${mode}.`);
  }
  if (snapshot.writeGuidance?.modes?.['apply-bundle']) throw new Error('Obsolete bundle guidance remains.');

  call(4, 'relai_read', { workspace: 'smoke', paths: ['README.md', 'src/index.js'] });
  const read = contentOf(await waitFor(4));
  if (!read.items[0].content.includes('# Smoke')) throw new Error('Read failed.');

  call(5, 'relai_edit', {
    workspace: 'smoke',
    path: 'README.md',
    oldText: '# Smoke\n',
    newText: '# Smoke\n\nEdited through relai_edit.\n'
  });
  const exactEdit = contentOf(await waitFor(5));
  if (!exactEdit.changedFiles.includes('README.md')) throw new Error('Exact edit failed.');

  call(6, 'relai_write', {
    workspace: 'smoke',
    path: 'README.md',
    content: '# Smoke\n\nWritten through relai_write.\n',
    dryRun: true
  });
  const dryWrite = contentOf(await waitFor(6));
  if (!dryWrite.dryRun || !dryWrite.changedFiles.includes('README.md')) throw new Error('Dry write failed.');

  call(7, 'relai_replace', {
    workspace: 'smoke',
    path: 'README.md',
    oldText: 'Edited through relai_edit.',
    newText: 'Updated by exact replacement.'
  });
  const replaced = contentOf(await waitFor(7));
  if (!replaced.changedFiles.includes('README.md')) throw new Error('Replacement failed.');

  const patch = `*** Begin Patch
*** Update File: src/index.js
@@
-console.log("smoke")
+console.log("smoke updated")
*** End Patch
`;
  call(8, 'relai_edit', { workspace: 'smoke', updateText: patch, returnDiff: true });
  const patched = contentOf(await waitFor(8));
  if (!patched.changedFiles.includes('src/index.js')) throw new Error('Patch edit failed.');

  fs.writeFileSync(path.join(workspace, 'obsolete.md'), 'remove me\n');
  git(['add', 'obsolete.md'], { cwd: workspace });
  git(['commit', '-m', 'add obsolete'], { cwd: workspace, stdio: 'ignore' });
  const deletePatch = `*** Begin Patch
*** Delete File: obsolete.md
*** End Patch
`;
  call(9, 'relai_edit', { workspace: 'smoke', updateText: deletePatch });
  const deleted = contentOf(await waitFor(9));
  if (!deleted.changedFiles.includes('obsolete.md') || fs.existsSync(path.join(workspace, 'obsolete.md'))) {
    throw new Error('Structured delete failed.');
  }

  fs.writeFileSync(path.join(workspace, 'session-artifact.txt'), 'temporary\n');
  call(10, 'relai_git_status', { workspace: 'smoke' });
  const status = contentOf(await waitFor(10));
  if (!status.untrackedSessionFiles.includes('session-artifact.txt')) throw new Error('Session ownership missing untracked artifact.');

  call(11, 'relai_tidy_plan', { workspace: 'smoke' });
  const plan = contentOf(await waitFor(11));
  if (!plan.candidates.some(item => item.path === 'session-artifact.txt')) throw new Error('Tidy plan missed session artifact.');
  call(12, 'relai_tidy_run', { workspace: 'smoke', planId: plan.planId });
  const tidied = contentOf(await waitFor(12));
  if (!tidied.changedFiles.includes('session-artifact.txt')) throw new Error('Tidy run failed.');

  call(13, 'relai_run_checks', { workspace: 'smoke', level: 'standard' });
  const checks = contentOf(await waitFor(13));
  if (!checks.ok || !checks.checks.includes('npm run check')) throw new Error('Validation failed.');

  call(14, 'relai_diff', { workspace: 'smoke' });
  const diff = contentOf(await waitFor(14));
  if (!diff.diff.includes('Updated by exact replacement')) throw new Error('Diff missing README change.');
  if (!diff.diff.includes('smoke updated')) throw new Error('Diff missing source change.');

  call(15, 'relai_restore_changes', { workspace: 'smoke', paths: ['README.md', 'src/index.js', 'obsolete.md'] });
  const restored = contentOf(await waitFor(15));
  if (!restored.ok) throw new Error('Restore failed.');

  call(16, 'relai_diff', { workspace: 'smoke' });
  const clean = contentOf(await waitFor(16));
  if (clean.diff.trim()) throw new Error('Workspace diff should be clean after restore.');

  console.log('Public 17-tool workflow smoke test passed.');
} finally {
  child.stdin.end();
  child.kill('SIGTERM');
  await once(child, 'close').catch(() => {});
  fs.rmSync(temp, { recursive: true, force: true });
}
