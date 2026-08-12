import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { classifyFiles, selectValidationLevel } from "../src/validationStrategy.js";
import { GIT_EXECUTABLE } from './helpers/git-executable.mjs';

const classificationCases = [
  { name: 'no changes', files: [], level: 'focused', boundary: 'file', risk: 'low', reason: /no changed files/ },
  { name: 'single documentation file', files: ['README.md'], level: 'minimal', boundary: 'file', risk: 'low', reason: /file boundary with low risk/ },
  { name: 'single source file', files: ['src/foo.js'], level: 'focused', boundary: 'package', risk: 'medium', reason: /package boundary with medium risk/ },
  { name: 'package manifest', files: ['package.json'], level: 'broad', boundary: 'repository', risk: 'high', reason: /repository boundary with high risk/ },
  { name: 'CI workflow', files: ['.github/workflows/ci.yml'], level: 'extended', boundary: 'release', risk: 'high' },
  { name: 'server source', files: ['src/server.js'], level: 'focused', boundary: 'package', risk: 'medium' },
  { name: 'UI source', files: ['src/ui/foo.js'], level: 'focused', boundary: 'package', risk: 'medium' },
  { name: 'HTML source', files: ['index.html'], level: 'focused', boundary: 'file', risk: 'medium' },
  { name: 'CSS source', files: ['styles.css'], level: 'focused', boundary: 'file', risk: 'medium' },
  { name: 'six files across two directories', files: ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js'], level: 'broad', boundary: 'repository', risk: 'medium' },
  { name: 'five files across two directories', files: ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js'], level: 'broad', boundary: 'repository', risk: 'medium' },
  { name: 'six files in one directory', files: ['a/1.js', 'a/2.js', 'a/3.js', 'a/4.js', 'a/5.js', 'a/6.js'], level: 'focused', boundary: 'package', risk: 'medium' },
  { name: 'configuration change raises risk', files: ['src/foo.js', 'config.json'], level: 'broad', boundary: 'package', risk: 'high' },
  { name: 'mixed root and package source', files: ['src/foo.js', 'index.html'], level: 'focused', boundary: 'package', risk: 'medium' },
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
    level: 'broad',
    boundary: 'repository',
    risk: 'high'
  },
  {
    name: 'invalid custom level is ignored',
    files: ['src/foo.js'],
    config: { validationRules: { customRules: [{ level: 'invalid', pattern: 'src/' }] } },
    level: 'focused',
    boundary: 'package',
    risk: 'medium'
  }
];

for (const testCase of classificationCases) {
  const result = classifyFiles(testCase.files, testCase.config);
  assert.equal(result.level, testCase.level, `${testCase.name}: ${result.reason}`);
  if (testCase.boundary) assert.equal(result.boundary, testCase.boundary, `${testCase.name} boundary`);
  if (testCase.risk) assert.equal(result.risk, testCase.risk, `${testCase.name} risk`);
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

  assertDetected('package.json', '{}', 'broad', { stage: true });
  assertDetected('src/ui/dashboard.js', 'export default {};', 'focused');
  assertDetected('CHANGELOG.md', '# changes', 'extended');

  resetRepo();
  for (const file of ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js']) write(file, 'x');
  assert.equal(selectValidationLevel(repo, {}, null).level, 'focused');
  const taskScoped = selectValidationLevel(repo, {}, null, ['src/task-owned.js']);
  assert.equal(taskScoped.level, 'focused');
  assert.equal(taskScoped.reason, 'package boundary with medium risk');
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
