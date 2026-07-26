import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-mcp-multichat-'));
const stateDir = path.join(root, 'state');
const configPath = path.join(root, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;

function createWorkspace(name) {
  const directory = path.join(root, name);
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'src', 'index.js'), `console.log(${JSON.stringify(name)});\n`);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
    scripts: { check: 'node --check src/index.js' }
  }, null, 2));
  fs.writeFileSync(path.join(directory, 'wait-barrier.js'), [
    "'use strict';",
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.READY_FILE, 'ready');",
    'const deadline = Date.now() + 15000;',
    'while (!fs.existsSync(process.env.RELEASE_FILE)) {',
    "  if (Date.now() > deadline) throw new Error('barrier timeout');",
    '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);',
    '}',
    ''
  ].join('\n'));
  return directory;
}

const workspaceA = createWorkspace('repo-a');
const workspaceB = createWorkspace('repo-b');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: {
    appA: { path: workspaceA, commands: {}, testCommands: { check: 'node --check src/index.js' } },
    appB: { path: workspaceB, commands: {}, testCommands: { check: 'node --check src/index.js' } }
  }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  const { handleMessage, SERVER_INSTANCE_ID } = require('../src/server.js');
  const { getToolActivity, resetToolActivity } = require('../src/toolActivity.js');
  const { readConfig } = require('../src/config.js');
  const { readAudit } = require('../src/audit.js');

  resetToolActivity();
  let requestSequence = 0;
  const sharedConnection = {
    publicHttpOnly: true,
    taskScopeId: 'mcp:transport:one-shared-chatgpt-client',
    transportType: 'streamable-http',
    transportSessionId: 'one-shared-chatgpt-client'
  };

  async function rpc(name, args, options = sharedConnection) {
    const id = ++requestSequence;
    const response = await handleMessage({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args }
    }, options);
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, id);
    assert.ok(response.result?.structuredContent, `${name} must return structured MCP content`);
    return {
      payload: response.result.structuredContent,
      isError: response.result.isError === true
    };
  }

  const initialization = await handleMessage({
    jsonrpc: '2.0',
    id: 'initialize',
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'deterministic-test-client', version: '1.0.0' } }
  }, sharedConnection);
  assert.equal(initialization.result.capabilities.experimental.relai.taskIdentityVersion, 2);
  assert.match(initialization.result.instructions, /relai_start_task exactly once/);
  assert.match(initialization.result.instructions, /configured workspace alias \(appA, appB\) or the exact absolute path/);
  assert.match(initialization.result.instructions, /Never use a relative path such as "\."/);
  assert.match(initialization.result.instructions, /never treat an MCP transport session.*as the task identity/);

  const listedTools = await handleMessage({ jsonrpc: '2.0', id: 'tools-list', method: 'tools/list', params: {} }, sharedConnection);
  const listedStartTask = listedTools.result.tools.find(tool => tool.name === 'relai_start_task');
  assert.equal(listedStartTask.inputSchema.properties.workspace.enum, undefined);
  assert.match(listedStartTask.inputSchema.properties.workspace.description, /Aliases: appA, appB/);

  const startByPath = await rpc('relai_start_task', { workspace: workspaceA });
  assert.equal(startByPath.isError, false);
  assert.equal(startByPath.payload.workspace, 'appA');
  const pathTask = startByPath.payload.task_id;
  const pathSnapshot = await rpc('relai_repo_snapshot', { workspace: 'appA', task_id: pathTask, maxEntries: 20 });
  assert.equal(pathSnapshot.isError, false, 'a task started by path must accept its canonical alias on later calls');
  await rpc('relai_run_checks', { workspace: workspaceA, task_id: pathTask, level: 'standard' });
  const pathCompletion = await rpc('relai_complete_task', { workspace: 'appA', task_id: pathTask, summary: 'Path-normalized task completed.' });
  assert.equal(pathCompletion.isError, false);

  const startA = await rpc('relai_start_task', { workspace: 'appA' });
  const startB = await rpc('relai_start_task', { workspace: 'appB' });
  const taskA = startA.payload.task_id;
  const taskB = startB.payload.task_id;
  assert.equal(startA.isError, false);
  assert.equal(startB.isError, false);
  assert.ok(taskA);
  assert.ok(taskB);
  assert.notEqual(taskA, taskB, 'one MCP connection must support multiple logical task identities');

  const snapshotA = await rpc('relai_repo_snapshot', { workspace: 'appA', task_id: taskA, maxEntries: 50 });
  const snapshotB = await rpc('relai_repo_snapshot', { workspace: 'appB', task_id: taskB, maxEntries: 50 });
  assert.equal(snapshotA.payload.task_id, taskA);
  assert.equal(snapshotB.payload.task_id, taskB);

  const validationA = await rpc('relai_run_checks', { workspace: 'appA', task_id: taskA, level: 'standard' });
  assert.equal(validationA.payload.validationStatus, 'passed');

  const readyFile = path.join(root, 'task-b.ready');
  const releaseFile = path.join(root, 'task-b.release');
  const runningB = rpc('relai_exec', {
    workspace: 'appB',
    task_id: taskB,
    command: 'node wait-barrier.js',
    timeoutMs: 30000,
    env: { READY_FILE: readyFile, RELEASE_FILE: releaseFile }
  });
  await waitForFile(readyFile, 10000);

  const activeBeforeCompletion = getToolActivity();
  const taskBActivity = activeBeforeCompletion.tasks.find(task => task.taskId === taskB);
  assert.equal(taskBActivity?.activeCalls, 1, 'the barrier must hold task B inside an active tool invocation');

  const completedA = await rpc('relai_complete_task', {
    workspace: 'appA',
    task_id: taskA,
    summary: 'Task A completed while task B was still executing.'
  });
  assert.equal(completedA.isError, false);
  assert.equal(completedA.payload.task_id, taskA);
  assert.equal(completedA.payload.completionKnown, true);
  assert.equal(getToolActivity().tasks.some(task => task.taskId === taskB), true, 'completing task A must leave task B active');

  fs.writeFileSync(releaseFile, 'release');
  const finishedBOperation = await runningB;
  assert.equal(finishedBOperation.isError, false);
  assert.equal(finishedBOperation.payload.task_id, taskB);

  const validationB = await rpc('relai_run_checks', { workspace: 'appB', task_id: taskB, level: 'standard' });
  assert.equal(validationB.payload.validationStatus, 'passed');
  const completedB = await rpc('relai_complete_task', {
    workspace: 'appB',
    task_id: taskB,
    summary: 'Task B completed after its independent operation finished.'
  });
  assert.equal(completedB.payload.task_id, taskB);
  assert.equal(completedB.payload.completionKnown, true);

  const duplicateA = await rpc('relai_complete_task', {
    workspace: 'appA',
    task_id: taskA,
    summary: 'Transport retry should be idempotent.'
  }, { ...sharedConnection, taskScopeId: 'mcp:transport:reconnected-client', transportSessionId: 'reconnected-client' });
  assert.equal(duplicateA.isError, false);
  assert.equal(duplicateA.payload.task_id, taskA);
  assert.equal(duplicateA.payload.duplicate, true);
  assert.equal(duplicateA.payload.summary, 'Task A completed while task B was still executing.');
  const completedTaskReuse = await rpc('relai_read', {
    workspace: 'appA',
    task_id: taskA,
    paths: ['src/index.js']
  });
  assert.equal(completedTaskReuse.isError, true);
  assert.equal(completedTaskReuse.payload.errorCode, 'INVALID_TASK_STATE');

  const startC = await rpc('relai_start_task', { workspace: 'appA' });
  const startD = await rpc('relai_start_task', { workspace: 'appA' });
  const taskC = startC.payload.task_id;
  const taskD = startD.payload.task_id;
  assert.notEqual(taskC, taskD, 'same-repository objectives must remain separate');
  const taskDMutation = await rpc('relai_edit', {
    workspace: 'appA',
    task_id: taskD,
    path: 'src/task-d.js',
    content: 'console.log("task d mutation");\n'
  });
  assert.equal(taskDMutation.isError, false);
  await rpc('relai_run_checks', { workspace: 'appA', task_id: taskC, level: 'standard' });
  const invalidD = await rpc('relai_complete_task', {
    workspace: 'appA',
    task_id: taskD,
    summary: 'Task D must not borrow task C validation.'
  });
  assert.equal(invalidD.isError, true);
  assert.equal(invalidD.payload.errorCode, 'INVALID_TASK_STATE');
  const validC = await rpc('relai_complete_task', {
    workspace: 'appA',
    task_id: taskC,
    summary: 'Task C completed with its own validation.'
  });
  assert.equal(validC.payload.task_id, taskC);
  await rpc('relai_run_checks', { workspace: 'appA', task_id: taskD, level: 'standard' });
  const validD = await rpc('relai_complete_task', {
    workspace: 'appA',
    task_id: taskD,
    summary: 'Task D completed with its own validation.'
  });
  assert.equal(validD.payload.task_id, taskD);

  const unknown = await rpc('relai_read', {
    workspace: 'appA',
    task_id: '00000000-0000-4000-8000-000000000000',
    paths: ['src/index.js']
  });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.payload.errorCode, 'TASK_NOT_FOUND');

  const audit = readAudit(readConfig(), { limit: 10000, fullScan: true }).entries;
  for (const taskId of [taskA, taskB, taskC, taskD]) {
    const taskEvents = audit.filter(event => event.taskId === taskId);
    assert.ok(taskEvents.length > 0, `audit must retain events for ${taskId}`);
    assert.equal(taskEvents.every(event => event.taskIdentityVersion === 2), true);
    assert.equal(taskEvents.every(event => event.serverInstanceId === SERVER_INSTANCE_ID), true);
    assert.equal(taskEvents.every(event => event.requestId), true);
    const startEvent = taskEvents.find(event => event.eventType === 'task.started');
    assert.equal(startEvent?.clientName, 'deterministic-test-client');
    assert.equal(startEvent?.clientVersion, '1.0.0');
    assert.equal(startEvent?.initializationRequestId, 'initialize');
    assert.equal(taskEvents.some(event => event.eventType === 'task.completion.committed'), true);
  }
  assert.equal(audit.some(event => event.taskId === taskA && event.eventType === 'task.completion.duplicate' && event.duplicateRequest === true), true);
  assert.equal(getToolActivity().state, 'idle');

  console.log('MCP multi-chat task isolation, controlled concurrency, reconnect, and retry integration tests passed.');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(root, { recursive: true, force: true });
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for barrier file: ${filePath}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
