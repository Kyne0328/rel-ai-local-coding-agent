import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CANONICAL_TASK_STATUSES,
  TASK_TRANSITIONS,
  assertTaskStatusTransition,
  canTransitionTaskStatus,
  isCanonicalTaskStatus,
  isTerminalTaskStatus,
  normalizeHistoricalTaskStatus
} = require('../src/taskState.js');

assert.deepEqual(CANONICAL_TASK_STATUSES, [
  'queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating',
  'completed', 'completed_with_warnings', 'failed', 'cancelled'
]);
for (const status of CANONICAL_TASK_STATUSES) assert.equal(isCanonicalTaskStatus(status), true, status);
for (const status of ['completed', 'completed_with_warnings', 'failed', 'cancelled']) assert.equal(isTerminalTaskStatus(status), true, status);
for (const status of ['queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating']) assert.equal(isTerminalTaskStatus(status), false, status);

for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
  for (const target of targets) {
    assert.equal(canTransitionTaskStatus(from, target), true, `${from} -> ${target}`);
    assert.equal(assertTaskStatusTransition(from, target), target);
  }
}
assert.equal(canTransitionTaskStatus('completed', 'running'), false);
assert.equal(canTransitionTaskStatus('failed', 'planning'), false);
assert.equal(canTransitionTaskStatus('cancelled', 'validating'), false);
assert.throws(() => assertTaskStatusTransition('completed', 'running'), error => error?.code === 'INVALID_TASK_STATE');

assert.equal(normalizeHistoricalTaskStatus('working'), 'running');
assert.equal(normalizeHistoricalTaskStatus('waiting'), 'planning');
assert.equal(normalizeHistoricalTaskStatus('awaiting_approval'), 'waiting_for_approval');
assert.equal(normalizeHistoricalTaskStatus('attention', { failures: 1 }), 'failed');
assert.equal(normalizeHistoricalTaskStatus('attention', { completionKnown: true, failures: 1 }), 'completed_with_warnings');
assert.equal(normalizeHistoricalTaskStatus('inactive', { endedAt: Date.now() }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('inactive', { failures: 1, errorSummary: 'failed' }), 'failed');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: true }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: true, failures: 1 }), 'completed_with_warnings');
assert.equal(normalizeHistoricalTaskStatus('unknown-terminal', { endedAt: Date.now() }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('unknown-active', {}), 'planning');

console.log('Canonical task-state vocabulary, transitions, terminal protection, and historical normalization passed.');
