import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  completeNativeToolTask,
  createNativeToolTask
} from '../src/mcp/nativeToolTasks.js';
import { getNativeTask, getNativeTaskRecord } from '../src/mcp/nativeTaskService.js';
import { sanitizeAttributes, summarizeCommandForTelemetry, telemetrySampleRatio } from '../src/telemetry.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-tool-task-'));
const config = { stateDir: root };
try {
  const created = createNativeToolTask(config, {
    method: 'tools/call',
    name: 'relai_validate',
    workspace: 'app',
    logicalTaskId: 'logical-task',
    principal: 'client-a'
  });
  assert.equal(created.status, 'working');
  assert.match(created.taskId, /^task_/);
  assert.equal(getNativeTaskRecord(config, created.taskId, { principal: 'client-a' }).internal.workspace, 'app');
  assert.throws(
    () => getNativeTask(config, created.taskId, { principal: 'client-b' }),
    /not available/
  );

  const completed = await completeNativeToolTask(config, created.taskId, { ok: true });
  assert.equal(completed.status, 'completed');
  assert.deepEqual(getNativeTask(config, created.taskId, { principal: 'client-a' }).result, { ok: true });
  assert.equal(fs.existsSync(path.join(root, 'operation-tasks')), false);
  assert.equal(fs.existsSync(path.join(root, 'native-tasks')), true);

  const attributes = sanitizeAttributes({
    'relai.workspace': 'app',
    authorization: 'Bearer secret',
    approval_token: 'secret',
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

console.log('Native tool-task ownership and telemetry redaction tests passed.');
