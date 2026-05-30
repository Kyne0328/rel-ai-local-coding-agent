import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { relaiWrite } = require(path.join(root, 'src', 'localRepoBridge.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-staged-fallback-'));
const wsRoot = path.join(tmp, 'repo');
fs.mkdirSync(wsRoot, { recursive: true });
const config = { stateDir: path.join(tmp, 'state') };
const workspace = { alias: 'repo', path: wsRoot };

try {
  // start → writeId issued
  const start = relaiWrite(workspace, config, { stage: 'start', path: 'big.txt', content: 'chunk1\n' });
  assert.equal(start.ok, true, 'start should succeed');
  assert.match(start.writeId, /^op_[a-z0-9]+_[a-f0-9]{12}$/, 'start returns a writeId');

  // append WITHOUT writeId → falls back to the single staged write
  const append = relaiWrite(workspace, config, { stage: 'append', content: 'chunk2\n' });
  assert.equal(append.ok, true, 'append without writeId should fall back');
  assert.equal(append.chunks, 2, 'append should accumulate to 2 chunks');

  // commit WITH a wrong-but-valid-format writeId → falls back to most recent staged write
  const commit = relaiWrite(workspace, config, { stage: 'commit', writeId: 'op_zzzzzzzz_000000000000' });
  assert.equal(commit.ok, true, 'commit with unknown writeId should fall back');
  assert.equal(fs.readFileSync(path.join(wsRoot, 'big.txt'), 'utf8'), 'chunk1\nchunk2\n', 'committed file has both chunks');

  // staged payload cleared after commit → a second commit with no writeId and no staged write throws
  assert.throws(
    () => relaiWrite(workspace, config, { stage: 'commit' }),
    /No staged relai_write payload found/,
    'commit with no staged writes left should throw a clear error'
  );

  console.log('Staged-write fallback unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
