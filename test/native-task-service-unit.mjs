import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MAX_RESULT_BYTES,
  NativeTaskRequestError,
  NativeTaskStoreError,
  TASK_TRANSITIONS,
  acknowledgeNativeTaskCancellation,
  assertTaskTransition,
  cancelNativeTask,
  completeNativeTask,
  createNativeTask,
  failNativeTask,
  getNativeTask,
  getNativeTaskRecord,
  nativeTaskSignal,
  normalizePrincipalKey,
  principalFingerprint,
  pruneNativeTasks,
  requestNativeTaskInput,
  updateNativeTask,
  updateNativeTaskInputs
} from '../src/mcp/nativeTaskService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-task-service-'));
const config = { stateDir: root };
const serviceUrl = new URL('../src/mcp/nativeTaskService.js', import.meta.url);
const owner = {
  issuer: 'https://issuer.example',
  clientId: 'client-a',
  subject: 'subject-a',
  tenant: 'tenant-a',
  authorizationPolicy: { role: 'developer' },
  scopes: ['offline_access', 'mcp']
};
const sameOwner = {
  scopes: ['mcp', 'offline_access'],
  authorizationPolicy: { role: 'developer' },
  tenant: 'tenant-a',
  subject: 'subject-a',
  clientId: 'client-a',
  issuer: 'https://issuer.example'
};
const otherOwner = { ...owner, subject: 'subject-b' };

function activeTask(name, options = {}) {
  const controller = options.controller || new AbortController();
  return createNativeTask(config, {
    principal: options.principal ?? owner,
    method: 'tools/call',
    name,
    logicalTaskId: options.logicalTaskId || '',
    executor: { controller, ...(options.resume ? { resume: options.resume } : {}) },
    ...options.taskOptions
  });
}

function assertUnavailable(operation) {
  assert.throws(operation, error => error?.code === 'NATIVE_TASK_UNAVAILABLE');
}

function assertRequestError(operation, reason) {
  assert.throws(operation, error => error instanceof NativeTaskRequestError && (!reason || error.reason === reason));
}

function runInputWorker(taskId, key) {
  const source = `
    import { retryNativeTaskOperation, updateNativeTaskInputs } from ${JSON.stringify(serviceUrl.href)};
    const [root, taskId, key] = process.argv.slice(1);
    await retryNativeTaskOperation(() => updateNativeTaskInputs({ stateDir: root }, taskId, { [key]: { value: key } }, { principal: 'client-a' }));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, root, taskId, key], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Input worker ${key} failed with code ${code}: ${stderr}`));
    });
  });
}

try {
  assert.equal(normalizePrincipalKey('client-a'), 'client-a', 'string principal fingerprints remain restart-compatible');
  assert.equal(normalizePrincipalKey(owner), normalizePrincipalKey(sameOwner));
  assert.equal(principalFingerprint(owner), principalFingerprint(sameOwner));
  assert.notEqual(principalFingerprint(owner), principalFingerprint(otherOwner));

  const legalTransitions = {
    working: ['working', 'input_required', 'completed', 'failed', 'cancelled'],
    input_required: ['input_required', 'working', 'completed', 'failed', 'cancelled'],
    completed: ['completed'],
    failed: ['failed'],
    cancelled: ['cancelled']
  };
  assert.deepEqual(
    Object.fromEntries(Object.entries(TASK_TRANSITIONS).map(([status, next]) => [status, [...next]])),
    legalTransitions
  );
  for (const [from, destinations] of Object.entries(legalTransitions)) {
    for (const to of destinations) assert.equal(assertTaskTransition(from, to), to);
  }
  for (const [from, to] of [
    ['completed', 'working'], ['completed', 'failed'], ['completed', 'cancelled'],
    ['failed', 'working'], ['failed', 'completed'], ['failed', 'cancelled'],
    ['cancelled', 'working'], ['cancelled', 'completed'], ['cancelled', 'failed']
  ]) {
    assertRequestError(() => assertTaskTransition(from, to), 'invalid_transition');
  }

  const owned = activeTask('ownership-test', { logicalTaskId: 'logical-a' });
  assert.match(owned.taskId, /^task_[A-Za-z0-9_-]{32,160}$/);

  const contentionLock = path.join(root, 'native-tasks', `${owned.taskId}.lock`);
  fs.writeFileSync(contentionLock, 'other-runtime\n', 'utf8');
  const contentionStartedAt = Date.now();
  assert.throws(
    () => getNativeTask(config, owned.taskId, { principal: owner }),
    error => error instanceof NativeTaskStoreError && error.reason === 'lock_busy',
    'fresh native-task lock contention must fail fast rather than block the MCP event loop'
  );
  assert.ok(Date.now() - contentionStartedAt < 1000, 'native-task lock contention must return in under one second');
  fs.rmSync(contentionLock, { force: true });
  assert.equal(getNativeTask(config, owned.taskId, { principal: sameOwner }).status, 'working');
  assertUnavailable(() => getNativeTask(config, owned.taskId, { principal: otherOwner }));
  assertUnavailable(() => updateNativeTask(config, owned.taskId, { statusMessage: 'cross-principal update' }, { principal: otherOwner }));
  assertUnavailable(() => getNativeTask(config, 'task_invalid', { principal: owner }));

  const completed = completeNativeTask(config, owned.taskId, {
    ok: true,
    nested: { b: 2, a: 1 },
    token: 'must-not-persist'
  }, { principal: sameOwner });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result, {
    ok: true,
    nested: { b: 2, a: 1 },
    token: '[redacted]'
  });
  const repeatedCompletion = completeNativeTask(config, owned.taskId, {
    token: 'different-secret-redacts-to-same-value',
    nested: { a: 1, b: 2 },
    ok: true
  }, { principal: owner });
  assert.deepEqual(repeatedCompletion, completed, 'an exact normalized completion repeat is idempotent');
  assertRequestError(
    () => completeNativeTask(config, owned.taskId, { ok: false }, { principal: owner }),
    'terminal_conflict'
  );
  assertRequestError(() => failNativeTask(config, owned.taskId, 'late failure', { principal: owner }), 'terminal_conflict');
  assertRequestError(() => cancelNativeTask(config, owned.taskId, { principal: owner }), 'terminal_conflict');

  const failedTask = activeTask('failure-idempotency-test');
  const failure = {
    code: -32000,
    message: 'Failure token=secret-value at C:\\Users\\Kyne\\private.txt',
    data: { authorization: 'Bearer abc', nested: { password: 'secret', safe: true } }
  };
  const failed = failNativeTask(config, failedTask.taskId, failure, { principal: owner });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.data.authorization, '[redacted]');
  assert.equal(failed.error.data.nested.password, '[redacted]');
  assert.equal(failed.error.data.nested.safe, true);
  assert.doesNotMatch(failed.error.message, /secret-value|Users\\Kyne|private\.txt/);
  assert.deepEqual(failNativeTask(config, failedTask.taskId, failure, { principal: owner }), failed);
  assertRequestError(
    () => failNativeTask(config, failedTask.taskId, { ...failure, code: -32001 }, { principal: owner }),
    'terminal_conflict'
  );

  const genericErrorTask = activeTask('generic-error-redaction-test');
  const genericFailed = failNativeTask(
    config,
    genericErrorTask.taskId,
    new Error('password=top-secret\nstack C:\\Users\\Kyne\\source.js'),
    { principal: owner }
  );
  assert.equal(genericFailed.error.message, 'Task execution failed.');

  let resumeCount = 0;
  let receivedResponses = null;
  const inputTask = activeTask('input-schema-test', {
    resume(responses) {
      resumeCount += 1;
      receivedResponses = responses;
    }
  });
  const waiting = requestNativeTaskInput(config, inputTask.taskId, {
    approval: {
      mode: 'elicitation',
      message: 'Approve?',
      responseSchema: {
        type: 'object',
        required: ['approved'],
        additionalProperties: false,
        properties: { approved: { type: 'boolean' } }
      }
    },
    credentials: {
      mode: 'elicitation',
      responseSchema: {
        type: 'object',
        required: ['token'],
        additionalProperties: false,
        properties: { token: { type: 'string', minLength: 3 } }
      }
    }
  }, { principal: owner });
  assert.equal(waiting.status, 'input_required');
  assert.deepEqual(Object.keys(waiting.inputRequests).sort(), ['approval', 'credentials']);

  assertRequestError(
    () => updateNativeTaskInputs(config, inputTask.taskId, { approval: { approved: 'yes' } }, { principal: owner })
  );
  assert.deepEqual(getNativeTaskRecord(config, inputTask.taskId, { principal: owner }).satisfiedInputKeys, []);
  assertUnavailable(() => updateNativeTaskInputs(
    config,
    inputTask.taskId,
    { approval: { approved: true } },
    { principal: otherOwner }
  ));

  const partial = updateNativeTaskInputs(
    config,
    inputTask.taskId,
    { approval: { approved: true }, unknown: { ignored: true } },
    { principal: owner }
  );
  assert.equal(partial.status, 'input_required');
  assert.deepEqual(Object.keys(partial.inputRequests), ['credentials']);
  let inputRecord = getNativeTaskRecord(config, inputTask.taskId, { principal: owner });
  assert.equal(inputRecord.inputUpdateSequence, 1);
  assert.deepEqual(inputRecord.inputUpdates[0].acceptedKeys, ['approval']);
  const replayed = updateNativeTaskInputs(
    config,
    inputTask.taskId,
    { approval: { approved: false }, unknown: { ignored: true } },
    { principal: owner }
  );
  assert.equal(replayed.status, 'input_required');
  assert.equal(getNativeTaskRecord(config, inputTask.taskId, { principal: owner }).inputUpdateSequence, 1);

  const resumed = updateNativeTaskInputs(
    config,
    inputTask.taskId,
    { credentials: { token: 'raw-client-secret' } },
    { principal: owner }
  );
  assert.equal(resumed.status, 'working');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1);
  assert.deepEqual(receivedResponses, {
    approval: { approved: true },
    credentials: { token: 'raw-client-secret' }
  });
  inputRecord = getNativeTaskRecord(config, inputTask.taskId, { principal: owner });
  assert.equal(inputRecord.inputResponses.credentials.token, '[redacted]');
  assert.equal(inputRecord.inputUpdateSequence, 2);
  assert.deepEqual(inputRecord.inputUpdates.map(item => item.sequence), [1, 2]);
  completeNativeTask(config, inputTask.taskId, { ok: true }, { principal: owner });
  assertRequestError(
    () => updateNativeTaskInputs(config, inputTask.taskId, { credentials: { token: 'late' } }, { principal: owner }),
    'terminal_conflict'
  );

  const rejectedResume = activeTask('input-resume-failure-test', {
    resume: async () => {
      throw new Error('resume handler failed with token=private-value');
    }
  });
  requestNativeTaskInput(config, rejectedResume.taskId, {
    approval: {
      responseSchema: {
        type: 'object',
        required: ['approved'],
        additionalProperties: false,
        properties: { approved: { type: 'boolean' } }
      }
    }
  }, { principal: owner });
  updateNativeTaskInputs(
    config,
    rejectedResume.taskId,
    { approval: { approved: true } },
    { principal: owner }
  );
  await new Promise(resolve => setImmediate(resolve));
  const rejectedResumeState = getNativeTask(config, rejectedResume.taskId, { principal: owner });
  assert.equal(rejectedResumeState.status, 'failed');
  assert.equal(rejectedResumeState.statusMessage, 'Task failed while resuming after client input.');
  assert.equal(rejectedResumeState.error.message, 'Task execution failed.');

  const cancelController = new AbortController();
  const cancellable = activeTask('cancellation-ack-test', { controller: cancelController });
  assert.equal(nativeTaskSignal(cancellable.taskId)?.aborted, false);
  const cancellationRequested = cancelNativeTask(config, cancellable.taskId, { principal: owner });
  assert.equal(cancellationRequested.status, 'working');
  assert.equal(cancelController.signal.aborted, true);
  let cancellationRecord = getNativeTaskRecord(config, cancellable.taskId, { principal: owner });
  assert.equal(cancellationRecord.cancelRequested, true);
  assert.ok(cancellationRecord.cancellationRequestedAt);
  assert.equal(cancellationRecord.cancellationAcknowledgedAt, null);
  assert.equal(cancelNativeTask(config, cancellable.taskId, { principal: owner }).status, 'working');
  const cancelled = acknowledgeNativeTaskCancellation(config, cancellable.taskId, { principal: owner });
  assert.equal(cancelled.status, 'cancelled');
  cancellationRecord = getNativeTaskRecord(config, cancellable.taskId, { principal: owner });
  assert.ok(cancellationRecord.cancellationAcknowledgedAt);
  assert.equal(acknowledgeNativeTaskCancellation(config, cancellable.taskId, { principal: owner }).status, 'cancelled');
  assert.equal(cancelNativeTask(config, cancellable.taskId, { principal: owner }).status, 'cancelled');

  const noExecutorCancellation = createNativeTask(config, {
    principal: owner,
    method: 'tools/call',
    name: 'immediate-domain-cancellation',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  assert.equal(cancelNativeTask(config, noExecutorCancellation.taskId, { principal: owner }).status, 'cancelled');

  const completionRaceController = new AbortController();
  const completionRace = activeTask('completion-cancellation-race', { controller: completionRaceController });
  assert.equal(cancelNativeTask(config, completionRace.taskId, { principal: owner }).status, 'working');
  const completionWon = completeNativeTask(config, completionRace.taskId, { winner: 'completion' }, { principal: owner });
  assert.equal(completionWon.status, 'completed');
  assert.equal(acknowledgeNativeTaskCancellation(config, completionRace.taskId, { principal: owner }).status, 'completed');

  const failureRaceController = new AbortController();
  const failureRace = activeTask('failure-cancellation-race', { controller: failureRaceController });
  assert.equal(cancelNativeTask(config, failureRace.taskId, { principal: owner }).status, 'working');
  const failureWon = failNativeTask(config, failureRace.taskId, 'operation failed after cancellation request', { principal: owner });
  assert.equal(failureWon.status, 'failed');
  assert.equal(acknowledgeNativeTaskCancellation(config, failureRace.taskId, { principal: owner }).status, 'failed');

  const interrupted = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'interrupted-test',
    restartPolicy: 'non_resumable'
  });
  const interruptedState = getNativeTask(config, interrupted.taskId, { principal: 'client-a' });
  assert.equal(interruptedState.status, 'failed');
  assert.equal(interruptedState.error.data.retryable, true);
  assert.equal(interruptedState.error.data.reason, 'executor_interrupted');

  const reconcilable = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'deadline-test',
    restartPolicy: 'restart_reconcilable',
    now: 1_000,
    recovery: {
      mode: 'deadline',
      completeAtMs: 2_000,
      statusMessage: 'Deadline completed.',
      result: { ok: true, source: 'durable-deadline', token: 'recovery-secret' }
    }
  });
  assert.equal(getNativeTask(config, reconcilable.taskId, { principal: 'client-a', now: 1_500 }).status, 'working');
  const reconciled = getNativeTask(config, reconcilable.taskId, { principal: 'client-a', now: 2_000 });
  assert.equal(reconciled.status, 'completed');
  assert.deepEqual(reconciled.result, { ok: true, source: 'durable-deadline', token: '[redacted]' });
  assert.deepEqual(
    getNativeTask(config, reconcilable.taskId, { principal: 'client-a', now: 2_500 }).result,
    reconciled.result,
    'final result remains durable and deterministic after reconciliation'
  );

  const oversized = activeTask('oversized-result-test', { principal: 'client-a' });
  const oversizedState = completeNativeTask(
    config,
    oversized.taskId,
    { payload: 'x'.repeat(MAX_RESULT_BYTES + 1) },
    { principal: 'client-a' }
  );
  assert.equal(oversizedState.status, 'failed');
  assert.equal(oversizedState.error.data.reason, 'result_too_large');
  const oversizedFile = path.join(root, 'native-tasks', `${oversized.taskId}.json`);
  assert.ok(fs.statSync(oversizedFile).size < 100_000, 'oversized results must not become oversized task records');

  const expiring = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'expiry-test',
    ttlMs: 100,
    now: 10_000,
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: 50_000, result: { ok: true } }
  });
  assertUnavailable(() => getNativeTask(config, expiring.taskId, { principal: 'client-a', now: 10_100 }));

  const concurrent = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'concurrent-input-update-test',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  requestNativeTaskInput(config, concurrent.taskId, {
    alpha: {
      responseSchema: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: { value: { const: 'alpha' } }
      }
    },
    beta: {
      responseSchema: {
        type: 'object',
        required: ['value'],
        additionalProperties: false,
        properties: { value: { const: 'beta' } }
      }
    }
  }, { principal: 'client-a' });
  await Promise.all([
    runInputWorker(concurrent.taskId, 'alpha'),
    runInputWorker(concurrent.taskId, 'beta')
  ]);
  const concurrentRecord = getNativeTaskRecord(config, concurrent.taskId, { principal: 'client-a' });
  assert.equal(concurrentRecord.status, 'working');
  assert.deepEqual(Object.keys(concurrentRecord.inputResponses).sort(), ['alpha', 'beta']);
  assert.equal(concurrentRecord.inputUpdateSequence, 2);
  assert.equal(concurrentRecord.inputUpdates.length, 2);

  const atomic = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'atomic-write-interruption-test',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  const atomicFile = path.join(root, 'native-tasks', `${atomic.taskId}.json`);
  const staleTemporary = `${atomicFile}.999999.interrupted.tmp`;
  fs.writeFileSync(staleTemporary, '{partial', 'utf8');
  fs.utimesSync(staleTemporary, new Date(0), new Date(0));
  assert.equal(getNativeTask(config, atomic.taskId, { principal: 'client-a' }).status, 'working');
  const artifactPrune = pruneNativeTasks(config);
  assert.ok(artifactPrune.artifactsRemoved >= 1);
  assert.equal(fs.existsSync(staleTemporary), false);
  assert.equal(fs.existsSync(atomicFile), true, 'a partial temporary write must not replace the durable record');

  const pruneTarget = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'prune-test',
    ttlMs: 100,
    now: 20_000,
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: 50_000, result: { ok: true } }
  });
  const pruned = pruneNativeTasks(config, { now: 20_100 });
  assert.ok(pruned.removed >= 1);
  assertUnavailable(() => getNativeTask(config, pruneTarget.taskId, { principal: 'client-a', now: 20_100 }));

  const corrupt = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'corrupt-record-test',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  const corruptFile = path.join(root, 'native-tasks', `${corrupt.taskId}.json`);
  fs.writeFileSync(corruptFile, '{corrupt', 'utf8');
  assert.throws(
    () => getNativeTask(config, corrupt.taskId, { principal: 'client-a' }),
    error => error instanceof NativeTaskStoreError
      && error.reason === 'record_corrupt'
      && error.retryable === false
      && !error.message.includes(root)
  );
  assert.equal(fs.existsSync(corruptFile), false, 'a corrupt record must leave the active task directory');
  const quarantineDir = path.join(root, 'native-tasks-quarantine');
  assert.ok(fs.readdirSync(quarantineDir).some(name => name.startsWith(`${corrupt.taskId}.`)));

  const pruneCorrupt = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'prune-corrupt-record-test',
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: Date.now() + 60_000, result: { ok: true } }
  });
  fs.writeFileSync(path.join(root, 'native-tasks', `${pruneCorrupt.taskId}.json`), '{}', 'utf8');
  const corruptionPrune = pruneNativeTasks(config);
  assert.equal(corruptionPrune.quarantined, 1);

  const blockedState = path.join(root, 'blocked-state');
  fs.writeFileSync(blockedState, 'not a directory', 'utf8');
  assert.throws(
    () => createNativeTask({ stateDir: blockedState }, { principal: 'client-a' }),
    error => error instanceof NativeTaskStoreError
      && error.reason === 'write_failed'
      && error.retryable === true
      && error.message === 'Native task storage is unavailable.'
      && !error.message.includes(root)
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Native task lifecycle, persistence, cancellation, authorization, input safety, and result safety tests passed.');
