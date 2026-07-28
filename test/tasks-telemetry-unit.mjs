import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createOperationTask,
  updateOperationTask,
  completeOperationTask,
  cancelOperationTask,
  getOperationTask,
  assertOperationTaskPrincipal
} = require('../src/operationTasks.js');
const { sanitizeAttributes } = require('../src/telemetry.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-operation-task-'));
const config = { stateDir: root };

try {
  const created = createOperationTask(config, {
    method: 'tools/call', name: 'relai_run_checks', workspace: 'app',
    logicalTaskId: 'logical-task', principal: 'client-a'
  });
  assert.equal(created.status, 'working');
  assertOperationTaskPrincipal(config, created.taskId, 'client-a');
  assert.throws(() => assertOperationTaskPrincipal(config, created.taskId, 'client-b'), /authorization context/);

  const updated = updateOperationTask(config, created.taskId, { progress: 0.5, message: 'Halfway' });
  assert.equal(updated.progress, 0.5);
  const completed = completeOperationTask(config, created.taskId, { ok: true });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(getOperationTask(config, created.taskId).result, { ok: true });

  const cancellable = createOperationTask(config, { method: 'tools/call', name: 'relai_exec', principal: 'client-a' });
  const cancelled = cancelOperationTask(config, cancellable.taskId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelRequested, true);

  const attributes = sanitizeAttributes({
    'relai.workspace': 'app',
    'authorization': 'Bearer secret',
    'approval_token': 'secret',
    'command.env.PASSWORD': 'secret',
    'safe.number': 2
  });
  assert.equal(attributes.authorization, '[redacted]');
  assert.equal(attributes.approval_token, '[redacted]');
  assert.equal(attributes['command.env.PASSWORD'], '[redacted]');
  assert.equal(attributes['safe.number'], 2);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Operation task persistence, principal binding, cancellation, and telemetry redaction tests passed.');
