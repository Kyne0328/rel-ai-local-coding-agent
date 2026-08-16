import { combineAbortSignals } from '../abortSignals.js';
import {
  TASK_EXECUTION_MODE,
  createInvalidTasksCapabilityError,
  createMissingTasksCapabilityError,
  negotiateTasksCapability
} from './protocol.js';

const TASK_ELIGIBILITY = Object.freeze({
  ELIGIBLE: 'eligible',
  FAST: 'ineligible_fast',
  IMMEDIATE: 'ineligible_immediate',
  INELIGIBLE: 'ineligible'
});
const TASK_ELIGIBILITY_VALUES = new Set(Object.values(TASK_ELIGIBILITY));
const DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS = Object.freeze({
  // Bound only how long an HTTP/stdio response stays synchronously occupied.
  // Tool-specific output limits belong to the tool that produces the output.
  maxDurationMs: 30_000
});
const BOUNDED_SYNCHRONOUS_CLEANUP = Object.freeze({
  abortOnRequestClose: true,
  abortOnConnectionClose: true,
  terminateSubprocessTree: true,
  awaitSubprocessExit: true
});
const SYNCHRONOUS_EXECUTION_LIMIT_CODE = -32024;
const EXECUTION_ABORTED_CODE = -32800;
const UNSUPPORTED_EXECUTION_MODE = 'unsupported';

function selectExecutionMode(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Execution selection options must be an object.');
  }
  const capability = negotiateTasksCapability(options.clientCapabilities);
  const taskEligibility = normalizeTaskEligibility(options.taskEligibility);
  const bounds = normalizeSynchronousExecutionBounds(options.synchronousBounds);
  const abortSignals = normalizeAbortSignals(options.abortSignals);
  const signal = combineAbortSignals(abortSignals);
  const synchronous = assessSynchronousExecution({
    canCompleteSynchronously: options.canCompleteSynchronously,
    estimatedDurationMs: options.estimatedDurationMs,
    bounds
  });
  const contract = { capability, taskEligibility, bounds, signal, synchronous };

  if (!capability.valid) {
    return unsupportedSelection(contract, createInvalidTasksCapabilityError(capability));
  }
  if (signal?.aborted) {
    return unsupportedSelection(contract, executionPolicyError(
      EXECUTION_ABORTED_CODE,
      'execution_aborted',
      'Execution was cancelled before it started.',
      { reason: 'execution_aborted' }
    ));
  }
  if (synchronous.safe) {
    return {
      ok: true,
      mode: TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS,
      ...contract,
      cleanup: BOUNDED_SYNCHRONOUS_CLEANUP
    };
  }
  if (taskEligibility === TASK_ELIGIBILITY.ELIGIBLE && capability.supported) {
    return { ok: true, mode: TASK_EXECUTION_MODE.NATIVE_TASKS, ...contract };
  }
  if (taskEligibility === TASK_ELIGIBILITY.ELIGIBLE) {
    const error = createMissingTasksCapabilityError();
    error.reason = 'native_tasks_required';
    error.retryable = false;
    return unsupportedSelection(contract, error);
  }
  return unsupportedSelection(contract, executionPolicyError(
    SYNCHRONOUS_EXECUTION_LIMIT_CODE,
    'synchronous_execution_limit',
    'Operation cannot complete within the bounded synchronous execution policy.',
    {
      reason: 'synchronous_execution_limit',
      limits: bounds,
      violations: synchronous.violations,
      cleanup: BOUNDED_SYNCHRONOUS_CLEANUP
    }
  ));
}

function assessSynchronousExecution({
  canCompleteSynchronously,
  estimatedDurationMs,
  bounds = DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS
} = {}) {
  const normalizedBounds = normalizeSynchronousExecutionBounds(bounds);
  const durationMs = optionalNonNegativeNumber(estimatedDurationMs, 'estimatedDurationMs');
  const violations = [];
  if (canCompleteSynchronously !== true) violations.push('operation_not_synchronously_safe');
  if (durationMs !== undefined && durationMs > normalizedBounds.maxDurationMs) {
    violations.push('maximum_duration_exceeded');
  }
  return Object.freeze({
    safe: violations.length === 0,
    estimatedDurationMs: durationMs,
    violations: Object.freeze(violations)
  });
}

function normalizeSynchronousExecutionBounds(value = DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('synchronousBounds must be an object.');
  }
  return Object.freeze({
    maxDurationMs: positiveFiniteNumber(value.maxDurationMs, 'maxDurationMs')
  });
}

function normalizeTaskEligibility(value = TASK_ELIGIBILITY.INELIGIBLE) {
  if (!TASK_ELIGIBILITY_VALUES.has(value)) {
    throw new TypeError(`taskEligibility must be one of: ${[...TASK_ELIGIBILITY_VALUES].join(', ')}.`);
  }
  return value;
}

function normalizeAbortSignals(value = []) {
  const signals = Array.isArray(value) ? value : [value];
  for (const signal of signals) {
    if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
      throw new TypeError('abortSignals must contain AbortSignal-compatible values.');
    }
  }
  return signals;
}

function positiveFiniteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${name} must be a positive finite number.`);
  return number;
}

function optionalNonNegativeNumber(value, name) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${name} must be a non-negative finite number.`);
  return number;
}

function executionPolicyError(code, reason, message, data) {
  const error = new Error(message);
  error.code = code;
  error.reason = reason;
  error.data = data;
  error.retryable = false;
  return error;
}

function unsupportedSelection(contract, error) {
  return { ok: false, mode: UNSUPPORTED_EXECUTION_MODE, ...contract, error };
}

export {
  BOUNDED_SYNCHRONOUS_CLEANUP,
  DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS,
  EXECUTION_ABORTED_CODE,
  SYNCHRONOUS_EXECUTION_LIMIT_CODE,
  TASK_ELIGIBILITY,
  UNSUPPORTED_EXECUTION_MODE,
  assessSynchronousExecution,

  selectExecutionMode
};
