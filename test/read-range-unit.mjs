import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { relaiRead } from "../src/localRepoBridge.js";

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

  // Per-path ranges: two files with different windows must resolve in one call.
  const second = path.join(root, 'second.txt');
  fs.writeFileSync(second, 'one\ntwo\nthree\nfour\nfive\n', 'utf8');
  const perPath = relaiRead(workspace, config, {
    paths: ['sample.txt', 'second.txt'],
    ranges: [
      { path: 'sample.txt', startLine: 1, endLine: 1 },
      { path: 'second.txt', startLine: 3, endLine: 4 }
    ],
    guidanceMode: 'none'
  }, { connector: true });
  assert.equal(perPath.items.length, 2);
  assert.equal(perPath.items[0].content, 'alpha\r\n');
  assert.deepEqual(perPath.items[0].lineRange, { startLine: 1, endLine: 1, totalLines: 4 });
  assert.equal(perPath.items[1].content, 'three\nfour\n');
  assert.deepEqual(perPath.items[1].lineRange, { startLine: 3, endLine: 4, totalLines: 6 });

  // A path without its own entry falls back to the batch-wide window.
  const mixed = relaiRead(workspace, config, {
    paths: ['sample.txt', 'second.txt'],
    startLine: 2,
    endLine: 2,
    ranges: [{ path: 'second.txt', startLine: 5 }],
    guidanceMode: 'none'
  }, { connector: true });
  assert.equal(mixed.items[0].content, 'beta\r\n', 'unlisted paths keep the batch range');
  assert.equal(mixed.items[1].content, 'five\n', 'a listed path uses its own range to end of file');

  // Path spelling is normalized so './x' and 'x' name the same entry.
  const normalized = relaiRead(workspace, config, {
    paths: ['./second.txt'],
    ranges: [{ path: 'second.txt', startLine: 2, endLine: 2 }],
    guidanceMode: 'none'
  }, { connector: true });
  assert.equal(normalized.items[0].content, 'two\n');

  // Repeated ranges for the same file preserve request order instead of collapsing
  // to the last path-keyed range.
  const repeated = relaiRead(workspace, config, {
    ranges: [
      { path: 'sample.txt', startLine: 1, endLine: 1 },
      { path: 'sample.txt', startLine: 3, endLine: 3 }
    ],
    guidanceMode: 'none'
  }, { connector: true });
  assert.equal(repeated.items.length, 2);
  assert.equal(repeated.items[0].content, 'alpha\r\n');
  assert.equal(repeated.items[1].content, 'gamma\r\n');

  assert.throws(() => relaiRead(workspace, config, {
    paths: ['sample.txt'],
    ranges: [{ path: 'sample.txt' }]
  }), /requires startLine or endLine/);
  assert.throws(() => relaiRead(workspace, config, {
    paths: ['sample.txt'],
    ranges: [{ path: 'sample.txt', startLine: 4, endLine: 2 }]
  }), /endLine must be greater than or equal to startLine/);
  assert.throws(() => relaiRead(workspace, config, {
    paths: ['sample.txt'],
    ranges: [{ startLine: 1 }]
  }), /require a non-empty path/);
  assert.throws(() => relaiRead(workspace, config, {
    paths: ['sample.txt'],
    ranges: 'sample.txt'
  }), /ranges must be an array/);
} finally {
  fs.readFileSync = originalReadFileSync;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('relai_read range and single-read tests passed.');
