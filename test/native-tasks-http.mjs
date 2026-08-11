import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { TASKS_EXTENSION_REVISION } from '../src/mcp/protocol.js';
import { createHttpMcpSession, postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = await reservePort();
const token = 'native-tasks-http-token';
const extensionId = 'io.modelcontextprotocol/tasks';
const eligibleTool = 'relai_exec';
const tasksCapability = { extensions: { [extensionId]: { revision: TASKS_EXTENSION_REVISION } } };
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-native-tasks-http-'));
const workspaceDir = path.join(stateDir, 'workspace');
const configPath = path.join(stateDir, 'config.json');
fs.mkdirSync(workspaceDir, { recursive: true });
fs.writeFileSync(path.join(workspaceDir, 'package.json'), `${JSON.stringify({
  name: 'relai-native-task-fixture',
  private: true,
  type: 'module'
}, null, 2)}\n`);
fs.writeFileSync(path.join(workspaceDir, 'edit-target.txt'), 'before\n');

const config = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'config.example.json'), 'utf8'));
config.stateDir = stateDir;
config.auditLogPath = path.join(stateDir, 'audit.jsonl');
config.workspaces = { repo: { ...(config.workspaces?.myapp || {}), path: workspaceDir } };
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: configPath,
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

async function callTool(client, id, name, args, capabilities = tasksCapability) {
  return client.request('tools/call', { name, arguments: args }, { id, name, capabilities });
}

async function invokeEligible(client, id, logicalTaskId, durationMs, capabilities = tasksCapability) {
  const taskCapable = Boolean(capabilities?.extensions?.[extensionId]);
  return callTool(client, id, eligibleTool, {
    work_id: logicalTaskId,
    command: sleepCommand(durationMs),
    timeoutMs: taskCapable ? Math.max(15000, durationMs + 2000) : Math.max(5000, durationMs + 2000),
    maxOutputBytes: 64 * 1024
  }, capabilities);
}

async function taskRequest(client, id, method, taskId, extra = {}, capabilities = tasksCapability) {
  return client.request(method, { taskId, ...extra }, { id, name: taskId, capabilities });
}

function sleepCommand(durationMs) {
  return `node -e "setTimeout(() => {}, ${durationMs})"`;
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
  assert.deepEqual(client.discovery.body.result?.capabilities?.extensions?.[extensionId], { revision: TASKS_EXTENSION_REVISION });
  assert.deepEqual(client.discovery.body.result?.supportedVersions, ['2026-07-28']);

  const listed = await client.request('tools/list', {}, { id: 2, capabilities: {} });
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.result?.tools?.length, 12);
  assert.equal(listed.body.result.tools.some(tool => tool.name === 'relai_native_tasks_probe'), false);
  assert.equal(listed.body.result.tools.some(tool => tool.name === 'relai_operation_task_get'), false);
  assert.equal(listed.body.result.tools.some(tool => tool.name === 'relai_operation_task_cancel'), false);
  assert.equal(listed.body.result.tools.some(tool => Object.hasOwn(tool, 'execution')), false);

  const started = await callTool(client, 3, 'relai_work', {
    action: 'begin',
    workspace: 'repo',
    title: 'Native Tasks HTTP integration',
    objective: 'Verify selective native task execution and bounded synchronous fallback.',
    bootstrap: 'none'
  });
  assert.equal(started.body.result?.isError, false, JSON.stringify(started.body));
  const logicalTaskId = started.body.result?.structuredContent?.work_id;
  assert.ok(logicalTaskId);

  const editCreated = await callTool(client, 300, 'relai_edit', {
    workspace: 'repo',
    work_id: logicalTaskId,
    path: 'edit-target.txt',
    oldText: 'before',
    newText: 'after'
  });
  assert.equal(editCreated.response.status, 200, JSON.stringify(editCreated.body));
  assert.equal(editCreated.body.result?.resultType, 'complete', 'relai_edit must return a completed CallToolResult instead of a task handle');
  assert.equal(editCreated.body.result?.taskId, undefined, 'relai_edit must not require task polling');
  assert.equal(editCreated.body.result?.isError, false, JSON.stringify(editCreated.body));
  assert.equal(editCreated.body.result?.structuredContent?.ok, true, JSON.stringify(editCreated.body));
  assert.equal(fs.readFileSync(path.join(workspaceDir, 'edit-target.txt'), 'utf8'), 'after\n');
  const postEditStatus = await callTool(client, 420, 'relai_work', { action: 'status', work_id: logicalTaskId }, {});
  assert.equal(postEditStatus.response.status, 200, JSON.stringify(postEditStatus.body));
  assert.equal(postEditStatus.body.result?.isError, false, JSON.stringify(postEditStatus.body));

  const fallback = await invokeEligible(client, 4, logicalTaskId, 50, {});
  assert.notEqual(fallback.body.result?.resultType, 'task');
  assert.equal(fallback.body.result?.taskId, undefined);
  assert.equal(fallback.body.result?.isError, false, JSON.stringify(fallback.body));
  assert.equal(fallback.body.result?.structuredContent?.exitCode, 0);
  assert.equal(fallback.body.result?.structuredContent?.work_id, logicalTaskId);

  const taskCapableExec = await invokeEligible(client, 5, logicalTaskId, 1000);
  assert.equal(taskCapableExec.response.status, 200, JSON.stringify(taskCapableExec.body));
  assert.notEqual(taskCapableExec.body.result?.resultType, 'task', 'task-capable clients must still receive the final tool result');
  assert.equal(taskCapableExec.body.result?.taskId, undefined, 'ordinary relai_exec calls must not require polling');
  assert.equal(taskCapableExec.body.result?.isError, false, JSON.stringify(taskCapableExec.body));
  assert.equal(taskCapableExec.body.result?.structuredContent?.exitCode, 0);
  assert.equal(taskCapableExec.body.result?.structuredContent?.work_id, logicalTaskId);
  const invalid = await taskRequest(client, 250, 'tasks/get', 'task_invalid');
  assert.equal(invalid.body.error?.code, -32602);
  assert.match(invalid.body.error?.message || '', /not available to this client/);

  const protocolTaskId = 'task_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const mismatchedHeader = await client.request('tasks/get', { taskId: protocolTaskId }, {
    id: 251,
    name: 'task_wrong_header_name_12345678901234567890123456789012',
    capabilities: tasksCapability
  });
  assert.equal(mismatchedHeader.response.status, 400);
  assert.match(mismatchedHeader.body.error?.message || '', /does not match/);

  const paramHeader = await client.request('tasks/get', { taskId: protocolTaskId }, {
    id: 252,
    capabilities: tasksCapability,
    extraHeaders: { 'mcp-param-extra': 'not-declared' }
  });
  assert.equal(paramHeader.response.status, 400);
  assert.match(paramHeader.body.error?.message || '', /not declared/);

  const legacySessionHeader = await client.request('tools/list', {}, {
    id: 253,
    sessionId: 'legacy-session-id'
  });
  assert.equal(legacySessionHeader.response.status, 400);
  assert.match(legacySessionHeader.body.error?.message || '', /Mcp-Session-Id is not supported/);

  const initializeInsideModernEnvelope = await postMcp(base, {
    id: 254,
    method: 'initialize',
    token,
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ChatGPT', version: '1' } }
  });
  assert.equal(initializeInsideModernEnvelope.response.status, 400);
  assert.equal(initializeInsideModernEnvelope.body.error?.code, -32601);
} finally {
  if (client) await client.close().catch(() => {});
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('MCP 2026-07-28 synchronous tool execution and Tasks protocol routing passed.');

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
