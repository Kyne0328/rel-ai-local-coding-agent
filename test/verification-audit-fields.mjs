import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiVerify } = require('../src/localRepoBridge.js');
const { planEdit } = require('../src/executionPlanner.js');

const GIT_EXECUTABLE = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';

function git(args, cwd) { // NOSONAR - this smoke test intentionally executes the local Git binary.
  execFileSync(GIT_EXECUTABLE, args, { cwd, stdio: 'pipe' });
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-audit-'));
  git(['init'], dir);
  git(['config', 'user.email', 'test@test.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'readme.md'), '# test\n');
  git(['add', '.'], dir);
  git(['commit', '-m', 'init'], dir);
  return dir;
}

// relaiVerify returns the audit fields required by verification reporting.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const result = await relaiVerify(workspace, {}, {});
  assert.ok('validationLevel' in result, 'relaiVerify: result must have validationLevel');
  assert.ok('validationLevelReason' in result, 'relaiVerify: result must have validationLevelReason');
  assert.ok('aliasNormalizations' in result, 'relaiVerify: result must have aliasNormalizations');
  assert.ok('changedFiles' in result, 'relaiVerify: result must have changedFiles');
  assert.ok(typeof result.validationLevel === 'string', 'relaiVerify: validationLevel must be a string');
  assert.ok(typeof result.aliasNormalizations === 'number', 'relaiVerify: aliasNormalizations must be a number');
  fs.rmSync(dir, { recursive: true, force: true });
}

// planEdit reports the selected planner path and rationale.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const result = await planEdit(workspace, {}, { path: 'hello.js', content: 'module.exports = {};' });
  assert.ok('plannerPath' in result, 'planEdit: result must have plannerPath');
  assert.ok('plannerReason' in result, 'planEdit: result must have plannerReason');
  assert.equal(result.plannerPath, 'write', 'planEdit: small content must route to write');
  assert.ok(typeof result.plannerReason === 'string' && result.plannerReason.length > 0, 'planEdit: plannerReason must be a non-empty string');
  fs.rmSync(dir, { recursive: true, force: true });
}

// Recognized runnable commands report no alias normalization.
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const result = await relaiVerify(workspace, {}, { check: 'echo ok', timeoutMs: 5000 });
  assert.ok('aliasNormalizations' in result, 'aliasNormalizations must be present');
  assert.equal(result.aliasNormalizations, 0, 'echo command needs no normalization');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('Verification audit field tests passed.');
