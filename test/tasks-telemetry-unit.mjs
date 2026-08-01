import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createOperationTask, updateOperationTask, completeOperationTask, cancelOperationTask, getOperationTask, assertOperationTaskPrincipal } from '../src/operationTasks.js';
import { acknowledgeNativeTaskCancellation } from '../src/mcp/nativeTaskService.js';
import { sanitizeAttributes, summarizeCommandForTelemetry, telemetrySampleRatio } from '../src/telemetry.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-operation-task-'));
const config = { stateDir: root };

try {
  const created = createOperationTask(config, {
    method: 'tools/call', name: 'relai_run_checks', workspace: 'app',
    logicalTaskId: 'logical-task', principal: 'client-a'
  });
  assert.equal(created.status, 'working');
  assert.match(created.taskId, /^task_/);
  assertOperationTaskPrincipal(config, created.taskId, 'client-a');
  assert.throws(() => assertOperationTaskPrincipal(config, created.taskId, 'client-b'), /not available/);

  const updated = updateOperationTask(config, created.taskId, { progress: 0.5, message: 'Halfway' });
  assert.equal(updated.progress, 0.5);
  const completed = completeOperationTask(config, created.taskId, { ok: true });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.message, 'Operation completed.');
  assert.deepEqual(getOperationTask(config, created.taskId).result, { ok: true });

  const cancellable = createOperationTask(config, { method: 'tools/call', name: 'relai_exec', principal: 'client-a' });
  const cancellationRequested = cancelOperationTask(config, cancellable.taskId);
  assert.equal(cancellationRequested.status, 'working');
  assert.equal(cancellationRequested.cancelRequested, true);
  acknowledgeNativeTaskCancellation(config, cancellable.taskId, { principal: 'client-a', executionStopped: true });
  const cancelled = getOperationTask(config, cancellable.taskId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelRequested, true);
  assert.equal(fs.existsSync(path.join(root, 'operation-tasks')), false, 'legacy operation-task storage must not be recreated');
  assert.equal(fs.existsSync(path.join(root, 'native-tasks')), true, 'compatibility callers must use the canonical native task store');

  const attributes = sanitizeAttributes({
    'relai.workspace': 'app',
    'authorization': 'Bearer secret',
    'approval_token': 'secret',
    'command.env.PASSWORD': 'secret',
    'relai.process.command': 'npm run test -- --watch',
    'safe.number': 2
  });
  assert.equal(attributes.authorization, '[redacted]');
  assert.equal(attributes.approval_token, '[redacted]');
  assert.equal(attributes['command.env.PASSWORD'], '[redacted]');
  assert.equal(attributes['relai.process.command'], 'npm [4 args]');
  assert.equal(attributes['safe.number'], 2);
  assert.equal(summarizeCommandForTelemetry('git status --short'), 'git [2 args]');
  assert.equal(telemetrySampleRatio({ telemetry: { sampleRatio: 0.25 } }), 0.25);
  assert.equal(telemetrySampleRatio({ telemetry: { sampleRatio: 2 } }), 1);
  assert.equal(telemetrySampleRatio({ telemetry: { sampleRatio: -1 } }), 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Canonical task compatibility facade, principal binding, cancellation, and telemetry redaction tests passed.');
