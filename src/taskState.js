'use strict';

const CANONICAL_TASK_STATUSES = Object.freeze([
  'queued',
  'planning',
  'running',
  'waiting_for_approval',
  'blocked',
  'validating',
  'validation_failed',
  'completed',
  'failed',
  'cancelled'
]);

const CANONICAL_TASK_STATUS_SET = new Set(CANONICAL_TASK_STATUSES);
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const TASK_TRANSITIONS = Object.freeze({
  queued: Object.freeze(['planning', 'running', 'cancelled']),
  planning: Object.freeze(['running', 'waiting_for_approval', 'blocked', 'validating', 'validation_failed', 'completed', 'failed', 'cancelled']),
  running: Object.freeze(['planning', 'waiting_for_approval', 'blocked', 'validating', 'validation_failed', 'completed', 'failed', 'cancelled']),
  waiting_for_approval: Object.freeze(['running', 'blocked', 'failed', 'cancelled']),
  blocked: Object.freeze(['running', 'waiting_for_approval', 'validating', 'validation_failed', 'failed', 'cancelled']),
  validating: Object.freeze(['running', 'validation_failed', 'completed', 'failed', 'cancelled']),
  validation_failed: Object.freeze(['planning', 'running', 'blocked', 'validating', 'completed', 'failed', 'cancelled']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([])
});

function isCanonicalTaskStatus(value) {
  return CANONICAL_TASK_STATUS_SET.has(String(value || ''));
}

function isTerminalTaskStatus(value) {
  return TERMINAL_TASK_STATUSES.has(String(value || ''));
}

function normalizeHistoricalTaskStatus(value, record = {}) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'completed_with_warnings') return 'completed';
  if (isCanonicalTaskStatus(status)) return status;
  if (status === 'working' || status === 'active') return 'running';
  if (status === 'waiting' || status === 'settling' || status === 'open') return 'planning';
  if (status === 'approval' || status === 'awaiting_approval') return 'waiting_for_approval';
  if (status === 'attention') return record.completionKnown === true ? 'completed' : 'failed';
  if (status === 'inactive' || status === 'expired') {
    if (record.completionKnown === true) return 'completed';
    if (hasFailureEvidence(record)) return 'failed';
    return 'cancelled';
  }
  if (record.completionKnown === true) return 'completed';
  if (hasFailureEvidence(record)) return 'failed';
  if (record.endedAt || record.completedAt) return 'cancelled';
  return 'planning';
}

function canTransitionTaskStatus(from, to) {
  const current = normalizeHistoricalTaskStatus(from);
  const next = normalizeHistoricalTaskStatus(to);
  if (current === next) return true;
  if (isTerminalTaskStatus(current)) return false;
  return TASK_TRANSITIONS[current]?.includes(next) === true;
}

function assertTaskStatusTransition(from, to) {
  const current = normalizeHistoricalTaskStatus(from);
  const next = normalizeHistoricalTaskStatus(to);
  if (!canTransitionTaskStatus(current, next)) {
    const error = new Error(`Invalid task status transition: ${current} -> ${next}`);
    error.code = 'INVALID_TASK_STATE';
    throw error;
  }
  return next;
}

function hasFailureEvidence(record = {}) {
  return Number(record.failures || record.failedToolCallCount || 0) > 0 ||
    Boolean(String(record.errorSummary || record.error || '').trim()) ||
    String(record.lastOutcome || '').toLowerCase() === 'failed' ||
    record.ok === false;
}

export { CANONICAL_TASK_STATUSES, TERMINAL_TASK_STATUSES, TASK_TRANSITIONS, assertTaskStatusTransition, canTransitionTaskStatus, isCanonicalTaskStatus, isTerminalTaskStatus, normalizeHistoricalTaskStatus };
