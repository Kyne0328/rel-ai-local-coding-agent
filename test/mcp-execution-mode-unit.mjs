import assert from 'node:assert/strict';
import {
  MissingRequiredClientCapabilityError,
  ProtocolErrorCode
} from '@modelcontextprotocol/server';

import {
  INVALID_TASKS_CAPABILITY_CODE,
  MISSING_TASKS_CAPABILITY_CODE,
  TASK_EXECUTION_MODE,
  TASKS_EXTENSION_ID,
  clientSupportsNativeTasks,
  createMissingTasksCapabilityError,
  negotiateTasksCapability
} from '../src/mcp/protocol.js';
import {
  BOUNDED_SYNCHRONOUS_CLEANUP,
  DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS,
  EXECUTION_ABORTED_CODE,
  SYNCHRONOUS_EXECUTION_LIMIT_CODE,
  TASK_ELIGIBILITY,
  UNSUPPORTED_EXECUTION_MODE,
  assessSynchronousExecution,
  selectExecutionMode
} from '../src/mcp/executionMode.js';

const tasksCapability = { extensions: { [TASKS_EXTENSION_ID]: {} } };

assert.equal(MISSING_TASKS_CAPABILITY_CODE, ProtocolErrorCode.MissingRequiredClientCapability);
assert.equal(MISSING_TASKS_CAPABILITY_CODE, -32021);
const missingCapabilityError = createMissingTasksCapabilityError();
assert.ok(missingCapabilityError instanceof MissingRequiredClientCapabilityError);
assert.equal(missingCapabilityError.code, -32021);
assert.deepEqual(missingCapabilityError.data, {
  requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } }
});

assert.deepEqual(negotiateTasksCapability(tasksCapability), {
  mode: TASK_EXECUTION_MODE.NATIVE_TASKS,
  supported: true,
  valid: true,
  reason: 'capability_present'
});
assert.equal(clientSupportsNativeTasks(tasksCapability), true);
assert.deepEqual(negotiateTasksCapability({}), {
  mode: TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS,
  supported: false,
  valid: true,
  reason: 'capability_absent'
});
assert.deepEqual(negotiateTasksCapability([]), {
  mode: TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS,
  supported: false,
  valid: false,
  reason: 'malformed_capabilities'
});
assert.equal(negotiateTasksCapability({ extensions: [] }).valid, false);
assert.equal(negotiateTasksCapability({ extensions: { [TASKS_EXTENSION_ID]: true } }).valid, false);

const heuristicOnly = negotiateTasksCapability({
  clientName: 'ChatGPT',
  transport: 'http',
  protocolVersion: '2026-07-28'
});
assert.equal(heuristicOnly.mode, TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS);
assert.equal(heuristicOnly.supported, false);

const native = selectExecutionMode({
  clientCapabilities: tasksCapability,
  taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
  canCompleteSynchronously: false
});
assert.equal(native.ok, true);
assert.equal(native.mode, TASK_EXECUTION_MODE.NATIVE_TASKS);

const fast = selectExecutionMode({
  clientCapabilities: tasksCapability,
  taskEligibility: TASK_ELIGIBILITY.FAST,
  canCompleteSynchronously: true,
  estimatedDurationMs: 25,
  estimatedOutputBytes: 128
});
assert.equal(fast.ok, true);
assert.equal(fast.mode, TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS);
assert.deepEqual(fast.cleanup, BOUNDED_SYNCHRONOUS_CLEANUP);

const immediate = selectExecutionMode({
  clientCapabilities: tasksCapability,
  taskEligibility: TASK_ELIGIBILITY.IMMEDIATE,
  canCompleteSynchronously: true
});
assert.equal(immediate.mode, TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS);

const supportedButSafe = selectExecutionMode({
  clientCapabilities: tasksCapability,
  taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
  canCompleteSynchronously: true
});
assert.equal(supportedButSafe.mode, TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS);

const unsupportedButSafe = selectExecutionMode({
  clientCapabilities: {},
  taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
  canCompleteSynchronously: true,
  estimatedDurationMs: DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS.maxDurationMs,
  estimatedOutputBytes: DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS.maxCapturedOutputBytes
});
assert.equal(unsupportedButSafe.ok, true);
assert.equal(unsupportedButSafe.mode, TASK_EXECUTION_MODE.BOUNDED_SYNCHRONOUS);

const malformedButOtherwiseSafe = selectExecutionMode({
  clientCapabilities: { extensions: [] },
  taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
  canCompleteSynchronously: true,
  estimatedDurationMs: 1,
  estimatedOutputBytes: 1
});
assert.equal(malformedButOtherwiseSafe.ok, false);
assert.equal(malformedButOtherwiseSafe.mode, UNSUPPORTED_EXECUTION_MODE);
assert.equal(malformedButOtherwiseSafe.error.code, INVALID_TASKS_CAPABILITY_CODE);
assert.equal(malformedButOtherwiseSafe.error.reason, 'invalid_client_capabilities');
assert.equal(malformedButOtherwiseSafe.error.data.capabilityReason, 'malformed_extensions');

const tasksRequired = selectExecutionMode({
  clientCapabilities: {},
  taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
  canCompleteSynchronously: false
});
assert.equal(tasksRequired.ok, false);
assert.equal(tasksRequired.mode, UNSUPPORTED_EXECUTION_MODE);
assert.equal(tasksRequired.error.code, MISSING_TASKS_CAPABILITY_CODE);
assert.equal(tasksRequired.error.reason, 'native_tasks_required');

const overLimit = selectExecutionMode({
  clientCapabilities: {},
  taskEligibility: TASK_ELIGIBILITY.INELIGIBLE,
  canCompleteSynchronously: true,
  estimatedDurationMs: DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS.maxDurationMs + 1,
  estimatedOutputBytes: DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS.maxCapturedOutputBytes + 1
});
assert.equal(overLimit.ok, false);
assert.equal(overLimit.mode, UNSUPPORTED_EXECUTION_MODE);
assert.equal(overLimit.error.code, SYNCHRONOUS_EXECUTION_LIMIT_CODE);
assert.deepEqual(overLimit.synchronous.violations, [
  'maximum_duration_exceeded',
  'maximum_captured_output_exceeded'
]);
assert.deepEqual(overLimit.error.data.cleanup, BOUNDED_SYNCHRONOUS_CLEANUP);

assert.deepEqual(assessSynchronousExecution({
  canCompleteSynchronously: false,
  bounds: DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS
}).violations, ['operation_not_synchronously_safe']);

const alreadyAborted = new AbortController();
alreadyAborted.abort('request closed');
const aborted = selectExecutionMode({
  clientCapabilities: tasksCapability,
  taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
  canCompleteSynchronously: false,
  abortSignals: [alreadyAborted.signal]
});
assert.equal(aborted.ok, false);
assert.equal(aborted.error.code, EXECUTION_ABORTED_CODE);
assert.equal(aborted.error.reason, 'execution_aborted');

const requestController = new AbortController();
const connectionController = new AbortController();
const cancellable = selectExecutionMode({
  clientCapabilities: {},
  taskEligibility: TASK_ELIGIBILITY.FAST,
  canCompleteSynchronously: true,
  abortSignals: [requestController.signal, connectionController.signal]
});
assert.equal(cancellable.signal.aborted, false);
connectionController.abort('connection closed');
assert.equal(cancellable.signal.aborted, true);
assert.equal(BOUNDED_SYNCHRONOUS_CLEANUP.terminateSubprocessTree, true);
assert.equal(BOUNDED_SYNCHRONOUS_CLEANUP.awaitSubprocessExit, true);

assert.throws(
  () => selectExecutionMode({ taskEligibility: 'client_name_based', canCompleteSynchronously: true }),
  /taskEligibility must be one of/
);
assert.throws(
  () => selectExecutionMode({
    taskEligibility: TASK_ELIGIBILITY.FAST,
    canCompleteSynchronously: true,
    synchronousBounds: { maxDurationMs: 0, maxCapturedOutputBytes: 1 }
  }),
  /maxDurationMs must be a positive finite number/
);

console.log('Canonical MCP Tasks capability negotiation and execution-mode policy passed.');
