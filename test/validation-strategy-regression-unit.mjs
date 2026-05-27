import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyFiles } = require('../src/validationStrategy.js');

const scenarios = [
  { name: 'empty files', files: [], expectLevel: 'focused', expectReasonMatch: /no changed files/ },
  { name: 'single .md', files: ['README.md'], expectLevel: 'minimal', expectReasonMatch: /single low-risk/ },
  { name: 'single .txt', files: ['notes.txt'], expectLevel: 'minimal' },
  { name: 'single .js', files: ['src/foo.js'], expectLevel: 'focused', expectReasonMatch: /single source/ },
  { name: 'single package.json', files: ['package.json'], expectLevel: 'extended', expectReasonMatch: /config or CI/ },
  { name: 'single .github workflow', files: ['.github/workflows/ci.yml'], expectLevel: 'extended' },
  { name: 'single src/server.js', files: ['src/server.js'], expectLevel: 'broad', expectReasonMatch: /HTTP, core operator/ },
  { name: 'single src/api/users.js', files: ['src/api/users.js'], expectLevel: 'broad' },
  { name: 'single src/tools.js', files: ['src/tools.js'], expectLevel: 'broad' },
  { name: 'single ui file', files: ['src/ui/foo.js'], expectLevel: 'broad' },
  { name: 'single .html', files: ['index.html'], expectLevel: 'broad' },
  { name: 'single .css', files: ['styles.css'], expectLevel: 'broad' },
  { name: '6 files across 2 dirs', files: ['a/1.js','a/2.js','a/3.js','b/1.js','b/2.js','b/3.js'], expectLevel: 'broad', expectReasonMatch: /6 files across multiple/ },
  { name: '5 files across 2 dirs (under threshold)', files: ['a/1.js','a/2.js','a/3.js','b/1.js','b/2.js'], expectLevel: 'focused' },
  { name: '6 files all in one dir', files: ['a/1.js','a/2.js','a/3.js','a/4.js','a/5.js','a/6.js'], expectLevel: 'focused' },
  { name: '2 files, one is .json (rule priority)', files: ['src/foo.js', 'config.json'], expectLevel: 'extended' },
  { name: '2 files one .html (broad rule wins over extended)', files: ['src/foo.js', 'index.html'], expectLevel: 'extended' /* .json/.yml rule fires first via extended; here only .html so broad */ },
];

// Override the .html scenario expectation: .html is in broad rule, not extended
scenarios[scenarios.length - 1] = { name: '2 files one .html', files: ['src/foo.js', 'index.html'], expectLevel: 'broad' };

let failed = 0;
for (const s of scenarios) {
  const result = classifyFiles(s.files, null);
  try {
    assert.equal(result.level, s.expectLevel, `level mismatch for "${s.name}": got ${result.level} reason="${result.reason}"`);
    if (s.expectReasonMatch) assert.match(result.reason, s.expectReasonMatch, `reason mismatch for "${s.name}"`);
    console.log(`OK ${s.name} -> ${result.level}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${s.name}: ${e.message}`);
  }
}

// Override scenarios
const overrideScenarios = [
  {
    name: 'override broadMultiDirThreshold=4',
    files: ['a/1.js','a/2.js','b/1.js','b/2.js'],
    config: { validationRules: { broadMultiDirThreshold: 4 } },
    expectLevel: 'broad',
    expectReasonMatch: /4 files across multiple/
  },
  {
    name: 'customRule promotes src/payments/',
    files: ['src/payments/api.js'],
    config: { validationRules: { customRules: [{ level: 'broad', pattern: 'src/payments/', reason: 'payments' }] } },
    expectLevel: 'broad',
    expectReasonMatch: /payments/
  },
  {
    name: 'customRule no match falls through',
    files: ['package.json'],
    config: { validationRules: { customRules: [{ level: 'broad', pattern: 'src/payments/', reason: 'x' }] } },
    expectLevel: 'extended'
  },
  {
    name: 'override broadMultiDirTopDirs=3 requires 3 dirs',
    files: ['a/1.js','a/2.js','a/3.js','b/1.js','b/2.js','b/3.js'],
    config: { validationRules: { broadMultiDirTopDirs: 3 } },
    expectLevel: 'focused',
  }
];

for (const s of overrideScenarios) {
  const result = classifyFiles(s.files, s.config);
  try {
    assert.equal(result.level, s.expectLevel, `level mismatch for "${s.name}": got ${result.level}`);
    if (s.expectReasonMatch) assert.match(result.reason, s.expectReasonMatch);
    console.log(`OK ${s.name} -> ${result.level}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${s.name}: ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`\nvalidation-strategy regression: ${failed} failure(s)`);
  process.exit(1);
}

console.log('validation-strategy regression tests passed.');
