import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { workspaceWrite } = require(path.join(root, 'src', 'localRepoBridge.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-staged-fallback-'));
const wsRoot = path.join(tmp, 'repo');
fs.mkdirSync(wsRoot, { recursive: true });
const config = { stateDir: path.join(tmp, 'state') };
const workspace = { alias: 'repo', path: wsRoot };

try {
  // --- Single in-flight staged write: fallback is allowed ---
  const start = workspaceWrite(workspace, config, { stage: 'start', path: 'big.txt', content: 'chunk1\n' });
  assert.equal(start.ok, true, 'start should succeed');
  assert.match(start.writeId, /^op_[a-z0-9]+_[a-f0-9]{12}$/, 'start returns a writeId');

  // append WITHOUT writeId → falls back to the single staged write
  const append = workspaceWrite(workspace, config, { stage: 'append', content: 'chunk2\n' });
  assert.equal(append.ok, true, 'append without writeId should fall back to the single staged write');
  assert.equal(append.chunks, 2, 'append should accumulate to 2 chunks');

  // commit WITH a wrong-but-valid-format writeId → falls back to the single staged write
  const commit = workspaceWrite(workspace, config, { stage: 'commit', writeId: 'op_zzzzzzzz_000000000000' });
  assert.equal(commit.ok, true, 'commit with unknown writeId should fall back to the single staged write');
  assert.equal(fs.readFileSync(path.join(wsRoot, 'big.txt'), 'utf8'), 'chunk1\nchunk2\n', 'committed file has both chunks');

  // staged payload cleared after commit → a commit with no staged write left throws
  assert.throws(
    () => workspaceWrite(workspace, config, { stage: 'commit' }),
    /No staged edit payload found/,
    'commit with no staged writes left should throw a clear error'
  );

  // --- Multiple staged writes pending: fallback must REFUSE, not guess ---
  const a = workspaceWrite(workspace, config, { stage: 'start', path: 'fileA.txt', content: 'A\n' });
  const b = workspaceWrite(workspace, config, { stage: 'start', path: 'fileB.txt', content: 'B\n' });
  assert.ok(a.writeId && b.writeId && a.writeId !== b.writeId, 'two distinct staged writes pending');

  // commit with neither writeId nor path → must refuse (the bug that committed the wrong/stale file)
  assert.throws(
    () => workspaceWrite(workspace, config, { stage: 'commit' }),
    /Multiple staged edit payloads are pending/,
    'commit must refuse to guess among multiple pending staged writes'
  );
  assert.equal(fs.existsSync(path.join(wsRoot, 'fileA.txt')), false, 'no file should be written when commit refuses');
  assert.equal(fs.existsSync(path.join(wsRoot, 'fileB.txt')), false, 'no file should be written when commit refuses');

  // commit with a path → disambiguates to the matching staged write only
  const commitB = workspaceWrite(workspace, config, { stage: 'commit', path: 'fileB.txt' });
  assert.equal(commitB.ok, true, 'commit with path should resolve the matching staged write');
  assert.equal(fs.readFileSync(path.join(wsRoot, 'fileB.txt'), 'utf8'), 'B\n', 'fileB committed via path disambiguation');
  assert.equal(fs.existsSync(path.join(wsRoot, 'fileA.txt')), false, 'fileA must remain untouched');

  // now only fileA is pending → single fallback works again
  const commitA = workspaceWrite(workspace, config, { stage: 'commit' });
  assert.equal(commitA.ok, true, 'commit falls back to the remaining single staged write');
  assert.equal(fs.readFileSync(path.join(wsRoot, 'fileA.txt'), 'utf8'), 'A\n', 'fileA committed');

  console.log('Staged-write fallback unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
