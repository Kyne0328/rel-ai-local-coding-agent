import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiRead } = require('../src/localRepoBridge.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-read-range-'));
const stateDir = path.join(root, 'state');
const target = path.join(root, 'sample.txt');
const content = 'alpha\r\nbeta\r\ngamma\r\ndelta';
fs.writeFileSync(target, content, 'utf8');

const workspace = { alias: 'sample', path: root };
const config = { stateDir };
const originalReadFileSync = fs.readFileSync;
let targetReads = 0;

try {
  fs.readFileSync = function patchedReadFileSync(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(target)) targetReads += 1;
    return originalReadFileSync.call(this, file, ...args);
  };

  const ranged = relaiRead(workspace, config, {
    paths: ['sample.txt'],
    startLine: 2,
    endLine: 3,
    guidanceMode: 'none'
  }, { connector: true });

  assert.equal(targetReads, 1, 'relai_read must hash the already-read buffer instead of rereading the file');
  assert.equal(ranged.items.length, 1);
  assert.equal(ranged.items[0].content, 'beta\r\ngamma\r\n');
  assert.equal(ranged.items[0].bytes, Buffer.byteLength(content, 'utf8'));
  assert.equal(ranged.items[0].returnedBytes, Buffer.byteLength('beta\r\ngamma\r\n', 'utf8'));
  assert.equal(ranged.items[0].lineCount, 4);
  assert.deepEqual(ranged.items[0].lineRange, { startLine: 2, endLine: 3, totalLines: 4 });
  assert.equal(ranged.items[0].sha256, crypto.createHash('sha256').update(content, 'utf8').digest('hex'));
  assert.equal(ranged.items[0].writeGuidance, undefined);
  assert.equal(ranged.items[0].writeHint, undefined);

  assert.throws(() => relaiRead(workspace, config, {
    paths: ['sample.txt'],
    startLine: 4,
    endLine: 2
  }), /endLine must be greater than or equal to startLine/);

  const unicodePath = path.join(root, 'unicode.txt');
  const unicode = 'é'.repeat(700);
  fs.writeFileSync(unicodePath, unicode, 'utf8');
  const truncated = relaiRead(workspace, config, {
    paths: ['unicode.txt'],
    maxBytes: 1001,
    guidanceMode: 'none'
  }, { connector: true });
  assert.equal(truncated.items[0].truncated, true);
  assert.ok(truncated.items[0].returnedBytes <= 1001);
  assert.doesNotMatch(truncated.items[0].content, /�/u, 'UTF-8 truncation must not return a partial code point');
} finally {
  fs.readFileSync = originalReadFileSync;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('relai_read range and single-read tests passed.');
