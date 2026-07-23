import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { relaiSearch } = require(path.join(root, 'src', 'bridge', 'search.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-search-context-'));
const wsRoot = path.join(tmp, 'repo');
fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });

const alphaText = [
  'const first = true;',
  'function alphaThing() {',
  '  alphaThing();',
  '  const middle = 1;',
  '  alphaThing();',
  '  return middle;',
  '}',
  'const gap = true;',
  'const gap2 = true;',
  'function later() {',
  '  alphaThing();',
  '}',
  ''
].join('\n');
const betaText = 'export const beta = alphaThing();\n';
const namedText = 'export const alphaThingFile = alphaThing();\n';
const hugeText = `hugeMarker ${'x'.repeat(3000)}\n`;
const moderateText = Array.from({ length: 25 }, (_, index) => `moderateMarker ${index}`).join('\n') + '\n';
const broadText = Array.from({ length: 110 }, (_, index) => `broadMarker ${index}`).join('\n') + '\n';
fs.writeFileSync(path.join(wsRoot, 'src', 'alpha.js'), alphaText);
fs.writeFileSync(path.join(wsRoot, 'src', 'beta.js'), betaText);
fs.writeFileSync(path.join(wsRoot, 'src', 'alphaThing.js'), namedText);
fs.writeFileSync(path.join(wsRoot, 'src', 'huge.js'), hugeText);
fs.writeFileSync(path.join(wsRoot, 'src', 'moderate.js'), moderateText);
fs.writeFileSync(path.join(wsRoot, 'src', 'broad.js'), broadText);
const init = spawnSync('git', ['init'], { cwd: wsRoot, encoding: 'utf8' });
assert.equal(init.status, 0, `git init failed: ${init.stderr}`);

const workspace = { alias: 'repo', path: wsRoot };

try {
  const automatic = await relaiSearch(workspace, {}, { pattern: 'alphaThing', fixed: true });
  assert.equal(automatic.mode, 'auto');
  assert.equal(automatic.effectiveMode, 'context');
  assert.equal(automatic.autoTier, 'focused');
  assert.equal(automatic.selectionStrategy, 'path-and-match-density');
  assert.equal(automatic.contextBefore, 3);
  assert.equal(automatic.contextAfter, 5);
  assert.equal(automatic.maxFiles, 20);
  assert.equal(automatic.maxRangesPerFile, 20);
  assert.equal(automatic.maxRangeLines, 80);
  assert.equal(automatic.maxBytes, 96 * 1024);
  assert.equal(automatic.files[0].path, 'src/alphaThing.js', 'auto mode should prioritize a path that directly matches the query');
  assert.match(automatic.next, /Adaptive context is included/);

  const compact = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'compact'
  });
  assert.equal(compact.mode, undefined, 'explicit compact searches must preserve the existing response shape');
  assert.equal(compact.files, undefined);
  assert.ok(compact.matches.length >= 6);

  const contextual = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'context',
    contextBefore: 1,
    contextAfter: 1,
    maxFiles: 10,
    maxRangesPerFile: 10,
    maxRangeLines: 20,
    maxBytes: 20000
  });
  assert.equal(contextual.mode, 'context');
  assert.equal(contextual.effectiveMode, undefined);
  assert.equal(contextual.groupByFile, true);
  assert.equal(contextual.mergeOverlaps, true);
  assert.ok(Array.isArray(contextual.files));
  const alpha = contextual.files.find(file => file.path === 'src/alpha.js');
  assert.ok(alpha, 'context result must include alpha.js');
  assert.equal(alpha.sha256, crypto.createHash('sha256').update(Buffer.from(alphaText)).digest('hex'));
  assert.equal(alpha.matchCount, 4);
  assert.equal(alpha.ranges.length, 2, 'overlapping and adjacent ranges should merge');
  assert.deepEqual(alpha.ranges[0].matchLines, [2, 3, 5]);
  assert.equal(alpha.ranges[0].startLine, 1);
  assert.equal(alpha.ranges[0].endLine, 6);
  assert.match(alpha.ranges[0].content, /const first = true;/);
  assert.match(alpha.ranges[0].content, /return middle/);
  assert.match(contextual.next, /Context is included/);

  const moderate = await relaiSearch(workspace, {}, { pattern: 'moderateMarker', fixed: true });
  assert.equal(moderate.mode, 'auto');
  assert.equal(moderate.autoTier, 'moderate');
  assert.equal(moderate.maxFiles, 10);
  assert.equal(moderate.maxRangesPerFile, 8);
  assert.equal(moderate.maxRangeLines, 80);
  assert.equal(moderate.maxBytes, 96 * 1024);

  const broad = await relaiSearch(workspace, {}, { pattern: 'broadMarker', fixed: true });
  assert.equal(broad.mode, 'auto');
  assert.equal(broad.autoTier, 'broad');
  assert.equal(broad.maxFiles, 5);
  assert.equal(broad.maxRangesPerFile, 4);
  assert.equal(broad.maxRangeLines, 60);
  assert.equal(broad.maxBytes, 64 * 1024);
  assert.ok(broad.returnedRangeCount <= 4, 'broad auto mode should stay inside its range budget');
  assert.ok(broad.files[0].ranges.every(range => range.endLine - range.startLine + 1 <= 60));

  const empty = await relaiSearch(workspace, {}, { pattern: 'notPresentAnywhere', fixed: true });
  assert.equal(empty.mode, 'auto');
  assert.equal(empty.effectiveMode, 'compact');
  assert.equal(empty.autoTier, 'empty');
  assert.equal(empty.files, undefined);

  const unmerged = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'context',
    contextBefore: 1,
    contextAfter: 1,
    mergeOverlaps: false,
    maxBytes: 20000
  });
  const unmergedAlpha = unmerged.files.find(file => file.path === 'src/alpha.js');
  assert.equal(unmergedAlpha.ranges.length, 4, 'mergeOverlaps:false must retain separate windows');

  const flat = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'context',
    contextBefore: 0,
    contextAfter: 0,
    groupByFile: false,
    maxBytes: 20000
  });
  assert.equal(flat.files, undefined);
  assert.ok(Array.isArray(flat.contexts));
  assert.ok(flat.contexts.every(item => item.path && item.sha256 && Number.isInteger(item.startLine)));

  const rangeLimited = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'context',
    contextBefore: 0,
    contextAfter: 0,
    mergeOverlaps: false,
    maxRangesPerFile: 1,
    maxBytes: 20000
  });
  assert.equal(rangeLimited.contextTruncated, true);
  assert.ok(rangeLimited.omittedRanges >= 3);

  const fileLimited = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'context',
    maxFiles: 1,
    maxBytes: 20000
  });
  assert.equal(fileLimited.returnedFileCount, 1);
  assert.ok(fileLimited.omittedFiles >= 1);
  assert.equal(fileLimited.contextTruncated, true);

  const byteLimited = await relaiSearch(workspace, {}, {
    pattern: 'hugeMarker',
    fixed: true,
    mode: 'context',
    contextBefore: 0,
    contextAfter: 0,
    maxBytes: 1000
  });
  assert.equal(byteLimited.returnedBytes, 1000);
  assert.equal(byteLimited.contextTruncated, true);
  assert.equal(byteLimited.files[0].ranges[0].contentTruncated, true);
  assert.ok(Buffer.byteLength(byteLimited.files[0].ranges[0].content, 'utf8') <= 1000);

  const implicitContext = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    contextBefore: 2,
    contextAfter: 0,
    maxBytes: 20000
  });
  assert.equal(implicitContext.mode, 'context', 'context options without a mode should retain explicit context behavior');

  const explicitAuto = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'auto',
    maxFiles: 1,
    maxBytes: 20000
  });
  assert.equal(explicitAuto.mode, 'auto');
  assert.equal(explicitAuto.maxFiles, 1, 'explicit auto mode should accept caller limit overrides');
  assert.equal(explicitAuto.returnedFileCount, 1);

  const explicitCompact = await relaiSearch(workspace, {}, {
    pattern: 'alphaThing',
    fixed: true,
    mode: 'compact',
    contextBefore: 2
  });
  assert.equal(explicitCompact.mode, undefined, 'explicit compact mode must override contextual options');
  assert.equal(explicitCompact.files, undefined);

  await assert.rejects(
    () => relaiSearch(workspace, {}, { pattern: 'alphaThing', mode: 'expanded' }),
    /mode must be one of: auto, compact, context/
  );

  console.log('Adaptive context search unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
