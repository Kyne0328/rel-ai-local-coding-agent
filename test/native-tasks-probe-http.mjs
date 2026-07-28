import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await reservePort();
const token = 'native-tasks-probe-token';
const extensionId = 'io.modelcontextprotocol/tasks';
const probeTool = 'relai_native_tasks_probe';
const capabilities = { extensions: { [extensionId]: {} } };
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-tasks-probe-'));
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir,
    REL_AI_NATIVE_TASKS_PROBE: '1'
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

async function invokeProbe(id, durationMs, suppliedCapabilities = capabilities) {
  return postMcp(base, {
    id,
    method: 'tools/call',
    token,
    name: probeTool,
    capabilities: suppliedCapabilities,
    params: { name: probeTool, arguments: { durationMs, label: 'Automated native task probe' } }
  });
}

async function taskRequest(id, method, taskId, suppliedCapabilities = capabilities, extra = {}) {
  return postMcp(base, {
    id,
    method,
    token,
    name: taskId,
    capabilities: suppliedCapabilities,
    params: { taskId, ...extra }
  });
}

try {
  await waitForHealth();

  const discovery = await postMcp(base, { id: 1, method: 'server/discover', token });
  assert.deepEqual(discovery.body.result?.capabilities?.extensions?.[extensionId], {});

  const listed = await postMcp(base, { id: 2, method: 'tools/list', token });
  assert.ok(listed.body.result?.tools?.some(tool => tool.name === probeTool));

  const fallback = await invokeProbe(3, 1000, {});
  assert.equal(fallback.body.result?.structuredContent?.clientAdvertisedTasks, false);
  assert.equal(fallback.body.result?.structuredContent?.nativeTaskReturned, false);

  const created = await invokeProbe(4, 1500);
  assert.equal(created.response.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.result?.resultType, 'task');
  assert.equal(created.body.result?.status, 'working');
  assert.match(created.body.result?.taskId || '', /^probe_/);
  assert.equal(created.body.result?.pollIntervalMs, 1000);
  const taskId = created.body.result.taskId;

  const working = await taskRequest(5, 'tasks/get', taskId);
  assert.equal(working.body.result?.resultType, 'complete');
  assert.equal(working.body.result?.status, 'working');

  const missingCapability = await taskRequest(6, 'tasks/get', taskId, {});
  assert.equal(missingCapability.body.error?.code, -32003);
  assert.deepEqual(missingCapability.body.error?.data?.requiredCapabilities?.extensions?.[extensionId], {});

  const update = await taskRequest(7, 'tasks/update', taskId, capabilities, { inputResponses: {} });
  assert.deepEqual(update.body.result, { resultType: 'complete' });

  await new Promise(resolve => setTimeout(resolve, 1600));
  const completed = await taskRequest(8, 'tasks/get', taskId);
  assert.equal(completed.body.result?.status, 'completed');
  assert.equal(completed.body.result?.result?.isError, false);
  assert.equal(completed.body.result?.result?.structuredContent?.nativeTasksProbe, true);
  assert.equal(completed.body.result?.result?.structuredContent?.taskId, taskId);

  const cancellable = await invokeProbe(9, 5000);
  const cancellableId = cancellable.body.result.taskId;
  const cancelled = await taskRequest(10, 'tasks/cancel', cancellableId);
  assert.deepEqual(cancelled.body.result, { resultType: 'complete' });
  const cancelledState = await taskRequest(11, 'tasks/get', cancellableId);
  assert.equal(cancelledState.body.result?.status, 'cancelled');

  const invalid = await taskRequest(12, 'tasks/get', 'probe_invalid');
  assert.equal(invalid.body.error?.code, -32602);

  const mismatchedHeader = await postMcp(base, {
    id: 13,
    method: 'tasks/get',
    token,
    name: 'probe_wrong_header_name_1234567890',
    capabilities,
    params: { taskId }
  });
  assert.equal(mismatchedHeader.response.status, 400);
  assert.match(mismatchedHeader.body.error?.message || '', /does not match/);
} finally {
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Feature-flagged native MCP Tasks probe HTTP flow passed.');

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
