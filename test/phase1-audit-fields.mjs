import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiVerify } = require('../src/localRepoBridge.js');
const { planEdit } = require('../src/executionPlanner.js');

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-p1-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'initial.txt'), 'init');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

// Test 1: relaiVerify result has Phase 1 audit fields
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

// Test 2: planEdit result has plannerPath and plannerReason
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

// Test 3: aliasNormalizations = 0 for a recognized runnable command (no alias normalization)
{
  const dir = makeTempRepo();
  const workspace = { alias: 'test', path: dir };
  const result = await relaiVerify(workspace, {}, { check: 'echo ok', timeoutMs: 5000 });
  assert.ok('aliasNormalizations' in result, 'aliasNormalizations must be present');
  assert.equal(result.aliasNormalizations, 0, 'echo command needs no normalization');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('phase1-audit-fields tests passed.');
