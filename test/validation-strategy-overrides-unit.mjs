import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { classifyFiles } = require('../src/validationStrategy.js');

// 1. No overrides = default behavior unchanged for narrow change
{
  const result = classifyFiles(['src/foo.js'], null);
  assert.equal(result.level, 'focused');
  console.log('1. default focused: OK');
}

// 2. No overrides = default broad for 6+ files in multiple dirs
{
  const files = ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js'];
  const result = classifyFiles(files, null);
  assert.equal(result.level, 'broad');
  console.log('2. default broad threshold: OK');
}

// 3. Override broadMultiDirThreshold lower (4) -> 4 files in multiple dirs becomes broad
{
  const files = ['a/1.js', 'a/2.js', 'b/1.js', 'b/2.js'];
  const result = classifyFiles(files, { validationRules: { broadMultiDirThreshold: 4 } });
  assert.equal(result.level, 'broad');
  assert.match(result.reason, /4 files across multiple directories/);
  console.log('3. lower threshold triggers broad: OK');
}

// 4. customRule promotes specific path to broad
{
  const files = ['src/payments/api.js'];
  const result = classifyFiles(files, { validationRules: { customRules: [{ level: 'broad', pattern: 'src/payments/', reason: 'payments touched' }] } });
  assert.equal(result.level, 'broad');
  assert.equal(result.reason, 'payments touched');
  console.log('4. customRule promote: OK');
}

// 5. customRule evaluated before defaults
{
  const files = ['package.json'];
  const result = classifyFiles(files, { validationRules: { customRules: [{ level: 'broad', pattern: 'package.json', reason: 'pkg manifest' }] } });
  assert.equal(result.level, 'broad');
  assert.equal(result.reason, 'pkg manifest');
  console.log('5. customRule overrides defaults: OK');
}

// 6. customRule no match falls through to defaults
{
  const files = ['package.json'];
  const result = classifyFiles(files, { validationRules: { customRules: [{ level: 'broad', pattern: 'src/payments/', reason: 'payments' }] } });
  assert.equal(result.level, 'extended');
  console.log('6. customRule no match falls through: OK');
}

// 7. Invalid customRule level is ignored
{
  const files = ['src/foo.js'];
  const result = classifyFiles(files, { validationRules: { customRules: [{ level: 'invalid-level', pattern: 'src/', reason: 'x' }] } });
  assert.equal(result.level, 'focused');
  console.log('7. invalid level ignored: OK');
}

console.log('validation-strategy overrides unit tests passed.');
