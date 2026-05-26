import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { selectValidationLevel } = require('../src/validationStrategy.js');

function makeTempRepo(filename, content = 'hello') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-vs-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'initial.txt'), 'init');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  // Write changed file (unstaged)
  const filePath = path.join(dir, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return dir;
}

// 1. Override level respected, no git needed
{
  const r = selectValidationLevel(os.tmpdir(), {}, 'extended');
  assert.equal(r.level, 'extended', 'override: level must be extended');
  assert.equal(r.reason, 'caller-specified', 'override: reason must be caller-specified');
}

// 2. Non-git directory → focused fallback
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-vs-nogit-'));
  const r = selectValidationLevel(tmp, {}, null);
  assert.equal(r.level, 'focused', 'no-git: level must be focused');
  assert.ok(r.reason.includes('unavailable'), 'no-git: reason must mention unavailable');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 3. Config file (package.json) staged → extended
{
  const dir = makeTempRepo('package.json', '{"name":"test"}');
  execSync('git add package.json', { cwd: dir, stdio: 'pipe' });
  const r = selectValidationLevel(dir, {}, null);
  assert.equal(r.level, 'extended', 'config-file: level must be extended');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 4. Single source file unstaged → focused
{
  const dir = makeTempRepo('src/utils.js', 'module.exports = {}');
  const r = selectValidationLevel(dir, {}, null);
  assert.equal(r.level, 'focused', 'source-file: level must be focused');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 5. Markdown file only → minimal
{
  const dir = makeTempRepo('CHANGELOG.md', '# changes');
  const r = selectValidationLevel(dir, {}, null);
  assert.equal(r.level, 'minimal', 'markdown: level must be minimal');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 6. CI workflow file → extended
{
  const dir = makeTempRepo('.github/workflows/ci.yml', 'on: push');
  const r = selectValidationLevel(dir, {}, null);
  assert.equal(r.level, 'extended', 'ci-workflow: level must be extended');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 7. Invalid override → falls through to auto-select (non-git dir → focused)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-vs-inv-'));
  const r = selectValidationLevel(tmp, {}, 'not-a-level');
  assert.equal(r.level, 'focused', 'invalid-override: falls through to auto-select');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('validationStrategy unit tests passed.');
