import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { repoSnapshot } = require(path.join(root, 'src', 'localRepoBridge.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-snap-git-'));
const wsRoot = path.join(tmp, 'repo');
fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(wsRoot, 'src', 'app.js'), 'export const app = 1;\n');

function git(...args) {
  const res = spawnSync('git', args, { cwd: wsRoot, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
}
git('init');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
git('add', '.');
git('commit', '-m', 'init');
fs.writeFileSync(path.join(wsRoot, 'src', 'app.js'), 'export const app = 2;\n');
fs.writeFileSync(path.join(wsRoot, 'src', 'new.js'), 'export const fresh = 1;\n');

const config = { stateDir: path.join(tmp, 'state') };
const workspace = { alias: 'repo', path: wsRoot };

try {
  const snapshot = await repoSnapshot(workspace, config);
  assert.equal(snapshot.ok, true);
  assert.ok(snapshot.git, 'snapshot must include a git summary in a git workspace');
  assert.equal(typeof snapshot.git.branch, 'string');
  assert.equal(snapshot.git.dirtyFiles, 2, 'one modified + one untracked file');
  assert.ok(snapshot.git.changedFiles.includes('src/app.js'));
  assert.ok(snapshot.git.changedFiles.includes('src/new.js'));

  // Non-git workspace: snapshot still works, git field absent.
  const plainDir = path.join(tmp, 'plain');
  fs.mkdirSync(plainDir, { recursive: true });
  fs.writeFileSync(path.join(plainDir, 'a.txt'), 'a\n');
  const plain = await repoSnapshot({ alias: 'plain', path: plainDir }, config);
  assert.equal(plain.ok, true);
  assert.equal(plain.git, undefined, 'non-git workspace must omit the git summary');

  console.log('Snapshot git summary unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
