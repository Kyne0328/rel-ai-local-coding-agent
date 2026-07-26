// collectTextFiles no longer runs a realpathSync per file (it dominated the snapshot
// and code-index walks). Containment now rests on the walk refusing every symbolic
// link before it descends, so pin that behavior directly: a symlinked file and a
// symlinked directory that both point outside the workspace must be skipped, and the
// walk must not leak the outside content into the file list.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { collectTextFiles } = require(path.join(root, 'src', 'safety.js'));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-collect-link-'));
const workspace = path.join(base, 'workspace');
const outside = path.join(base, 'outside');
fs.mkdirSync(workspace);
fs.mkdirSync(path.join(outside, 'nested'), { recursive: true });

fs.writeFileSync(path.join(workspace, 'app.js'), 'const inside = 1;\n');
fs.writeFileSync(path.join(outside, 'secret.js'), 'const outside = 1;\n');
fs.writeFileSync(path.join(outside, 'nested', 'deep.js'), 'const deep = 1;\n');

function trySymlink(target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    // Windows refuses symlink creation without Developer Mode or elevation.
    if (['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(error?.code)) return false;
    throw error;
  }
}

try {
  const linkedFile = trySymlink(path.join(outside, 'secret.js'), path.join(workspace, 'linked.js'), 'file');
  const linkedDir = trySymlink(outside, path.join(workspace, 'linked-dir'), 'junction');

  if (!linkedFile && !linkedDir) {
    console.log('Symlink containment unit test skipped (no symlink privilege on this host).');
  } else {
    const result = collectTextFiles(workspace, {});
    assert.deepEqual(result.files, ['app.js'], 'only real in-workspace files are collected');

    for (const [created, name] of [[linkedFile, 'linked.js'], [linkedDir, 'linked-dir']]) {
      if (!created) continue;
      const skipped = result.skipped.find((item) => item.path === name);
      assert.equal(skipped?.reason, 'symlink skipped', `${name} must be reported as a skipped symlink`);
    }

    assert.ok(
      !result.files.some((file) => file.includes('secret') || file.includes('deep')),
      'content behind a symlink must never enter the file list'
    );
    console.log('Symlink containment unit test passed.');
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
