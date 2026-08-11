import assert from 'node:assert/strict';
const {
  CANONICAL_TASK_STATUSES,
  NATIVE_TASK_STATUSES,
  TASK_TRANSITIONS,
  assertTaskStatusTransition,
  canTransitionTaskStatus,
  internalStatusToDashboardStatus,
  isCanonicalTaskStatus,
  isNativeTaskStatus,
  isTerminalDashboardTaskStatus,
  isTerminalNativeTaskStatus,
  isTerminalTaskStatus,
  nativeStatusToInternalStatus,
  normalizeHistoricalTaskStatus,
  normalizeLiveTaskStatus
} = await import('../src/taskState.js');

assert.deepEqual(CANONICAL_TASK_STATUSES, [
  'queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating',
  'validation_failed', 'inactive', 'completed', 'failed', 'cancelled'
]);
for (const status of CANONICAL_TASK_STATUSES) assert.equal(isCanonicalTaskStatus(status), true, status);
assert.deepEqual(NATIVE_TASK_STATUSES, ['working', 'input_required', 'completed', 'failed', 'cancelled']);
for (const status of NATIVE_TASK_STATUSES) assert.equal(isNativeTaskStatus(status), true, status);
assert.equal(isNativeTaskStatus('running'), false, 'internal and native protocol status vocabularies remain distinct');
assert.equal(nativeStatusToInternalStatus('working'), 'running');
assert.equal(nativeStatusToInternalStatus('input_required'), 'blocked');
assert.equal(nativeStatusToInternalStatus('completed'), 'completed');
assert.equal(nativeStatusToInternalStatus('unknown'), '');
assert.equal(isTerminalNativeTaskStatus('completed'), true);
assert.equal(isTerminalNativeTaskStatus('working'), false);
assert.equal(isTerminalNativeTaskStatus('unknown'), false);
assert.equal(normalizeLiveTaskStatus('blocked', {}, { blockedMeansApproval: true }), 'waiting_for_approval');
assert.equal(normalizeLiveTaskStatus('blocked'), 'blocked');
assert.equal(normalizeLiveTaskStatus('working'), 'running');
assert.equal(internalStatusToDashboardStatus('completed_with_warnings'), 'completed');
assert.equal(internalStatusToDashboardStatus('inactive', { failures: 1 }), 'inactive');
assert.equal(isTerminalDashboardTaskStatus('expired'), false);
assert.equal(isTerminalDashboardTaskStatus('running'), false);
for (const status of ['completed', 'failed', 'cancelled']) assert.equal(isTerminalTaskStatus(status), true, status);
assert.equal(isCanonicalTaskStatus('completed_with_warnings'), false, 'legacy warning status is not canonical');
for (const status of ['queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating', 'validation_failed', 'inactive']) assert.equal(isTerminalTaskStatus(status), false, status);

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
assert.equal(normalizeHistoricalTaskStatus('inactive', { endedAt: Date.now() }), 'inactive');
assert.equal(normalizeHistoricalTaskStatus('inactive', { failures: 1, errorSummary: 'failed' }), 'inactive');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: true }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: true, failures: 1 }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('completed_with_warnings', { completionKnown: true, failures: 1 }), 'completed');
assert.equal(normalizeHistoricalTaskStatus('cancelled', { completionKnown: false, endReason: 'inactivity_window' }), 'inactive');
assert.equal(normalizeHistoricalTaskStatus('failed', { completionKnown: false, endReason: 'inactivity_window' }), 'inactive');
assert.equal(normalizeHistoricalTaskStatus('cancelled', { completionKnown: false, endReason: 'explicit_cancellation', cancellationInitiator: 'user' }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('inactive', { completionKnown: false, endReason: 'terminal_failure', terminal: true }), 'failed');
assert.equal(normalizeHistoricalTaskStatus('unknown-terminal', { endedAt: Date.now() }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('unknown-active', {}), 'planning');

console.log('Canonical task-state vocabulary, transitions, terminal protection, and historical normalization passed.');
