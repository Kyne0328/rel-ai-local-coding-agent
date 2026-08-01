import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-deferred-operation-cutover-'));
const workspaceRoot = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
fs.mkdirSync(workspaceRoot, { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'pass.cjs'), `console.log('done');\n`);
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
  clientInfo: { name: 'deferred-operation-cutover-test', version: '1.0.0' }
});
let requestId = 0;

async function call(name, args) {
  requestId += 1;
  client.call(requestId, name, args);
  return client.waitFor(requestId);
}

try {
  client.initialize(++requestId);
  const discovery = await client.waitFor(requestId);
  assert.deepEqual(discovery.result.capabilities.extensions?.['io.modelcontextprotocol/tasks'], {});

  client.send(++requestId, 'tools/list');
  const listed = await client.waitFor(requestId);
  const tools = listed.result.tools;
  const names = tools.map(tool => tool.name);
  assert.equal(names.includes('relai_operation_task_get'), false);
  assert.equal(names.includes('relai_operation_task_cancel'), false);
  for (const name of ['relai_exec', 'relai_diagnostics_run', 'relai_run_checks']) {
    const tool = tools.find(candidate => candidate.name === name);
    assert.equal(tool.inputSchema.properties.defer, undefined, `${name} must not expose defer`);
    assert.equal(tool.outputSchema?.properties?.operationTask, undefined, `${name} must not expose operationTask`);
  }

  const started = await call('relai_begin_work', { workspace: 'app' });
  assert.equal(started.result?.isError, false, JSON.stringify(started));
  const logicalTaskId = started.result.structuredContent.work_id;

  const rejectedDefer = await call('relai_exec', {
    workspace: 'app',
    work_id: logicalTaskId,
    command: 'node pass.cjs',
    timeoutMs: 10000,
    defer: true
  });
  assert.ok(rejectedDefer.error || rejectedDefer.result?.isError, JSON.stringify(rejectedDefer));
  assert.match(JSON.stringify(rejectedDefer), /defer|Invalid/i);

  for (const removed of ['relai_operation_task_get', 'relai_operation_task_cancel']) {
    const response = await call(removed, {
      work_id: logicalTaskId,
      operationTaskId: 'task_removed'
    });
    assert.ok(response.error || response.result?.isError, JSON.stringify(response));
    assert.match(JSON.stringify(response), /not found|Unknown tool/i);
  }

  const synchronous = await call('relai_exec', {
    workspace: 'app',
    work_id: logicalTaskId,
    command: 'node pass.cjs',
    timeoutMs: 10000
  });
  assert.equal(synchronous.result?.isError, false, JSON.stringify(synchronous));
  assert.equal(synchronous.result?.structuredContent?.exitCode, 0);
  assert.match(synchronous.result?.structuredContent?.stdout || '', /done/);
} finally {
  await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Legacy deferred-operation controls are absent and non-capable requests use bounded synchronous execution.');
