import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  completeNativeToolTask,
  createNativeToolTask,
  failNativeToolTask,
  nativeToolTaskSignal
} from '../src/mcp/nativeToolTasks.js';
import {
  acknowledgeNativeTaskCancellation,
  cancelNativeTask,
  createNativeTask,
  getNativeTask,
  getNativeTaskRecord
} from '../src/mcp/nativeTaskService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-tool-task-parity-'));
const config = { stateDir: root };
try {
  const created = createNativeToolTask(config, {
    method: 'tools/call',
    name: 'relai_run_checks',
    workspace: 'repo',
    logicalTaskId: 'logical-a',
    principal: 'principal-a',
    message: 'Starting validation.'
  });
  assert.equal(created.status, 'working');
  assert.equal(nativeToolTaskSignal(created.taskId)?.aborted, false);

  const nativeCreated = getNativeTaskRecord(config, created.taskId, {
    principal: 'principal-a',
    logicalTaskId: 'logical-a'
  });
  assert.equal(nativeCreated.origin.method, 'tools/call');
  assert.equal(nativeCreated.origin.name, 'relai_run_checks');
  assert.equal(nativeCreated.origin.logicalTaskId, 'logical-a');
  assert.equal(nativeCreated.internal.workspace, 'repo');
  assert.equal(Object.hasOwn(nativeCreated.internal, 'compatibilityOperation'), false);
  assert.ok(fs.existsSync(path.join(root, 'native-tasks', `${created.taskId}.json`)));
  assert.equal(fs.existsSync(path.join(root, 'operation-tasks')), false);

  assert.throws(
    () => getNativeTaskRecord(config, created.taskId, { principal: 'principal-b' }),
    error => error?.code === 'NATIVE_TASK_UNAVAILABLE'
  );
  assert.throws(
    () => getNativeTaskRecord(config, created.taskId, { principal: 'principal-a', logicalTaskId: 'logical-b' }),
    error => error?.code === 'NATIVE_TASK_UNAVAILABLE'
  );

  const completed = completeNativeToolTask(config, created.taskId, { ok: true, checks: 3 });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result, { ok: true, checks: 3 });
  assert.equal(completed.statusMessage, 'Tool execution completed.');

  const failedTask = createNativeToolTask(config, {
    method: 'tools/call',
    name: 'relai_exec',
    principal: 'principal-a'
  });
  const failed = failNativeToolTask(config, failedTask.taskId, 'Command failed.');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.message, 'Command failed.');

  const cancellable = createNativeToolTask(config, {
    method: 'tools/call',
    name: 'relai_exec',
    principal: 'principal-a'
  });
  const signal = nativeToolTaskSignal(cancellable.taskId);
  const requested = cancelNativeTask(config, cancellable.taskId, { principal: 'principal-a' });
  assert.equal(requested.status, 'working');
  assert.equal(signal.aborted, true);
  const requestedRecord = getNativeTaskRecord(config, cancellable.taskId, { principal: 'principal-a' });
  assert.equal(requestedRecord.cancelRequested, true);
  assert.equal(requestedRecord.cancellationAcknowledgedAt, null);
  acknowledgeNativeTaskCancellation(config, cancellable.taskId, {
    principal: 'principal-a',
    executionStopped: true
  });
  assert.equal(getNativeTask(config, cancellable.taskId, { principal: 'principal-a' }).status, 'cancelled');

  const legacyRecord = createNativeTask(config, {
    method: 'tools/call',
    name: 'relai_exec',
    principal: 'principal-a',
    ttlMs: 24 * 60 * 60 * 1000,
    executor: { controller: new AbortController() },
    internal: { compatibilityOperation: true, workspace: 'legacy' }
  });
  const legacyRead = getNativeTaskRecord(config, legacyRecord.taskId, { principal: 'principal-a' });
  assert.equal(legacyRead.internal.compatibilityOperation, true, 'old records remain readable during their bounded TTL');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Native tool-task adapter, ownership, cancellation, and legacy-record compatibility passed.');
