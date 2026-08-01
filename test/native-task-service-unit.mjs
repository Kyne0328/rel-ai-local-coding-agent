import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  NativeTaskStoreError,
  cancelNativeTask,
  completeNativeTask,
  createNativeTask,
  failNativeTask,
  getNativeTask,
  nativeTaskSignal,
  pruneNativeTasks,
  requestNativeTaskInput,
  updateNativeTaskInputs
} from '../src/mcp/nativeTaskService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-task-service-'));
const config = { stateDir: root };

try {
  const ownerController = new AbortController();
  const owned = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'unit-test',
    logicalTaskId: 'logical-a',
    executor: { controller: ownerController }
  });
  assert.match(owned.taskId, /^task_[A-Za-z0-9_-]{32,160}$/);
  assert.equal(getNativeTask(config, owned.taskId, { principal: 'client-a' }).status, 'working');
  assert.throws(
    () => getNativeTask(config, owned.taskId, { principal: 'client-b' }),
    /Invalid task ID or task is not available/
  );
  assert.throws(
    () => getNativeTask(config, 'task_invalid', { principal: 'client-a' }),
    /Invalid task ID or task is not available/
  );

  const completed = completeNativeTask(config, owned.taskId, { ok: true }, { principal: 'client-a' });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result, { ok: true });
  const immutable = cancelNativeTask(config, owned.taskId, { principal: 'client-a' });
  assert.equal(immutable.status, 'completed');
  assert.deepEqual(immutable.result, { ok: true });

  let resumeCount = 0;
  let receivedResponses = null;
  const inputTask = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'input-test',
    executor: {
      resume(responses) {
        resumeCount += 1;
        receivedResponses = responses;
      }
    }
  });
  const waiting = requestNativeTaskInput(config, inputTask.taskId, {
    approval: { mode: 'elicitation', message: 'Approve?' }
  }, { principal: 'client-a' });
  assert.equal(waiting.status, 'input_required');
  assert.deepEqual(Object.keys(waiting.inputRequests), ['approval']);

  updateNativeTaskInputs(config, inputTask.taskId, { unknown: { ignored: true } }, { principal: 'client-a' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 0);
  const resumed = updateNativeTaskInputs(config, inputTask.taskId, {
    approval: { approved: true }
  }, { principal: 'client-a' });
  assert.equal(resumed.status, 'working');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1);
  assert.deepEqual(receivedResponses, { approval: { approved: true } });
  updateNativeTaskInputs(config, inputTask.taskId, {
    approval: { approved: false }
  }, { principal: 'client-a' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCount, 1, 'replayed input must not resume work twice');

  const cancelController = new AbortController();
  const cancellable = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'cancel-test',
    executor: { controller: cancelController }
  });
  assert.equal(nativeTaskSignal(cancellable.taskId)?.aborted, false);
  const cancelled = cancelNativeTask(config, cancellable.taskId, { principal: 'client-a' });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelController.signal.aborted, true);
  assert.equal(cancelNativeTask(config, cancellable.taskId, { principal: 'client-a' }).status, 'cancelled');

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
      result: { ok: true, source: 'durable-deadline' }
    }
  });
  assert.equal(getNativeTask(config, reconcilable.taskId, { principal: 'client-a', now: 1_500 }).status, 'working');
  const reconciled = getNativeTask(config, reconcilable.taskId, { principal: 'client-a', now: 2_000 });
  assert.equal(reconciled.status, 'completed');
  assert.deepEqual(reconciled.result, { ok: true, source: 'durable-deadline' });

  const redactionController = new AbortController();
  const redacted = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'redaction-test',
    executor: { controller: redactionController }
  });
  failNativeTask(config, redacted.taskId, {
    code: -32603,
    message: 'Failure',
    data: { token: 'secret-token', nested: { password: 'secret-password', safe: true } }
  }, { principal: 'client-a' });
  const redactedState = getNativeTask(config, redacted.taskId, { principal: 'client-a' });
  assert.equal(redactedState.error.data.token, '[redacted]');
  assert.equal(redactedState.error.data.nested.password, '[redacted]');
  assert.equal(redactedState.error.data.nested.safe, true);

  const expiring = createNativeTask(config, {
    principal: 'client-a',
    method: 'tools/call',
    name: 'expiry-test',
    ttlMs: 100,
    now: 10_000,
    restartPolicy: 'restart_reconcilable',
    recovery: { mode: 'deadline', completeAtMs: 50_000, result: { ok: true } }
  });
  assert.throws(
    () => getNativeTask(config, expiring.taskId, { principal: 'client-a', now: 10_100 }),
    /Invalid task ID or task is not available/
  );

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
  assert.throws(
    () => getNativeTask(config, pruneTarget.taskId, { principal: 'client-a', now: 20_100 }),
    /Invalid task ID or task is not available/
  );

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

console.log('Canonical native task service state, ownership, input, restart, cancellation, redaction, and expiry tests passed.');
