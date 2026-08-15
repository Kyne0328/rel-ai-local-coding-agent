import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createToolActivityTracker, runWithToolActivity } from "../src/toolActivity.js";
import { clearSessionPolicy, ensureSessionStarted, readSessionPolicy } from "../src/policyResolver.js";

// Two logical tasks sharing one MCP transport scope must remain independent.
{
  const tracker = createToolActivityTracker({ idleMs: 60_000 });
  const startA = tracker.beginConnectorToolCall({
    tool: 'relai_begin_work',
    workspace: 'repo',
    scopeId: 'mcp:transport:shared',
    createTask: true
  });
  const taskA = startA.taskId;
  startA();

  const startB = tracker.beginConnectorToolCall({
    tool: 'relai_begin_work',
    workspace: 'repo',
    scopeId: 'mcp:transport:shared',
    createTask: true
  });
  const taskB = startB.taskId;
  startB();

  assert.notEqual(taskA, taskB, 'explicit task creation over one transport must produce independent task IDs');
  assert.equal(tracker.getToolActivity().activeTaskCount, 2);

  const callA = tracker.beginConnectorToolCall({
    tool: 'relai_read',
    workspace: 'repo',
    scopeId: 'mcp:transport:shared',
    taskId: taskA
  });
  const callB = tracker.beginConnectorToolCall({
    tool: 'relai_search',
    workspace: 'repo',
    scopeId: 'mcp:transport:shared',
    taskId: taskB
  });
  assert.equal(callA.taskId, taskA);
  assert.equal(callB.taskId, taskB);
  callA();
  callB();

  assert.throws(
    () => tracker.beginConnectorToolCall({
      tool: 'relai_read',
      workspace: 'repo',
      scopeId: 'mcp:transport:shared'
    }),
    error => error?.code === 'TASK_ID_REQUIRED',
    'an implicit call must fail once one shared transport owns multiple tasks'
  );
  tracker.reset();
}

// Completion locking is task-local: task A may complete while task B is active.
{
  const tracker = createToolActivityTracker({ idleMs: 60_000 });
  const startA = tracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'repo-a', scopeId: 'shared', createTask: true });
  const taskA = startA.taskId;
  startA();
  const startB = tracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'repo-b', scopeId: 'shared', createTask: true });
  const taskB = startB.taskId;
  startB();

  const busyB = tracker.beginConnectorToolCall({ tool: 'relai_exec', workspace: 'repo-b', scopeId: 'shared', taskId: taskB });
  const completeA = tracker.beginConnectorToolCall({ tool: 'relai_finish_work', workspace: 'repo-a', scopeId: 'shared', taskId: taskA });
  const completion = runWithToolActivity(completeA, () => completeA.requestCompletion({ summary: 'A complete.' }));
  assert.equal(completion.taskId, taskA);
  completeA();
  assert.equal(tracker.getToolActivity().tasks.some(task => task.taskId === taskB), true, 'completing A must leave B active');
  busyB();
  tracker.reset();
}

// Concurrent completion retries for the same task must collapse into one idempotent transition.
{
  const tracker = createToolActivityTracker({ idleMs: 60_000 });
  const start = tracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'repo', scopeId: 'shared', createTask: true });
  const taskId = start.taskId;
  start();
  const first = tracker.beginConnectorToolCall({ tool: 'relai_finish_work', workspace: 'repo', scopeId: 'shared', taskId });
  const second = tracker.beginConnectorToolCall({ tool: 'relai_finish_work', workspace: 'repo', scopeId: 'shared', taskId });
  const accepted = runWithToolActivity(first, () => first.requestCompletion({ summary: 'Completed once.' }));
  const duplicate = runWithToolActivity(second, () => second.requestCompletion({ summary: 'Duplicate request.' }));
  assert.equal(accepted.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  first();
  assert.equal(tracker.getToolActivity().tasks.some(task => task.taskId === taskId), true, 'task remains active until all in-flight completion calls finish');
  second();
  assert.equal(tracker.getToolActivity().activeTaskCount, 0);
  assert.equal(tracker.getToolActivity().lastTask?.taskId, taskId);
  assert.equal(tracker.getToolActivity().lastTask?.status, 'completed');
  assert.equal(tracker.getToolActivity().lastTask?.summary, 'Completed once.');
  tracker.reset();
}

// Workspace ownership policies must be keyed by task, not overwritten per workspace.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-multi-task-policy-'));
  const workspace = path.join(root, 'workspace');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), '# task isolation\n');
  const config = { stateDir };
  try {
    assert.equal(await ensureSessionStarted(config, 'repo', workspace, { taskId: 'task-a' }), true);
    fs.writeFileSync(path.join(workspace, 'a.txt'), 'a\n');
    assert.equal(await ensureSessionStarted(config, 'repo', workspace, { taskId: 'task-b' }), true);
    const policyA = readSessionPolicy(config, 'repo', 'task-a');
    const policyB = readSessionPolicy(config, 'repo', 'task-b');
    assert.equal(policyA?.taskId, 'task-a');
    assert.equal(policyB?.taskId, 'task-b');
    assert.notEqual(policyA?.createdAt, undefined);
    assert.notEqual(policyB?.createdAt, undefined);
    clearSessionPolicy(config, 'repo', 'task-a');
    assert.equal(readSessionPolicy(config, 'repo', 'task-a'), null);
    assert.equal(readSessionPolicy(config, 'repo', 'task-b')?.taskId, 'task-b', 'clearing A must not clear B');
  } finally {
    await removeDirectoryWithRetry(root);
  }
}

async function removeDirectoryWithRetry(directory, attempts = 40) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (process.platform === 'win32' && lastError?.code === 'EPERM') {
    process.once('exit', () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} });
    return;
  }
  throw lastError;
}

console.log('Multi-chat logical task isolation tests passed.');
