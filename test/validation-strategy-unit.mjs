import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { classifyFiles, selectValidationLevel } from "../src/validationStrategy.js";
const GIT_EXECUTABLE = process.platform === 'win32'
  ? String.raw`C:\Program Files\Git\cmd\git.exe`
  : '/usr/bin/git';

const classificationCases = [
  { name: 'no changes', files: [], level: 'focused', reason: /no changed files/ },
  { name: 'single documentation file', files: ['README.md'], level: 'minimal', reason: /single low-risk/ },
  { name: 'single source file', files: ['src/foo.js'], level: 'focused', reason: /single source/ },
  { name: 'package manifest', files: ['package.json'], level: 'extended', reason: /config or CI/ },
  { name: 'CI workflow', files: ['.github/workflows/ci.yml'], level: 'extended' },
  { name: 'server source', files: ['src/server.js'], level: 'broad', reason: /HTTP, core operator/ },
  { name: 'UI source', files: ['src/ui/foo.js'], level: 'broad' },
  { name: 'HTML source', files: ['index.html'], level: 'broad' },
  { name: 'CSS source', files: ['styles.css'], level: 'broad' },
  { name: 'six files across two directories', files: ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js'], level: 'broad', reason: /multiple directories/ },
  { name: 'five files across two directories', files: ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js'], level: 'focused' },
  { name: 'six files in one directory', files: ['a/1.js', 'a/2.js', 'a/3.js', 'a/4.js', 'a/5.js', 'a/6.js'], level: 'focused' },
  { name: 'config rule outranks source', files: ['src/foo.js', 'config.json'], level: 'extended' },
  { name: 'HTML rule across multiple files', files: ['src/foo.js', 'index.html'], level: 'broad' },
  {
    name: 'custom threshold',
    files: ['a/1.js', 'a/2.js', 'b/1.js', 'b/2.js'],
    config: { validationRules: { broadMultiDirThreshold: 4 } },
    level: 'broad',
    reason: /4 files across multiple directories/
  },
  {
    name: 'custom path rule',
    files: ['src/payments/api.js'],
    config: { validationRules: { customRules: [{ level: 'broad', pattern: 'src/payments/', reason: 'payments touched' }] } },
    level: 'broad',
    reason: /payments touched/
  },
  {
    name: 'custom rule overrides default',
    files: ['package.json'],
    config: { validationRules: { customRules: [{ level: 'broad', pattern: 'package.json', reason: 'manifest policy' }] } },
    level: 'broad',
    reason: /manifest policy/
  },
  {
    name: 'non-matching custom rule falls through',
    files: ['package.json'],
    config: { validationRules: { customRules: [{ level: 'broad', pattern: 'src/payments/' }] } },
    level: 'extended'
  },
  {
    name: 'invalid custom level is ignored',
    files: ['src/foo.js'],
    config: { validationRules: { customRules: [{ level: 'invalid', pattern: 'src/' }] } },
    level: 'focused'
  },
  {
    name: 'custom top-directory threshold',
    files: ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js'],
    config: { validationRules: { broadMultiDirTopDirs: 3 } },
    level: 'focused'
  }
];

for (const testCase of classificationCases) {
  const result = classifyFiles(testCase.files, testCase.config);
  assert.equal(result.level, testCase.level, `${testCase.name}: ${result.reason}`);
  if (testCase.reason) assert.match(result.reason, testCase.reason, testCase.name);
}

assert.deepEqual(selectValidationLevel(os.tmpdir(), {}, 'extended'), {
  level: 'extended',
  reason: 'caller-specified',
  changedFiles: []
});

const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-vs-nogit-'));
try {
  const result = selectValidationLevel(nonGit, {}, null);
  assert.equal(result.level, 'focused');
  assert.match(result.reason, /unavailable/);
} finally {
  fs.rmSync(nonGit, { recursive: true, force: true });
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-vs-repo-'));
try {
  git(['init'], repo);
  git(['config', 'user.email', 'test@test.com'], repo);
  git(['config', 'user.name', 'Test'], repo);
  fs.writeFileSync(path.join(repo, 'initial.txt'), 'init');
  git(['add', '.'], repo);
  git(['commit', '-m', 'init'], repo);

  assertDetected('package.json', '{}', 'extended', { stage: true });
  assertDetected('src/ui/dashboard.js', 'export default {};', 'broad');
  assertDetected('CHANGELOG.md', '# changes', 'minimal');

  resetRepo();
  for (const file of ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js']) write(file, 'x');
  assert.equal(selectValidationLevel(repo, {}, null).level, 'broad');
  const taskScoped = selectValidationLevel(repo, {}, null, ['src/task-owned.js']);
  assert.equal(taskScoped.level, 'focused');
  assert.equal(taskScoped.reason, 'single source file');
  assert.deepEqual(taskScoped.changedFiles, ['src/task-owned.js']);
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}

function assertDetected(relativePath, content, expectedLevel, options = {}) {
  resetRepo();
  write(relativePath, content);
  if (options.stage) git(['add', relativePath], repo);
  const result = selectValidationLevel(repo, {}, null);
  assert.equal(result.level, expectedLevel, `${relativePath}: ${result.reason}`);
}

function write(relativePath, content) {
  const target = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function resetRepo() {
  git(['reset', '--hard', 'HEAD'], repo);
  git(['clean', '-fd'], repo);
}

function git(args, cwd) {
  execFileSync(GIT_EXECUTABLE, args, { cwd, stdio: 'pipe' });
}

console.log(`Validation strategy tests passed across ${classificationCases.length} classification cases and Git integration coverage.`);
