import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient } from './helpers/mcp-client.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-mcp-multichat-'));
const stateDir = path.join(sandbox, 'state');
const auditLogPath = path.join(stateDir, 'audit.jsonl');
const configPath = path.join(sandbox, 'config.json');
let client;

function createWorkspace(name) {
  const directory = path.join(sandbox, name);
  fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'src', 'index.js'), `console.log(${JSON.stringify(name)});\n`);
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: { check: 'node --check src/index.js' } }, null, 2));
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
  auditLogPath,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: {
    appA: { path: workspaceA, commands: {}, testCommands: { check: 'node --check src/index.js' } },
    appB: { path: workspaceB, commands: {}, testCommands: { check: 'node --check src/index.js' } }
  }
}, null, 2));

try {
  client = startMcpClient({
    root: repoRoot,
    configPath,
    timeoutMs: 40000,
    clientInfo: { name: 'deterministic-sdk-client', version: '2.0.0' }
  });
  let requestId = 0;

  client.initialize(++requestId);
  const discovery = await client.waitFor(requestId);
  assert.equal(discovery.result.capabilities.experimental.relai.taskIdentityVersion, 2);
  assert.match(discovery.result.instructions, /relai_start_task exactly once/);
  assert.match(discovery.result.instructions, /configured workspace alias \(appA, appB\)/);
  assert.match(discovery.result.instructions, /no transport identifier is a task identity/);

  async function rpc(name, args, { allowError = false } = {}) {
    const id = ++requestId;
    client.call(id, name, args);
    const response = await client.waitFor(id, 40000);
    if (response.error) throw new Error(`${name} protocol error: ${JSON.stringify(response.error)}`);
    const payload = response.result?.structuredContent;
    assert.ok(payload, `${name} must return structured MCP content`);
    if (!allowError) assert.equal(response.result.isError, false, `${name} failed: ${JSON.stringify(payload)}`);
    return { payload, isError: response.result.isError === true };
  }

  client.send(++requestId, 'tools/list', {});
  const listedTools = await client.waitFor(requestId);
  assert.equal(listedTools.result.tools.length, 33);
  const listedStartTask = listedTools.result.tools.find(tool => tool.name === 'relai_start_task');
  assert.match(listedStartTask.inputSchema.properties.workspace.description, /Aliases: appA, appB/);

  const startA = await rpc('relai_start_task', { workspace: 'appA', objective: 'Validate task A.', bootstrap: 'compact' });
  const startB = await rpc('relai_start_task', { workspace: 'appB', objective: 'Validate task B.', bootstrap: 'compact' });
  const startMismatch = await rpc('relai_start_task', { workspace: 'appA', objective: 'Exercise workspace ownership.', bootstrap: 'none' });
  const taskA = startA.payload.task_id;
  const taskB = startB.payload.task_id;
  const mismatchTaskId = startMismatch.payload.task_id;
  assert.ok(taskA && taskB);
  assert.notEqual(taskA, taskB, 'one SDK connection must support independent logical tasks');
  assert.equal(startA.payload.workspaceBinding.alias, 'appA');
  assert.equal(startA.payload.bootstrap.mode, 'compact');
  assert.ok(Array.isArray(startA.payload.bootstrap.files));

  const missingTaskRequestId = ++requestId;
  client.call(missingTaskRequestId, 'relai_read', { paths: ['src/index.js'] });
  const missingTask = await client.waitFor(missingTaskRequestId, 40000);
  assert.equal(missingTask.result?.isError, true, 'the MCP schema must reject task-scoped calls without task_id');
  assert.match(JSON.stringify(missingTask.result?.content), /task_id/i);

  const mismatchedWorkspace = await rpc('relai_read', {
    task_id: mismatchTaskId,
    workspace: 'appB',
    paths: ['src/index.js']
  }, { allowError: true });
  assert.equal(mismatchedWorkspace.isError, true);
  assert.equal(mismatchedWorkspace.payload.errorCode, 'TASK_OWNERSHIP_MISMATCH');

  const recoveredMismatchTask = await rpc('relai_read', {
    task_id: mismatchTaskId,
    paths: ['src/index.js']
  });
  assert.equal(recoveredMismatchTask.payload.workspace, 'appA', 'one rejected assertion must not terminalize its task');

  const boundWorkspaceRead = await rpc('relai_read', { task_id: taskA, paths: ['src/index.js'] });
  assert.equal(boundWorkspaceRead.payload.workspace, 'appA');

  const readyFile = path.join(sandbox, 'task-b.ready');
  const releaseFile = path.join(sandbox, 'task-b.release');
  const execRequestId = ++requestId;
  client.call(execRequestId, 'relai_exec', {
    task_id: taskB,
    command: 'node wait-barrier.js',
    timeoutMs: 30000,
    env: { READY_FILE: readyFile, RELEASE_FILE: releaseFile }
  });
  const runningB = client.waitFor(execRequestId, 40000);
  await waitForFile(readyFile, 10000);

  const validationA = await rpc('relai_run_checks', { task_id: taskA, level: 'standard' });
  assert.equal(validationA.payload.validationStatus, 'passed');
  const completedA = await rpc('relai_complete_task', {
    task_id: taskA, summary: 'Task A completed while task B was still executing.'
  });
  assert.equal(completedA.payload.completionKnown, true);

  fs.writeFileSync(releaseFile, 'release');
  const finishedB = await runningB;
  assert.equal(finishedB.result?.isError, false, JSON.stringify(finishedB));
  assert.equal(finishedB.result.structuredContent.task_id, taskB);

  const validationB = await rpc('relai_run_checks', { task_id: taskB, level: 'standard' });
  assert.equal(validationB.payload.validationStatus, 'passed');
  const completedB = await rpc('relai_complete_task', {
    task_id: taskB, summary: 'Task B completed independently.'
  });
  assert.equal(completedB.payload.completionKnown, true);

  const duplicateA = await rpc('relai_complete_task', {
    task_id: taskA, summary: 'A retry must remain idempotent.'
  });
  assert.equal(duplicateA.payload.duplicate, true);
  assert.equal(duplicateA.payload.summary, 'Task A completed while task B was still executing.');

  const completedReuse = await rpc('relai_read', {
    task_id: taskA, paths: ['src/index.js']
  }, { allowError: true });
  assert.equal(completedReuse.isError, true);
  assert.equal(completedReuse.payload.errorCode, 'INVALID_TASK_STATE');

  await client.close();
  client = null;

  const audit = fs.readFileSync(auditLogPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const serverInstances = new Set();
  for (const taskId of [taskA, taskB]) {
    const taskEvents = audit.filter(event => event.taskId === taskId);
    assert.ok(taskEvents.length > 0, `audit must retain events for ${taskId}`);
    assert.equal(taskEvents.every(event => event.taskIdentityVersion === 2), true);
    assert.equal(taskEvents.every(event => event.requestId != null), true);
    for (const event of taskEvents) if (event.serverInstanceId) serverInstances.add(event.serverInstanceId);
    const startEvent = taskEvents.find(event => event.eventType === 'task.started');
    assert.equal(startEvent?.clientName, 'deterministic-sdk-client');
    assert.equal(startEvent?.clientVersion, '2.0.0');
    assert.equal(taskEvents.some(event => event.eventType === 'task.completion.committed'), true);
  }
  assert.equal(serverInstances.size, 1, 'one stdio SDK connection must use one server instance identity');
  assert.equal(audit.some(event => event.taskId === taskA && event.eventType === 'task.completion.duplicate'), true);

  console.log('MCP SDK stdio preserves concurrent explicit tasks, completion isolation, audit identity, and retries.');
} finally {
  await client?.close().catch(() => {});
  fs.rmSync(sandbox, { recursive: true, force: true });
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for barrier file: ${filePath}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
