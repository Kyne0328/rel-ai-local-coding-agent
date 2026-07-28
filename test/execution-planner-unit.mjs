import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { planEdit } from "../src/executionPlanner.js";
import { MAX_BATCH_EDITS, MAX_BATCH_REPLACEMENTS, MAX_BATCH_INPUT_BYTES, MAX_BATCH_SNAPSHOT_BYTES } from "../src/editLimits.js";

assert.equal(MAX_BATCH_EDITS, 100);
assert.equal(MAX_BATCH_REPLACEMENTS, 500);
assert.equal(MAX_BATCH_INPUT_BYTES, 8 * 1024 * 1024);
assert.equal(MAX_BATCH_SNAPSHOT_BYTES, 64 * 1024 * 1024);

function gitShell(command, options = {}) {
  return execSync(command, options);
}

function makeTempRepo(filename = 'hello.js', content = 'module.exports = {};') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-ep-'));
  gitShell('git init', { cwd: dir, stdio: 'pipe' });
  gitShell('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  gitShell('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.mkdirSync(path.dirname(path.join(dir, filename)), { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content);
  gitShell('git add .', { cwd: dir, stdio: 'pipe' });
  gitShell('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

// 1. replace path
{
  const dir = makeTempRepo('foo.js', 'const x = 1;');
  const workspace = { alias: 'test', path: dir };
  const config = {};
  try {
    const result = await planEdit(workspace, config, { path: 'foo.js', oldText: 'const x = 1;', newText: 'const x = 2;' });
    assert.equal(result.plannerPath, 'replace', 'replace path: plannerPath must be replace');
    assert.ok(result.plannerReason, 'replace path: plannerReason must be present');
    assert.ok('ok' in result, 'replace path: result must have ok field');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 2. write path (direct)
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const config = {};
  try {
    const result = await planEdit(workspace, config, { path: 'new.js', content: 'module.exports = {};' });
    assert.equal(result.plannerPath, 'write', 'write path: plannerPath must be write');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 3. staged write threshold
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const config = {};
  try {
    const result = await planEdit(workspace, config, { path: 'big.js', content: 'x'.repeat(8001) });
    assert.equal(result.plannerPath, 'write:staged', 'staged write: plannerPath must be write:staged');
    const written = fs.readFileSync(path.join(dir, 'big.js'), 'utf8');
    assert.equal(written.length, 8001, 'staged: file must be written to disk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 4. apply-update path
{
  const dir = makeTempRepo('foo.js', 'const a = 1;\n');
  const workspace = { alias: 'test', path: dir };
  const config = {};
  try {
    const patch = `--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n`;
    const result = await planEdit(workspace, config, { updateText: patch });
    assert.equal(result.plannerPath, 'apply-update', 'apply-update path: plannerPath must be apply-update');
    assert.equal(result.diff, undefined, 'apply-update path: diff must only be returned when explicitly requested');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 5. ambiguous error
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const config = {};
  try {
    await assert.rejects(
      () => planEdit(workspace, config, { path: 'x.js', oldText: 'a', content: 'b' }),
      (err) => {
        assert.ok(err.message.includes('ambiguous'), `ambiguous error: message must contain 'ambiguous', got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 6. no-intent error
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const config = {};
  try {
    await assert.rejects(
      () => planEdit(workspace, config, { path: 'x.js' }),
      (err) => {
        assert.ok(err.message.includes('must provide one of'), `no-intent error: message must contain 'must provide one of', got: ${err.message}`);
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 7. oldText without newText → validation error
{
  const dir = makeTempRepo('foo.js', 'const x = 1;\n');
  const workspace = { alias: 'test', path: dir };
  try {
    await planEdit(workspace, {}, { path: 'foo.js', oldText: 'const x = 1;' });
    assert.fail('should have thrown for missing newText');
  } catch (err) {
    assert.ok(err.message.includes('newText'), 'missing-newtext: error must mention newText');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 8. batch edits (T3): several edits in one call after atomic preflight
{
  const dir = makeTempRepo('a.js', 'let a = 1;\n');
  fs.writeFileSync(path.join(dir, 'b.js'), 'let b = 1;\n');
  gitShell('git add . && git commit -m more', { cwd: dir, stdio: 'pipe' });
  const workspace = { alias: 'test', path: dir };
  try {
    const result = await planEdit(workspace, {}, { edits: [
      { path: 'a.js', oldText: 'let a = 1;', newText: 'let a = 2;' },
      { path: 'b.js', content: 'let b = 99;\n' }
    ] });
    assert.equal(result.plannerPath, 'batch', 'batch: plannerPath must be batch');
    assert.equal(result.ok, true, 'batch: all edits should succeed');
    assert.equal(result.editCount, 2, 'batch: two edits reported');
    assert.equal(result.preflightAtomic, true, 'batch: preflightAtomic flag must be true');
    assert.equal(result.rollbackAtomic, true, 'batch: rollback support must be active');
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8').replaceAll('\r\n', '\n'), 'let a = 2;\n', 'batch: replace applied');
    assert.equal(fs.readFileSync(path.join(dir, 'b.js'), 'utf8').replaceAll('\r\n', '\n'), 'let b = 99;\n', 'batch: write applied');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 9. batch atomicity: one bad edit fails preflight and no earlier edit is written
{
  const dir = makeTempRepo('a.js', 'let a = 1;\n');
  const workspace = { alias: 'test', path: dir };
  try {
    const result = await planEdit(workspace, {}, { edits: [
      { path: 'a.js', oldText: 'let a = 1;', newText: 'let a = 2;' },
      { path: 'a.js', oldText: 'NOT PRESENT', newText: 'x' }
    ] });
    assert.equal(result.ok, false, 'batch: overall ok false when one edit fails');
    assert.equal(result.preflightAtomic, true, 'batch: preflightAtomic flag must be true');
    assert.equal(result.rollbackAtomic, true, 'batch: preflight refusal is atomic');
    assert.equal(result.appliedCount, 0, 'batch: no edit should be applied after preflight failure');
    assert.equal(result.results.length, 2, 'batch: both preflight results present');
    assert.ok(result.results.some((r) => r.ok === false), 'batch: a failure is reported');
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8').replaceAll('\r\n', '\n'), 'let a = 1;\n', 'batch: failed preflight leaves original file unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 10. batch runtime rollback: a later write failure restores earlier applied files.
{
  const dir = makeTempRepo('a.js', 'let a = 1;\n');
  const workspace = { alias: 'test', path: dir };
  try {
    const result = await planEdit(workspace, {}, { edits: [
      { path: 'a.js', oldText: 'let a = 1;', newText: 'let a = 2;' },
      { path: 'a.js', oldText: 'let a = 1;', newText: 'let a = 3;' }
    ] });
    assert.equal(result.ok, false);
    assert.equal(result.rollbackAtomic, true);
    assert.equal(result.rollback?.ok, true);
    assert.equal(result.appliedCount, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'a.js'), 'utf8').replaceAll('\r\n', '\n'), 'let a = 1;\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 11. runChecks + returnDiff post-actions in one call
{
  const dir = makeTempRepo('foo.js', 'const x = 1;\n');
  const workspace = { alias: 'test', path: dir };
  try {
    const result = await planEdit(workspace, {}, { path: 'foo.js', oldText: 'const x = 1;', newText: 'const x = 2;', returnDiff: true });
    assert.ok(result.diff, 'post-actions: returnDiff attaches a diff');
    assert.ok(String(result.diff.diff || '').includes('const x = 2'), 'post-actions: diff reflects the edit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 12. patch returnDiff is owned by the planner, not the patch primitive
{
  const dir = makeTempRepo('foo.js', 'const a = 1;\n');
  const workspace = { alias: 'test', path: dir };
  try {
    const patch = `--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n`;
    const result = await planEdit(workspace, {}, { updateText: patch, returnDiff: true });
    assert.ok(result.diff, 'patch post-actions: returnDiff attaches one review result');
    assert.match(String(result.diff.diff || ''), /const a = 2/, 'patch post-actions: diff reflects the edit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 13. staged patch (T4): start/append/commit applies the joined diff
{
  const dir = makeTempRepo('foo.js', 'const a = 1;\n');
  const workspace = { alias: 'test', path: dir };
  const config = { stateDir: path.join(dir, '.state') };
  try {
    const patch = `--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n`;
    const mid = Math.floor(patch.length / 2);
    const start = await planEdit(workspace, config, { stage: 'start', updateText: patch.slice(0, mid) });
    assert.ok(start.writeId, 'staged patch: start returns writeId');
    await planEdit(workspace, config, { stage: 'append', writeId: start.writeId, updateText: patch.slice(mid) });
    const commit = await planEdit(workspace, config, { stage: 'commit', writeId: start.writeId });
    assert.equal(commit.plannerPath, 'apply-update:staged', 'staged patch: commit routes to staged apply-update');
    assert.equal(fs.readFileSync(path.join(dir, 'foo.js'), 'utf8').replaceAll('\r\n', '\n'), 'const a = 2;\n', 'staged patch: diff applied on commit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 14. large batch dry-run must not create files, journals, or staged payloads.
{
  const dir = makeTempRepo();
  const stateDir = path.join(dir, '.state');
  const workspace = { alias: 'test', path: dir };
  const config = { stateDir };
  try {
    const result = await planEdit(workspace, config, {
      dryRun: true,
      edits: [{ path: 'large.txt', content: `${'line\n'.repeat(2000)}` }]
    });
    assert.equal(result.ok, true);
    assert.equal(result.appliedCount, 0);
    assert.equal(fs.existsSync(path.join(dir, 'large.txt')), false);
    assert.equal(fs.existsSync(path.join(stateDir, 'write-staging')), false);
    assert.equal(fs.existsSync(path.join(stateDir, 'operation-journal')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 15. structured batches accept 100 edits and compact their response details.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  try {
    const edits = Array.from({ length: MAX_BATCH_EDITS }, (_, index) => ({
      path: `batch/file-${index}.txt`,
      content: `value-${index}\n`
    }));
    const result = await planEdit(workspace, {}, { edits });
    assert.equal(result.ok, true);
    assert.equal(result.editCount, MAX_BATCH_EDITS);
    assert.equal(result.appliedCount, MAX_BATCH_EDITS);
    assert.equal(result.resultDetailsCompacted, true);
    assert.equal(result.results.length, MAX_BATCH_EDITS);
    assert.equal(fs.readFileSync(path.join(dir, 'batch', 'file-0.txt'), 'utf8'), 'value-0\n');
    assert.equal(fs.readFileSync(path.join(dir, 'batch', 'file-99.txt'), 'utf8'), 'value-99\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 16. runtime enforcement rejects more than 100 structured edits before mutation.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  try {
    const edits = Array.from({ length: MAX_BATCH_EDITS + 1 }, (_, index) => ({
      path: `too-many-${index}.txt`,
      content: 'x'
    }));
    await assert.rejects(
      () => planEdit(workspace, {}, { edits }),
      new RegExp(`at most ${MAX_BATCH_EDITS} structured batch edits`)
    );
    assert.equal(fs.existsSync(path.join(dir, 'too-many-0.txt')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 17. aggregate replacement operations are bounded across the whole batch.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  try {
    const edits = Array.from({ length: 11 }, (_, editIndex) => ({
      path: `replace-${editIndex}.txt`,
      replacements: Array.from(
        { length: editIndex === 10 ? 1 : 50 },
        (_, replacementIndex) => ({ oldText: `old-${replacementIndex}`, newText: `new-${replacementIndex}` })
      )
    }));
    await assert.rejects(
      () => planEdit(workspace, {}, { edits }),
      new RegExp(`at most ${MAX_BATCH_REPLACEMENTS} total replacement operations`)
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 18. aggregate structured batch payloads are capped below the HTTP body limit.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  try {
    await assert.rejects(
      () => planEdit(workspace, {}, {
        edits: [{ path: 'oversized.txt', content: 'x'.repeat(MAX_BATCH_INPUT_BYTES) }]
      }),
      new RegExp(`max is ${MAX_BATCH_INPUT_BYTES}`)
    );
    assert.equal(fs.existsSync(path.join(dir, 'oversized.txt')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 19. rollback snapshot size is checked before preflight reads a large target.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const target = path.join(dir, 'large-existing.txt');
  try {
    fs.writeFileSync(target, '');
    fs.truncateSync(target, MAX_BATCH_SNAPSHOT_BYTES + 1);
    await assert.rejects(
      () => planEdit(workspace, {}, { edits: [{ path: 'large-existing.txt', content: 'replacement\n' }] }),
      new RegExp(`max is ${MAX_BATCH_SNAPSHOT_BYTES}`)
    );
    assert.equal(fs.statSync(target).size, MAX_BATCH_SNAPSHOT_BYTES + 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('execution-planner unit tests passed.');
