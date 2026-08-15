import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { relaiSearch } from '../src/bridge/search.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-search-'));
const wsRoot = path.join(tmp, 'repo');
fs.mkdirSync(path.join(wsRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(wsRoot, 'docs'), { recursive: true });
fs.writeFileSync(path.join(wsRoot, 'src', 'alpha.js'), 'function alphaThing() {\n  return 1;\n}\n');
fs.writeFileSync(path.join(wsRoot, 'src', 'beta.js'), 'const beta = alphaThing();\nconst BETA = "ALPHATHING";\n');
fs.writeFileSync(path.join(wsRoot, 'docs', 'notes.md'), 'alphaThing appears here too\n');
fs.writeFileSync(path.join(wsRoot, '.env'), 'ALPHATHING_SECRET=1\n');
const init = spawnSync('git', ['init'], { cwd: wsRoot, encoding: 'utf8' });
assert.equal(init.status, 0, `git init failed: ${init.stderr}`);

const config = {};
const workspace = { alias: 'repo', path: wsRoot };

try {
  // Untracked files are searched — no commit needed.
  const literal = await relaiSearch(workspace, config, { pattern: 'alphaThing(', fixed: true });
  assert.equal(literal.ok, true);
  const literalPaths = literal.matches.map((m) => m.path).sort();
  assert.deepEqual(literalPaths, ['src/alpha.js', 'src/beta.js']);
  const alphaMatch = literal.matches.find((m) => m.path === 'src/alpha.js');
  assert.equal(alphaMatch.line, 1);
  assert.match(alphaMatch.text, /function alphaThing/);

  // Extended regex is the default.
  const regex = await relaiSearch(workspace, config, { pattern: 'alpha(Thing|Nothing)' });
  assert.ok(regex.matches.some((m) => m.path === 'docs/notes.md'), 'regex should match docs/notes.md');

  // ignoreCase widens matches.
  const ci = await relaiSearch(workspace, config, { pattern: 'alphathing', ignoreCase: true });
  assert.ok(ci.matchCount >= 3, `case-insensitive should find at least 3 matches, got ${ci.matchCount}`);

  // Secret paths are filtered out of results.
  assert.equal(ci.matches.some((m) => m.path === '.env'), false, '.env must never appear in matches');

  // glob narrows the search.
  const scoped = await relaiSearch(workspace, config, { pattern: 'alphaThing', glob: 'src/*.js' });
  assert.deepEqual(scoped.matches.map((m) => m.path).sort(), ['src/alpha.js', 'src/beta.js']);

  // maxResults caps matches and stops after one additional visible match proves truncation.
  const capped = await relaiSearch(workspace, config, { pattern: 'alphaThing', ignoreCase: true, maxResults: 1 });
  assert.equal(capped.matches.length, 1);
  assert.equal(capped.truncated, true);
  assert.ok(capped.matchCount > 1);

  // Several independent patterns can fan out inside one public tool call.
  const batch = await relaiSearch(workspace, config, {
    queries: ['alphaThing', 'BETA', 'notPresentAnywhere'],
    fixed: true,
    maxResults: 12,
    mode: 'compact'
  });
  assert.equal(batch.ok, true);
  assert.deepEqual(batch.queries, ['alphaThing', 'BETA', 'notPresentAnywhere']);
  assert.equal(batch.queryCount, 3);
  assert.equal(batch.results.length, 3);
  assert.equal(batch.results[0].pattern, 'alphaThing');
  assert.ok(batch.uniqueFileCount >= 2);
  assert.ok(batch.matchCount >= 3);
  assert.equal(batch.results[2].matchCount, 0);
  assert.equal(batch.results.some(item => Object.hasOwn(item, 'workspace')), false, 'batch children should not repeat workspace metadata');

  // Batch result and context budgets are aggregate limits, not per-query multipliers.
  const aggregateCapped = await relaiSearch(workspace, config, {
    queries: ['alphaThing', 'BETA', 'appears here'],
    fixed: true,
    maxResults: 1,
    mode: 'compact'
  });
  assert.equal(aggregateCapped.resultCount, 1);
  assert.equal(aggregateCapped.results.reduce((sum, item) => sum + (item.matches?.length || 0), 0), 1);

  for (let index = 1; index <= 4; index += 1) {
    const padding = 'x'.repeat(350);
    fs.writeFileSync(path.join(wsRoot, 'docs', `budget-${index}.md`), `${padding}\nbudgetMarker${index}\n${padding}\n`);
  }
  const byteCapped = await relaiSearch(workspace, config, {
    queries: ['budgetMarker1', 'budgetMarker2', 'budgetMarker3', 'budgetMarker4'],
    fixed: true,
    maxResults: 4,
    maxBytes: 1000,
    mode: 'context',
    contextBefore: 1,
    contextAfter: 1
  });
  assert.ok(byteCapped.returnedBytes <= 1000, `batch context must honor the aggregate byte cap, got ${byteCapped.returnedBytes}`);

  const cancelledController = new AbortController();
  cancelledController.abort(new Error('cancelled search batch'));
  await assert.rejects(
    () => relaiSearch(workspace, config, { queries: ['alphaThing', 'BETA'], fixed: true }, { signal: cancelledController.signal }),
    /cancelled search batch/
  );

  // No matches is a valid empty result, not an error.
  const none = await relaiSearch(workspace, config, { pattern: 'zzz_does_not_exist_zzz' });
  assert.equal(none.ok, true);
  assert.deepEqual(none.matches, []);
  assert.equal(none.matchCount, 0);

  // Empty pattern refused.
  await assert.rejects(() => relaiSearch(workspace, config, { pattern: '   ' }), /non-empty pattern/);

  // Non-git workspace gets a clear error.
  const plainDir = path.join(tmp, 'plain');
  fs.mkdirSync(plainDir, { recursive: true });
  await assert.rejects(
    () => relaiSearch({ alias: 'plain', path: plainDir }, config, { pattern: 'x' }),
    /git repository/
  );

  // CRLF-terminated lines must not have trailing \r in matched text (Windows autocrlf regression).
  // Fixture has match on line 1 (not the last line) so whole-blob trim doesn't strip the CRLF before split logic runs.
  fs.writeFileSync(path.join(wsRoot, 'src', 'crlf.js'), 'function alphaThing() {\r\n  alphaThing();\r\n  return 1;\r\n}\r\n');
  const crlfResult = await relaiSearch(workspace, config, { pattern: 'alphaThing', glob: 'src/crlf.js' });
  assert.ok(crlfResult.matches.length > 0, 'should find match in CRLF file');
  const line1Match = crlfResult.matches.find(m => m.line === 1);
  assert.ok(line1Match, 'should find match on line 1');
  assert.ok(!line1Match.text.endsWith('\r'), `CRLF line 1 text should not end with \\r, got: ${JSON.stringify(line1Match.text)}`);
  assert.equal(line1Match.text, 'function alphaThing() {', 'line 1 text should match expected clean text');

  // Search output larger than the generic 1 MiB process cap must preserve the
  // earliest match without scanning the rest of a broad result set.
  const overflowDir = path.join(wsRoot, 'overflow');
  fs.mkdirSync(overflowDir, { recursive: true });
  const overflowLineCount = 12000;
  fs.writeFileSync(path.join(overflowDir, '000-early.txt'), 'overflowMarker early\n');
  fs.writeFileSync(
    path.join(overflowDir, 'zzz-large.txt'),
    (`overflowMarker ${'x'.repeat(96)}\n`).repeat(overflowLineCount)
  );
  const overflow = await relaiSearch(workspace, config, {
    pattern: 'overflowMarker',
    fixed: true,
    glob: 'overflow/*.txt',
    maxResults: 1
  });
  assert.equal(overflow.matches[0]?.path, 'overflow/000-early.txt', 'large search must retain the earliest match');
  assert.equal(overflow.matchCount, 2, 'large search must stop after one extra match proves truncation');
  assert.equal(overflow.truncated, true);

  console.log('Search tool unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
