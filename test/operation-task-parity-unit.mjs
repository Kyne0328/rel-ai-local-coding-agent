import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertOperationTaskLogicalOwner,
  assertOperationTaskPrincipal,
  cancelOperationTask,
  completeOperationTask,
  createOperationTask,
  failOperationTask,
  getOperationTask,
  operationTaskSignal,
  updateOperationTask
} from '../src/operationTasks.js';
import { acknowledgeNativeTaskCancellation, getNativeTaskRecord } from '../src/mcp/nativeTaskService.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-operation-task-parity-'));
const config = { stateDir: root };
try {
  const created = createOperationTask(config, {
    method: 'tools/call', name: 'relai_run_checks', workspace: 'repo',
    logicalTaskId: 'logical-a', principal: 'principal-a', message: 'Starting validation.'
  });
  assert.equal(created.status, 'working');
  assert.equal(created.progress, 0);
  assert.equal(created.workspace, 'repo');
  assert.equal(operationTaskSignal(config, created.taskId)?.aborted, false);

  const nativeCreated = getNativeTaskRecord(config, created.taskId, { principal: 'principal-a', logicalTaskId: 'logical-a' });
  assert.equal(nativeCreated.origin.method, 'tools/call');
  assert.equal(nativeCreated.origin.name, 'relai_run_checks');
  assert.equal(nativeCreated.origin.logicalTaskId, 'logical-a');
  assert.equal(nativeCreated.internal.compatibilityOperation, true);
  assert.equal(nativeCreated.internal.progress, 0);
  assert.equal(Object.hasOwn(nativeCreated, 'progress'), false);
  assert.ok(fs.existsSync(path.join(root, 'native-tasks', `${created.taskId}.json`)));
  assert.equal(fs.existsSync(path.join(root, 'operation-tasks')), false);

  assertOperationTaskPrincipal(config, created.taskId, 'principal-a');
  assert.throws(() => assertOperationTaskPrincipal(config, created.taskId, 'principal-b'), error => error?.code === 'NATIVE_TASK_UNAVAILABLE');
  assertOperationTaskLogicalOwner(config, created.taskId, 'logical-a');
  assert.throws(() => assertOperationTaskLogicalOwner(config, created.taskId, 'logical-b'), /different logical task or is unavailable/);

  const progressed = updateOperationTask(config, created.taskId, { progress: 0.55, message: 'Running tests.' });
  assert.equal(progressed.progress, 0.55);
  assert.equal(progressed.message, 'Running tests.');
  const nativeProgressed = getNativeTaskRecord(config, created.taskId, { principal: 'principal-a' });
  assert.equal(nativeProgressed.internal.progress, 0.55);
  assert.equal(nativeProgressed.statusMessage, 'Running tests.');

  const completed = completeOperationTask(config, created.taskId, { ok: true, checks: 3 });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress, 1);
  assert.deepEqual(completed.result, { ok: true, checks: 3 });
  assert.deepEqual(updateOperationTask(config, created.taskId, { progress: 0.9 }), completed);

  const failedTask = createOperationTask(config, { method: 'tools/call', name: 'relai_exec', principal: 'principal-a' });
  const failed = failOperationTask(config, failedTask.taskId, 'Command failed.');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'Command failed.');
  assert.ok(failed.progress < 1);

  const cancellable = createOperationTask(config, { method: 'tools/call', name: 'relai_exec', principal: 'principal-a' });
  const signal = operationTaskSignal(config, cancellable.taskId);
  const requested = cancelOperationTask(config, cancellable.taskId);
  assert.equal(requested.status, 'working');
  assert.equal(requested.cancelRequested, true);
  assert.equal(signal.aborted, true);
  const nativeRequested = getNativeTaskRecord(config, cancellable.taskId, { principal: 'principal-a' });
  assert.equal(nativeRequested.cancelRequested, true);
  assert.equal(nativeRequested.cancellationAcknowledgedAt, null);
  acknowledgeNativeTaskCancellation(config, cancellable.taskId, { principal: 'principal-a', executionStopped: true });
  const cancelled = getOperationTask(config, cancellable.taskId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelRequested, true);
  assert.ok(cancelled.progress < 1);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Operation-task projection and native Task authority parity passed.');
