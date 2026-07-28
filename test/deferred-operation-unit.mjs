import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-deferred-operation-'));
const workspaceRoot = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'pass.cjs'), `setTimeout(() => { console.log('done'); process.exit(0); }, 100);\n`);
fs.writeFileSync(path.join(workspaceRoot, 'slow.cjs'), `setInterval(() => console.log('working'), 100);\n`);
fs.writeFileSync(configPath, JSON.stringify({
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: {
    app: {
      path: workspaceRoot,
      testCommands: {},
      commands: {},
      protectedBranches: ['main'],
      defaultBaseBranch: 'main',
      allowedRemotes: ['origin'],
      context: { snapshotMaxFiles: 1000, includeRoots: [], excludePaths: ['.git', 'node_modules'] },
      validationRules: {}
    }
  }
}, null, 2));

const client = startMcpClient({
  root,
  configPath,
  timeoutMs: 15000,
  env: { REL_AI_MCP_STATE_DIR: stateDir },
  clientInfo: { name: 'deferred-operation-test', version: '1.0.0' }
});
let requestId = 0;

async function call(name, args) {
  requestId += 1;
  client.call(requestId, name, args);
  const response = await client.waitFor(requestId);
  assert.ok(response.result, JSON.stringify(response));
  return response.result.structuredContent;
}

async function waitForTerminal(taskId, logicalTaskId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await call('relai_operation_task_get', {
      task_id: logicalTaskId,
      operationTaskId: taskId
    });
    if (['completed', 'failed', 'cancelled'].includes(result.operationTask.status)) return result.operationTask;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Deferred operation ${taskId} did not become terminal.`);
}

try {
  client.discover(++requestId);
  const discovery = await client.waitFor(requestId);
  assert.equal(discovery.result.capabilities.extensions?.['io.modelcontextprotocol/tasks'], undefined);

  const started = await call('relai_start_task', { workspace: 'app' });
  const logicalTaskId = started.task_id;
  assert.ok(logicalTaskId);

  const deferred = await call('relai_exec', {
    workspace: 'app',
    task_id: logicalTaskId,
    command: 'node pass.cjs',
    timeoutMs: 10000,
    defer: true
  });
  assert.equal(deferred.ok, true);
  assert.equal(deferred.deferred, true);
  assert.match(deferred.operationTask.taskId, /^op_/);

  const completed = await waitForTerminal(deferred.operationTask.taskId, logicalTaskId);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.ok, true);
  assert.equal(completed.result.exitCode, 0);
  assert.match(completed.result.stdout, /done/);

  const slow = await call('relai_exec', {
    workspace: 'app',
    task_id: logicalTaskId,
    command: 'node slow.cjs',
    timeoutMs: 60000,
    defer: true
  });
  const cancelled = await call('relai_operation_task_cancel', {
    task_id: logicalTaskId,
    operationTaskId: slow.operationTask.taskId
  });
  assert.equal(cancelled.operationTask.status, 'cancelled');
  const final = await waitForTerminal(slow.operationTask.taskId, logicalTaskId);
  assert.equal(final.status, 'cancelled');

  const other = await call('relai_start_task', { workspace: 'app' });
  requestId += 1;
  client.call(requestId, 'relai_operation_task_get', {
    task_id: other.task_id,
    operationTaskId: deferred.operationTask.taskId
  });
  const denied = await client.waitFor(requestId);
  assert.equal(denied.result.isError, true);
  assert.match(denied.result.structuredContent.error || '', /different logical task/);
} finally {
  await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Deferred operation execution, polling, cancellation, and ownership tests passed.');
