import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import {
  completeNativeToolTask,
  createNativeToolTask
} from '../src/mcp/nativeToolTasks.js';
import { getNativeTask, getNativeTaskRecord } from '../src/mcp/nativeTaskService.js';
import { runSpan, sanitizeAttributes, shutdownTelemetry, summarizeCommandForTelemetry, telemetrySampleRatio, telemetryStatus } from '../src/telemetry.js';

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

  const disabled = telemetryStatus({ telemetry: { enabled: false, endpoint: 'http://127.0.0.1:4318/v1/traces', sampleRatio: 1 } });
  assert.equal(disabled.enabled, false, 'telemetry.enabled=false must remain authoritative even when an endpoint is configured');
  assert.equal(disabled.endpointConfigured, true, 'status may disclose that a disabled endpoint is configured without enabling export');

  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push(Buffer.concat(chunks));
      response.statusCode = 200;
      response.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/traces`;
    await runSpan({ telemetry: { enabled: false, endpoint, sampleRatio: 1 } }, 'relai.test.disabled', {}, async () => true);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(requests.length, 0, 'a configured endpoint must not receive traces while telemetry is disabled');

    const secret = 'SECRET_EXCEPTION_MARKER';
    const privatePath = 'C:\\private\\project\\file.js';
    await assert.rejects(
      () => runSpan({ telemetry: { enabled: true, endpoint, sampleRatio: 1 } }, 'relai.test.privacy', {}, async () => {
        const error = new Error(`${secret} ${privatePath}`);
        error.name = 'SECRET_ERROR_NAME';
        throw error;
      }),
      new RegExp(secret)
    );
    await shutdownTelemetry();
    const payload = Buffer.concat(requests);
    assert.ok(payload.length > 0, 'enabled telemetry must still export operational spans');
    assert.equal(payload.includes(Buffer.from(secret)), false, 'OTLP payloads must never include raw exception messages');
    assert.equal(payload.includes(Buffer.from(privatePath)), false, 'OTLP payloads must never include raw local paths from exceptions');
  } finally {
    await shutdownTelemetry();
    server.close();
    await once(server, 'close');
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Native tool-task ownership and telemetry redaction tests passed.');
