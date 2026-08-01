import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHttpMcpSession, postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await reservePort();
const token = 'native-tasks-probe-token';
const extensionId = 'io.modelcontextprotocol/tasks';
const probeTool = 'relai_native_tasks_probe';
const tasksCapability = { extensions: { [extensionId]: {} } };
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-tasks-probe-'));
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir
  }
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
const base = `http://127.0.0.1:${port}`;

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. ${stderr}`);
}

async function invokeProbe(client, id, durationMs, capabilities = tasksCapability) {
  return client.request('tools/call', {
    name: probeTool,
    arguments: { durationMs, label: 'Automated native task probe' }
  }, { id, name: probeTool, capabilities });
}

async function taskRequest(client, id, method, taskId, extra = {}, capabilities = tasksCapability) {
  return client.request(method, { taskId, ...extra }, { id, name: taskId, capabilities });
}

let client = null;
try {
  await waitForHealth();

  client = await createHttpMcpSession(base, {
    token,
    clientName: 'native-tasks-client',
    capabilities: tasksCapability
  });
  assert.equal(client.discovery.response.headers.get('mcp-session-id'), null);
  assert.deepEqual(client.discovery.body.result?.capabilities?.extensions?.[extensionId], {});
  assert.deepEqual(client.discovery.body.result?.supportedVersions, ['2026-07-28']);

  const listed = await client.request('tools/list', {}, { id: 2, capabilities: {} });
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.result?.tools?.length, 33);
  assert.ok(listed.body.result.tools.some(tool => tool.name === probeTool));
  assert.equal(listed.body.result.tools.some(tool => tool.name === 'relai_operation_task_get'), false);
  assert.equal(listed.body.result.tools.some(tool => tool.name === 'relai_operation_task_cancel'), false);

  const missingProbeCapability = await invokeProbe(client, 3, 1000, {});
  assert.equal(missingProbeCapability.body.error?.code, -32003);
  assert.deepEqual(
    missingProbeCapability.body.error?.data?.requiredCapabilities?.extensions?.[extensionId],
    {}
  );

  const created = await invokeProbe(client, 4, 1500);
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.result?.resultType, 'task');
  assert.equal(created.body.result?.status, 'working');
  assert.match(created.body.result?.taskId || '', /^task_[A-Za-z0-9_-]{32,160}$/);
  assert.equal(created.body.result?.pollIntervalMs, 1000);
  assert.equal(created.body.result?.task, undefined, 'task results must use the final flat wire shape');
  const taskId = created.body.result.taskId;

  const working = await taskRequest(client, 5, 'tasks/get', taskId);
  assert.equal(working.body.result?.resultType, 'complete');
  assert.equal(working.body.result?.status, 'working');

  const missingGetCapability = await taskRequest(client, 6, 'tasks/get', taskId, {}, {});
  assert.equal(missingGetCapability.body.error?.code, -32003);

  const update = await taskRequest(client, 7, 'tasks/update', taskId, {
    inputResponses: { unknown: { ignored: true } }
  });
  assert.deepEqual(update.body.result, { resultType: 'complete' });

  await new Promise(resolve => setTimeout(resolve, 1600));
  const completed = await taskRequest(client, 8, 'tasks/get', taskId);
  assert.equal(completed.body.result?.status, 'completed');
  assert.equal(completed.body.result?.result?.isError, false);
  assert.equal(completed.body.result?.result?.structuredContent?.nativeTasksProbe, true);
  assert.equal(completed.body.result?.result?.structuredContent?.taskId, taskId);

  const immutableCancel = await taskRequest(client, 9, 'tasks/cancel', taskId);
  assert.deepEqual(immutableCancel.body.result, { resultType: 'complete' });
  const stillCompleted = await taskRequest(client, 10, 'tasks/get', taskId);
  assert.equal(stillCompleted.body.result?.status, 'completed');

  const cancellable = await invokeProbe(client, 11, 5000);
  const cancellableId = cancellable.body.result.taskId;
  const cancelled = await taskRequest(client, 12, 'tasks/cancel', cancellableId);
  assert.deepEqual(cancelled.body.result, { resultType: 'complete' });
  const cancelledState = await taskRequest(client, 13, 'tasks/get', cancellableId);
  assert.equal(cancelledState.body.result?.status, 'cancelled');

  const invalid = await taskRequest(client, 14, 'tasks/get', 'task_invalid');
  assert.equal(invalid.body.error?.code, -32602);
  assert.match(invalid.body.error?.message || '', /not available to this client/);

  const mismatchedHeader = await client.request('tasks/get', { taskId }, {
    id: 15,
    name: 'task_wrong_header_name_12345678901234567890123456789012',
    capabilities: tasksCapability
  });
  assert.equal(mismatchedHeader.response.status, 400);
  assert.match(mismatchedHeader.body.error?.message || '', /does not match/);

  const paramHeader = await client.request('tasks/get', { taskId }, {
    id: 16,
    capabilities: tasksCapability,
    extraHeaders: { 'mcp-param-extra': 'not-declared' }
  });
  assert.equal(paramHeader.response.status, 400);
  assert.match(paramHeader.body.error?.message || '', /not declared/);

  const legacySessionHeader = await client.request('tools/list', {}, {
    id: 17,
    sessionId: 'legacy-session-id'
  });
  assert.equal(legacySessionHeader.response.status, 400);
  assert.match(legacySessionHeader.body.error?.message || '', /Mcp-Session-Id is not supported/);

  const legacyInitialize = await postMcp(base, {
    id: 18,
    method: 'initialize',
    token,
    protocolVersion: '2025-11-25',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ChatGPT', version: '1' } }
  });
  assert.equal(legacyInitialize.response.status, 200);
  assert.equal(legacyInitialize.body.result?.protocolVersion, '2025-11-25');
  assert.ok(legacyInitialize.body.result?.capabilities?.tools);
} finally {
  if (client) await client.close().catch(() => {});
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('MCP 2026-07-28 stateless native Tasks negotiation, lifecycle, routing, and rejection flow passed.');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(selectedPort));
    });
  });
}
