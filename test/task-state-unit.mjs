import assert from 'node:assert/strict';
const {
  CANONICAL_TASK_STATUSES,
  TASK_TRANSITIONS,
  assertTaskStatusTransition,
  canTransitionTaskStatus,
  isCanonicalTaskStatus,
  isTerminalTaskStatus,
  normalizeHistoricalTaskStatus
} = await import('../src/taskState.js');

assert.deepEqual(CANONICAL_TASK_STATUSES, [
  'queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating',
  'validation_failed', 'completed', 'failed', 'cancelled'
]);
for (const status of CANONICAL_TASK_STATUSES) assert.equal(isCanonicalTaskStatus(status), true, status);
for (const status of ['completed', 'failed', 'cancelled']) assert.equal(isTerminalTaskStatus(status), true, status);
assert.equal(isCanonicalTaskStatus('completed_with_warnings'), false, 'legacy warning status is not canonical');
for (const status of ['queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating', 'validation_failed']) assert.equal(isTerminalTaskStatus(status), false, status);

for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
  for (const target of targets) {
    assert.equal(canTransitionTaskStatus(from, target), true, `${from} -> ${target}`);
    assert.equal(assertTaskStatusTransition(from, target), target);
  }
}
assert.equal(canTransitionTaskStatus('completed', 'running'), false);
assert.equal(canTransitionTaskStatus('failed', 'planning'), false);
assert.equal(canTransitionTaskStatus('validation_failed', 'running'), true);
assert.equal(canTransitionTaskStatus('validation_failed', 'validating'), true);
assert.equal(canTransitionTaskStatus('cancelled', 'validating'), false);
assert.throws(() => assertTaskStatusTransition('completed', 'running'), error => error?.code === 'INVALID_TASK_STATE');

assert.equal(normalizeHistoricalTaskStatus('working'), 'running');
assert.equal(normalizeHistoricalTaskStatus('waiting'), 'planning');
assert.equal(normalizeHistoricalTaskStatus('awaiting_approval'), 'waiting_for_approval');
assert.equal(normalizeHistoricalTaskStatus('attention', { failures: 1 }), 'failed');
assert.equal(normalizeHistoricalTaskStatus('attention', { completionKnown: true, failures: 1 }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('inactive', { endedAt: Date.now() }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('inactive', { failures: 1, errorSummary: 'failed' }), 'failed');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: true }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: true, failures: 1 }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('completed_with_warnings', { completionKnown: true, failures: 1 }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('unknown-terminal', { endedAt: Date.now() }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('unknown-active', {}), 'planning');

console.log('Canonical task-state vocabulary, transitions, terminal protection, and historical normalization passed.');
