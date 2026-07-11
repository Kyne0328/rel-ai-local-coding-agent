import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiApplyPatch } = require('../src/localRepoBridge.js');
const gitExecutable = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';

function git(args, options = {}) {
  return execFileSync(gitExecutable, args, options);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-ai-patch-smoke-'));
const workspacePath = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
fs.mkdirSync(workspacePath, { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });

git(['init'], { cwd: workspacePath, stdio: 'ignore' });
git(['config', 'user.email', 'relai@example.test'], { cwd: workspacePath });
git(['config', 'user.name', 'RelAI Patch Smoke'], { cwd: workspacePath });
fs.writeFileSync(path.join(workspacePath, 'hello.txt'), 'Hello, world!\n');
git(['add', 'hello.txt'], { cwd: workspacePath });
git(['commit', '-m', 'init'], { cwd: workspacePath, stdio: 'ignore' });

const config = {
  stateDir,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2 * 1024 * 1024 }
};
const workspace = { alias: 'smoke', path: workspacePath };

try {
  fs.writeFileSync(path.join(workspacePath, 'hello.txt'), 'Hello, updated world!\n');
  const diff = git(['diff', 'hello.txt'], { cwd: workspacePath }).toString('utf8');
  git(['checkout', '--', 'hello.txt'], { cwd: workspacePath });
  const applied = await relaiApplyPatch(workspace, config, { patch: diff, returnDiff: false });
  assert.equal(applied.ok, true);
  assert.match(fs.readFileSync(path.join(workspacePath, 'hello.txt'), 'utf8'), /updated world/);
  git(['checkout', '--', 'hello.txt'], { cwd: workspacePath });

  await assert.rejects(
    () => relaiApplyPatch(workspace, config, { patch: '   ' }),
    /relai_edit requires non-empty updateText/
  );
  await assert.rejects(
    () => relaiApplyPatch(workspace, { ...config, patch: { ...config.patch, maxUpdateBytes: 10 } }, { patch: 'x'.repeat(20) }),
    /relai_edit refused 20 byte patch/
  );

  const openAiPatch = `*** Begin Patch
*** Update File: hello.txt
@@
-Hello, world!
+Hello from OpenAI patch!
*** End Patch
`;
  const structured = await relaiApplyPatch(workspace, config, { patch: openAiPatch, returnDiff: false });
  assert.equal(structured.ok, true);
  assert.equal(structured.sourceFormat, 'openai-patch');
  assert.match(fs.readFileSync(path.join(workspacePath, 'hello.txt'), 'utf8'), /OpenAI patch/);
  git(['checkout', '--', 'hello.txt'], { cwd: workspacePath });

  fs.writeFileSync(path.join(workspacePath, 'obsolete.txt'), 'remove me\n');
  git(['add', 'obsolete.txt'], { cwd: workspacePath });
  git(['commit', '-m', 'add obsolete'], { cwd: workspacePath, stdio: 'ignore' });
  const deletePatch = `*** Begin Patch
*** Delete File: obsolete.txt
*** End Patch
`;
  const deleted = await relaiApplyPatch(workspace, config, { patch: deletePatch, returnDiff: false });
  assert.equal(deleted.ok, true);
  assert.equal(fs.existsSync(path.join(workspacePath, 'obsolete.txt')), false);

  console.log('Patch update smoke test passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
