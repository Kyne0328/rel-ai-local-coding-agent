import assert from 'node:assert/strict';

import { WORKFLOW_INTENTS } from '../src/workflow/contracts.js';
import { classifyTaskIntent, normalizeTaskIntent } from '../src/workflow/intent.js';

const scenarios = [
  ['Fix this failing unit test', 'bugfix'],
  ['Add OAuth login support', 'feature'],
  ['Explain how this module works', 'investigation'],
  ['Clean up duplicate code without changing behavior', 'cleanup'],
  ['Refactor the task history ownership model', 'refactor'],
  ['Hard cutover the old dashboard transport', 'migration'],
  ['Optimize dashboard update latency', 'performance'],
  ['Update the README documentation', 'documentation'],
  ['Review the repository architecture', 'review'],
  ['Publish the next release', 'release'],
  ['Make this better somehow', 'other']
];

for (const [objective, expected] of scenarios) {
  assert.ok(WORKFLOW_INTENTS.includes(expected), `${expected} must be a canonical workflow intent`);
  assert.equal(classifyTaskIntent(objective), expected, objective);
}
assert.equal(classifyTaskIntent(''), 'auto');
assert.equal(normalizeTaskIntent('performance'), 'performance');
assert.equal(normalizeTaskIntent('not-a-real-intent', 'feature'), 'feature');

console.log('Task intent classification tests passed.');
