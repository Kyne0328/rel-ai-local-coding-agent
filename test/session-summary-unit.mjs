import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSessionSummary } = require('../src/tools.js');

const noSessionPolicy = { trusted: true, sessionActive: false, sessionCreatedAt: null, taskHint: null, source: 'default' };

// 1. Empty entries, no session → all empty, windowSource: recent_entries
{
  const result = buildSessionSummary([], 'myapp', noSessionPolicy);
  assert.equal(result.windowSource, 'recent_entries');
  assert.equal(result.sessionActive, false);
  assert.equal(result.sessionCreatedAt, null);
  assert.equal(result.taskHint, null);
  assert.equal(result.entryCount, 0);
  assert.deepEqual(result.filesChanged, []);
  assert.deepEqual(result.checksRun, []);
  assert.equal(result.diffReviewed, false);
  assert.deepEqual(result.plannerDecisions, []);
  console.log('1. empty entries + no session: OK');
}

// 2. Session active: only entries with ts >= sessionCreatedAt are included
{
  const policy = { trusted: true, sessionActive: true, sessionCreatedAt: '2026-05-26T12:00:00.000Z', taskHint: 'fix auth', source: 'session_file' };
  const entries = [
    { ts: '2026-05-26T11:59:59.000Z', tool: 'relai_edit', workspace: 'myapp', ok: true, filePath: 'old.js', plannerPath: 'exact_replace', plannerReason: 'before session' },
    { ts: '2026-05-26T12:00:01.000Z', tool: 'relai_edit', workspace: 'myapp', ok: true, filePath: 'src/auth.js', plannerPath: 'exact_replace', plannerReason: 'large file' },
    { ts: '2026-05-26T12:01:00.000Z', tool: 'relai_run_checks', workspace: 'myapp', ok: true, validationLevel: 'focused' },
  ];
  const result = buildSessionSummary(entries, 'myapp', policy);
  assert.equal(result.windowSource, 'session_file');
  assert.equal(result.sessionActive, true);
  assert.equal(result.sessionCreatedAt, '2026-05-26T12:00:00.000Z');
  assert.equal(result.taskHint, 'fix auth');
  assert.equal(result.entryCount, 2, 'only entries after session start');
  assert.deepEqual(result.filesChanged, ['src/auth.js']);
  assert.deepEqual(result.checksRun, [{ validationLevel: 'focused', passed: true }]);
  assert.equal(result.diffReviewed, false);
  assert.deepEqual(result.plannerDecisions, [{ plannerPath: 'exact_replace', plannerReason: 'large file' }]);
  console.log('2. session filter: OK');
}

// 3. filesChanged deduplication (single filePath + multi-path filePaths array)
{
  const entries = [
    { ts: '2026-05-26T12:00:00.000Z', tool: 'relai_write', workspace: 'myapp', ok: true, filePath: 'src/auth.js' },
    { ts: '2026-05-26T12:01:00.000Z', tool: 'relai_replace', workspace: 'myapp', ok: true, filePath: 'src/auth.js' },
    { ts: '2026-05-26T12:02:00.000Z', tool: 'relai_clear_files', workspace: 'myapp', ok: true, filePaths: ['src/old.js', 'src/auth.js'] },
  ];
  const result = buildSessionSummary(entries, 'myapp', noSessionPolicy);
  const actualFilesChanged = [...result.filesChanged];
  const expectedFilesChanged = ['src/auth.js', 'src/old.js'];
  actualFilesChanged.sort((a, b) => a.localeCompare(b));
  expectedFilesChanged.sort((a, b) => a.localeCompare(b));
  assert.deepEqual(actualFilesChanged, expectedFilesChanged);
  console.log('3. filesChanged dedup: OK');
}

// 4. checksRun: collects validationLevel + passed per relai_run_checks entry
{
  const entries = [
    { ts: '2026-05-26T12:00:00.000Z', tool: 'relai_run_checks', workspace: 'myapp', ok: true, validationLevel: 'focused' },
    { ts: '2026-05-26T12:01:00.000Z', tool: 'relai_run_checks', workspace: 'myapp', ok: false, validationLevel: 'broader' },
    { ts: '2026-05-26T12:02:00.000Z', tool: 'relai_run_checks', workspace: 'myapp', ok: true },
  ];
  const result = buildSessionSummary(entries, 'myapp', noSessionPolicy);
  assert.deepEqual(result.checksRun, [
    { validationLevel: 'focused', passed: true },
    { validationLevel: 'broader', passed: false },
  ], 'only entries with validationLevel included; entry without validationLevel skipped');
  console.log('4. checksRun: OK');
}

// 5. diffReviewed: true when relai_diff entry in window
{
  const entries = [
    { ts: '2026-05-26T12:00:00.000Z', tool: 'relai_diff', workspace: 'myapp', ok: true },
  ];
  const result = buildSessionSummary(entries, 'myapp', noSessionPolicy);
  assert.equal(result.diffReviewed, true);
  console.log('5. diffReviewed true: OK');
}

// 6. plannerDecisions: deduped by plannerPath
{
  const entries = [
    { ts: '2026-05-26T12:00:00.000Z', tool: 'relai_edit', workspace: 'myapp', ok: true, filePath: 'a.js', plannerPath: 'exact_replace', plannerReason: 'first' },
    { ts: '2026-05-26T12:01:00.000Z', tool: 'relai_edit', workspace: 'myapp', ok: true, filePath: 'b.js', plannerPath: 'exact_replace', plannerReason: 'second' },
    { ts: '2026-05-26T12:02:00.000Z', tool: 'relai_edit', workspace: 'myapp', ok: true, filePath: 'c.js', plannerPath: 'full_write', plannerReason: 'rewrite' },
  ];
  const result = buildSessionSummary(entries, 'myapp', noSessionPolicy);
  assert.equal(result.plannerDecisions.length, 2, 'deduplicated by plannerPath');
  assert.deepEqual(result.plannerDecisions[0], { plannerPath: 'exact_replace', plannerReason: 'first' });
  assert.deepEqual(result.plannerDecisions[1], { plannerPath: 'full_write', plannerReason: 'rewrite' });
  console.log('6. plannerDecisions dedup: OK');
}

// 7. Entries from other workspaces are excluded
{
  const entries = [
    { ts: '2026-05-26T12:00:00.000Z', tool: 'relai_edit', workspace: 'other', ok: true, filePath: 'other.js', plannerPath: 'exact_replace', plannerReason: 'x' },
    { ts: '2026-05-26T12:01:00.000Z', tool: 'relai_edit', workspace: 'myapp', ok: true, filePath: 'mine.js', plannerPath: 'exact_replace', plannerReason: 'y' },
  ];
  const result = buildSessionSummary(entries, 'myapp', noSessionPolicy);
  assert.deepEqual(result.filesChanged, ['mine.js']);
  assert.equal(result.entryCount, 1);
  console.log('7. workspace filter: OK');
}

console.log('session-summary unit tests passed.');
