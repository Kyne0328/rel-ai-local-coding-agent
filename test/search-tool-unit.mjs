import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { relaiSearch } = require(path.join(root, 'src', 'bridge', 'search.js'));

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

  // maxResults caps matches but reports the real total.
  const capped = await relaiSearch(workspace, config, { pattern: 'alphaThing', ignoreCase: true, maxResults: 1 });
  assert.equal(capped.matches.length, 1);
  assert.equal(capped.truncated, true);
  assert.ok(capped.matchCount > 1);

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

  console.log('Search tool unit test passed.');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
