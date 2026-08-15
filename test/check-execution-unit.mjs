import assert from 'node:assert/strict';
import { buildCheckExecutionStages, checkExecutionPolicy } from '../src/workflow/checkExecution.js';

const units = [
  { command: 'npm run lint', kind: 'lint', scopeKey: 'package:root' },
  { command: 'npm run typecheck', kind: 'typecheck', scopeKey: 'package:root' },
  { command: 'npm test', kind: 'test', scopeKey: 'package:root' },
  { command: 'npm run test:integration', kind: 'test', scopeKey: 'package:root' },
  { command: 'npm run build', kind: 'build', scopeKey: 'package:root' },
  { command: 'eslint . --fix', kind: 'lint', scopeKey: 'package:root' }
];

assert.equal(checkExecutionPolicy(units[0]).parallelSafe, true);
assert.equal(checkExecutionPolicy(units[4]).parallelSafe, false);
assert.equal(checkExecutionPolicy(units[5]).parallelSafe, false);

const stages = buildCheckExecutionStages(units);
assert.equal(stages.length, 4);
assert.equal(stages[0].parallel, true);
assert.deepEqual(stages[0].items.map(item => item.policy.kind), ['lint', 'typecheck', 'test']);
assert.equal(stages[1].parallel, false, 'a second test in the same package should wait for the first test group');
assert.equal(stages[2].parallel, false, 'build should be a serial barrier');
assert.equal(stages[3].parallel, false, 'mutation-looking lint should be a serial barrier');

const unknown = checkExecutionPolicy({ command: 'node custom-check.js', kind: 'other', scopeKey: 'repository' });
assert.equal(unknown.parallelSafe, false, 'unknown commands must stay serial by default');

console.log('Check execution policy tests passed.');
