import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TASKS_EXTENSION_ID } from '../src/mcp/protocol.js';
import { startMcpClient } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-stdio-tasks-'));
const workspaceDir = path.join(stateDir, 'workspace');
const configPath = path.join(stateDir, 'config.json');
const taskCaps = { extensions: { [TASKS_EXTENSION_ID]: {} } };
fs.mkdirSync(workspaceDir, { recursive: true });
fs.writeFileSync(path.join(workspaceDir, 'README.md'), '# stdio transport test\n');
fs.writeFileSync(configPath, `${JSON.stringify({
  version: 2,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  toolMode: 'chatgpt_local_repo',
  trustedLocalAgent: true,
  maxOutputBytes: 2 * 1024 * 1024,
  telemetry: { enabled: false, endpoint: '', sampleRatio: 1 },
  processEnvironment: { allow: [] },
  workspaces: {
    repo: {
      path: workspaceDir,
      protectedBranches: ['main', 'master'],
      defaultBaseBranch: 'main',
      allowedRemotes: ['origin'],
      context: { snapshotMaxFiles: 3000, includeRoots: [], excludePaths: ['.git', 'node_modules', 'build', 'dist', 'coverage'] },
      testCommands: {},
      commands: {}
    }
  }
}, null, 2)}\n`);

const env = { REL_AI_MCP_STATE_DIR: stateDir };
const native = startMcpClient({ root, configPath, env, timeoutMs: 15000, clientCapabilities: taskCaps });
const sync = startMcpClient({ root, configPath, env, timeoutMs: 15000, clientCapabilities: {} });
const other = startMcpClient({ root, configPath, env, timeoutMs: 15000, clientCapabilities: taskCaps });
let nativeId = 1;
let syncId = 1;
let otherId = 1;

try {
  for (const [client, id] of [[native, nativeId++], [sync, syncId++], [other, otherId++]]) {
    client.initialize(id);
    assert.equal((await client.waitFor(id)).error, undefined);
  }

  const nativeLogical = await startLogicalTask(native, nativeId++, 'stdio native parity');
  native.call(nativeId, 'relai_exec', {
    workspace: 'repo',
   work_id: nativeLogical,
    command: quick('stdio-parity'),
    timeoutMs: 15000,
    maxOutputBytes: 65536
  });
  const nativeStart = await native.waitFor(nativeId++);
  assert.equal(nativeStart.error, undefined, JSON.stringify(nativeStart));
  assert.equal(nativeStart.result.resultType, 'task');
  const taskId = nativeStart.result.taskId;

  other.send(otherId, 'tasks/get', { taskId });
  const denied = await other.waitFor(otherId++);
  assert.equal(denied.error.code, -32602);
  assert.match(denied.error.message, /not available to this client/i);

  sync.send(syncId, 'tasks/get', { taskId });
  assert.equal((await sync.waitFor(syncId++)).error.code, -32021);

  const nativeFinal = await terminal(native, () => nativeId++, taskId);
  assert.equal(nativeFinal.status, 'completed', JSON.stringify(nativeFinal));
  assert.equal(nativeFinal.result.structuredContent.ok, true);

  const syncLogical = await startLogicalTask(sync, syncId++, 'stdio synchronous parity');
  sync.call(syncId, 'relai_exec', {
    workspace: 'repo',
    work_id: syncLogical,
    command: quick('stdio-parity'),
    timeoutMs: 5000,
    maxOutputBytes: 65536
  });
  const synchronous = await sync.waitFor(syncId++);
  assert.equal(synchronous.error, undefined, JSON.stringify(synchronous));
  assert.equal(synchronous.result.taskId, undefined);
  assert.equal(synchronous.result.structuredContent.ok, true);
  assert.equal(synchronous.result.structuredContent.stdout, nativeFinal.result.structuredContent.stdout);
  assert.equal(synchronous.result.structuredContent.exitCode, nativeFinal.result.structuredContent.exitCode);

  native.send(nativeId, 'tasks/update', {
    taskId,
    inputResponses: { approval: { approved: true } }
  });
  assert.equal((await native.waitFor(nativeId++)).error.code, -32602);

  const cancelLogical = await startLogicalTask(native, nativeId++, 'stdio cancellation');
  native.call(nativeId, 'relai_exec', {
    workspace: 'repo',
    work_id: cancelLogical,
    command: delay(5000),
    timeoutMs: 15000,
    maxOutputBytes: 65536
  });
  const cancellable = await native.waitFor(nativeId++);
  native.send(nativeId, 'tasks/cancel', { taskId: cancellable.result.taskId });
  assert.equal((await native.waitFor(nativeId++)).error, undefined);
  assert.equal((await terminal(native, () => nativeId++, cancellable.result.taskId)).status, 'cancelled');

  const abortLogical = await startLogicalTask(sync, syncId++, 'stdio request abort');
  const requestId = syncId++;
  sync.call(requestId, 'relai_exec', {
    workspace: 'repo',
    work_id: abortLogical,
    command: delay(5000),
    timeoutMs: 10000,
    maxOutputBytes: 65536
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  sync.notify('notifications/cancelled', { requestId, reason: 'test cancellation' });
  const aborted = await sync.waitFor(requestId);
  assert.equal(aborted.error.code, -32800);
  assert.equal(aborted.error.data.reason, 'execution_aborted');

  console.log('Stdio native Tasks, bounded fallback, connection-scoped isolation, parity, cancellation, and request abort passed.');
} finally {
  await native.close().catch(() => {});
  await sync.close().catch(() => {});
  await other.close().catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

async function startLogicalTask(client, id, title) {
  client.call(id, 'relai_begin_work', { workspace: 'repo', title });
  const response = await client.waitFor(id);
  assert.equal(response.error, undefined, JSON.stringify(response));
  const taskId = response.result?.structuredContent?.work_id;
  assert.ok(taskId, JSON.stringify(response));
  return taskId;
}

async function terminal(client, nextId, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const id = nextId();
    client.send(id, 'tasks/get', { taskId });
    const response = await client.waitFor(id);
    assert.equal(response.error, undefined, JSON.stringify(response));
    if (['completed', 'failed', 'cancelled'].includes(response.result.status)) return response.result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Task ${taskId} did not terminate.`);
}

function quick(text) {
  return `node -e "process.stdout.write('${text}')"`;
}

function delay(milliseconds) {
  return `node -e "setTimeout(() => {}, ${milliseconds})"`;
}
