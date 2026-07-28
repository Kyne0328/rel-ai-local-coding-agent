import { callTool } from "../src/tools.js";
import { getToolActivity, resetToolActivity } from "../src/toolActivity.js";
import { readConfig } from "../src/config.js";
import { readAudit } from "../src/audit.js";
import { resolvePolicy } from "../src/policyResolver.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-completion-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;

fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'src', 'index.js'), 'console.log("ready");\n', 'utf8');
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
  scripts: { check: 'node --check src/index.js' }
}, null, 2), 'utf8');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: {
    app: {
      path: workspace,
      commands: {},
      testCommands: { check: 'npm run check' }
    }
  }
}, null, 2), 'utf8');
process.env.REL_AI_MCP_CONFIG = configPath;

try {






  async function startTask(scopeId) {
    const result = await callTool('relai_start_task', { workspace: 'app' }, {
      publicHttpOnly: true,
      requestId: `${scopeId}:start`,
      transportType: 'test',
      transportSessionId: 'shared-test-transport'
    });
    assert.ok(result.task_id, 'task start must return an opaque task_id');
    return result.task_id;
  }

  resetToolActivity();
  const unvalidatedTask = await startTask('completion-without-validation');
  const readOnlyCompletion = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: unvalidatedTask,
    summary: 'Read-only task completed without validation.'
  }, { publicHttpOnly: true });
  assert.equal(readOnlyCompletion.ok, true);
  assert.equal(readOnlyCompletion.task_id, unvalidatedTask);
  assert.equal(readOnlyCompletion.validationStatus, 'not_required');
  assert.equal(readOnlyCompletion.completionKnown, true);

  resetToolActivity();
  const unvalidatedMutationTask = await startTask('mutation-without-validation');
  await callTool('relai_edit', {
    workspace: 'app',
    task_id: unvalidatedMutationTask,
    path: 'src/unvalidated.js',
    content: 'console.log("unvalidated mutation");\n'
  }, { publicHttpOnly: true });
  await assert.rejects(
    () => callTool('relai_complete_task', {
      workspace: 'app',
      task_id: unvalidatedMutationTask,
      summary: 'Mutating task must still require validation.'
    }, { publicHttpOnly: true }),
    error => error?.code === 'INVALID_TASK_STATE' && /exact task_id/i.test(error.message)
  );
  await callTool('relai_run_checks', {
    workspace: 'app',
    task_id: unvalidatedMutationTask,
    level: 'standard'
  }, { publicHttpOnly: true });
  await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: unvalidatedMutationTask,
    summary: 'Mutating task completed after its own validation.'
  }, { publicHttpOnly: true });

  resetToolActivity();
  const missingSummaryTask = await startTask('atomic-completion-without-summary');
  await assert.rejects(
    () => callTool('relai_run_checks', {
      workspace: 'app',
      task_id: missingSummaryTask,
      level: 'standard',
      complete: true
    }, { publicHttpOnly: true }),
    /summary is required/i
  );

  resetToolActivity();
  const failedAtomicTask = await startTask('failed-atomic-completion');
  const failedAtomic = await callTool('relai_run_checks', {
    workspace: 'app',
    task_id: failedAtomicTask,
    check: 'node -e "process.exit(1)"',
    complete: true,
    summary: 'This failed validation must not close the task.'
  }, { publicHttpOnly: true });
  assert.equal(failedAtomic.ok, false);
  assert.equal(failedAtomic.validationStatus, 'failed');
  assert.notEqual(failedAtomic.completionKnown, true);
  resetToolActivity();

  const atomicContext = { publicHttpOnly: true };
  const atomicTaskId = await startTask('shared-atomic-transport');
  const atomicCompletion = await callTool('relai_run_checks', {
    workspace: 'app',
    task_id: atomicTaskId,
    level: 'standard',
    complete: true,
    summary: 'Validated and completed atomically.'
  }, atomicContext);
  assert.equal(atomicCompletion.ok, true);
  assert.equal(atomicCompletion.task_id, atomicTaskId);
  assert.equal(atomicCompletion.validationStatus, 'passed');
  assert.equal(atomicCompletion.completionKnown, true);
  assert.equal(atomicCompletion.endReason, 'explicit_completion');
  assert.equal(atomicCompletion.completionSource, 'relai_run_checks');
  assert.equal(atomicCompletion.summary, 'Validated and completed atomically.');
  assert.match(atomicCompletion.nextAction, /completion was accepted/i);
  assert.equal(resolvePolicy({ alias: 'app', path: workspace }, readConfig()).sessionActive, false);
  const atomicStatus = getToolActivity();
  assert.equal(atomicStatus.state, 'idle');
  assert.equal(atomicStatus.lastTask.status, 'completed');
  assert.equal(atomicStatus.lastTask.summary, 'Validated and completed atomically.');
  const atomicAudit = readAudit(readConfig(), { limit: 100 });
  const atomicEvent = atomicAudit.entries.find(entry => entry.taskId === atomicTaskId && entry.tool === 'relai_run_checks' && entry.completionSource === 'relai_run_checks');
  assert.ok(atomicEvent, 'atomic validation completion must be persisted under the exact task ID');
  assert.equal(atomicEvent.completionKnown, true);
  assert.equal(atomicEvent.taskIdentityVersion, 2);
  assert.equal(atomicEvent.taskSummary, 'Validated and completed atomically.');

  resetToolActivity();
  const context = { publicHttpOnly: true };
  const taskId = await startTask('shared-standalone-transport');
  const validation = await callTool('relai_run_checks', {
    workspace: 'app',
    task_id: taskId,
    level: 'standard'
  }, context);
  assert.equal(validation.ok, true);
  assert.equal(validation.task_id, taskId);
  assert.equal(validation.validationStatus, 'passed');
  assert.match(validation.nextAction, /relai_complete_task|complete:true/i);

  const completion = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: taskId,
    summary: 'Implemented and validated the requested code changes.'
  }, context);
  assert.equal(completion.ok, true);
  assert.equal(completion.task_id, taskId);
  assert.equal(completion.completionKnown, true);
  assert.equal(completion.endReason, 'explicit_completion');
  assert.equal(completion.validationStatus, 'passed');
  assert.equal(resolvePolicy({ alias: 'app', path: workspace }, readConfig()).sessionActive, false, 'explicit completion must clear only this task ownership state');

  const status = getToolActivity();
  assert.equal(status.state, 'idle');
  assert.equal(status.lastTask.status, 'completed');
  assert.equal(status.lastTask.completionKnown, true);
  assert.equal(status.lastTask.endReason, 'explicit_completion');
  assert.equal(status.lastTask.summary, 'Implemented and validated the requested code changes.');

  const audit = readAudit(readConfig(), { limit: 100 });
  const completionEvent = audit.entries.find(entry => entry.taskId === taskId && entry.tool === 'relai_complete_task' && entry.ok === true);
  assert.ok(completionEvent, 'completion must be persisted under the requested task ID');
  assert.equal(completionEvent.eventType, 'task.completion.committed');
  assert.equal(completionEvent.completionKnown, true);
  assert.equal(completionEvent.endReason, 'explicit_completion');
  assert.equal(completionEvent.taskSummary, 'Implemented and validated the requested code changes.');

  const duplicateCompletion = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: taskId,
    summary: 'A retry must not create another completion.'
  }, context);
  assert.equal(duplicateCompletion.ok, true);
  assert.equal(duplicateCompletion.task_id, taskId);
  assert.equal(duplicateCompletion.duplicate, true);
  assert.equal(duplicateCompletion.summary, 'Implemented and validated the requested code changes.');

  resetToolActivity();
  const rotatedValidationContext = { publicHttpOnly: true };
  const restartTaskId = await startTask('validation-before-restart');
  await callTool('relai_run_checks', {
    workspace: 'app',
    task_id: restartTaskId,
    level: 'standard'
  }, rotatedValidationContext);
  resetToolActivity();
  const recoveredCompletion = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: restartTaskId,
    summary: 'Recovered the same explicit task after the in-memory tracker restarted.'
  }, { publicHttpOnly: true });
  assert.equal(recoveredCompletion.ok, true);
  assert.equal(recoveredCompletion.task_id, restartTaskId);

  resetToolActivity();
  const changedContext = { publicHttpOnly: true };
  const changedTaskId = await startTask('changed-after-validation');
  await callTool('relai_run_checks', { workspace: 'app', task_id: changedTaskId, level: 'standard' }, changedContext);
  await callTool('relai_edit', {
    workspace: 'app',
    task_id: changedTaskId,
    path: 'src/index.js',
    oldText: 'console.log("ready");',
    newText: 'console.log("changed after validation");'
  }, changedContext);
  await assert.rejects(
    () => callTool('relai_complete_task', {
      workspace: 'app',
      task_id: changedTaskId,
      summary: 'This must be rejected.'
    }, changedContext),
    error => error?.code === 'INVALID_TASK_STATE' && /code changed after/i.test(error.message)
  );

  resetToolActivity();
  const sharedScope = { publicHttpOnly: true };
  const taskA = await startTask('one-shared-client-connection');
  const taskB = await startTask('one-shared-client-connection');
  assert.notEqual(taskA, taskB);
  await callTool('relai_edit', {
    workspace: 'app',
    task_id: taskB,
    path: 'src/task-b.js',
    content: 'console.log("task b mutation");\n'
  }, sharedScope);
  await callTool('relai_run_checks', { workspace: 'app', task_id: taskA, level: 'standard' }, sharedScope);
  await assert.rejects(
    () => callTool('relai_complete_task', {
      workspace: 'app',
      task_id: taskB,
      summary: 'Task B must not borrow task A validation.'
    }, sharedScope),
    error => error?.code === 'INVALID_TASK_STATE' && /exact task_id/i.test(error.message)
  );
  const completedA = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: taskA,
    summary: 'Task A completes independently.'
  }, sharedScope);
  assert.equal(completedA.task_id, taskA);
  await callTool('relai_run_checks', { workspace: 'app', task_id: taskB, level: 'standard' }, sharedScope);
  const completedB = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: taskB,
    summary: 'Task B completes independently.'
  }, sharedScope);
  assert.equal(completedB.task_id, taskB);

  resetToolActivity();
  const sharedWorkspaceScope = { publicHttpOnly: true };
  const taskE = await startTask('shared-workspace-conflict');
  const taskF = await startTask('shared-workspace-conflict');
  await callTool('relai_run_checks', { workspace: 'app', task_id: taskE, level: 'standard' }, sharedWorkspaceScope);
  await callTool('relai_edit', {
    workspace: 'app',
    task_id: taskF,
    path: 'src/index.js',
    oldText: 'console.log("changed after validation");',
    newText: 'console.log("changed by another task");'
  }, sharedWorkspaceScope);
  await assert.rejects(
    () => callTool('relai_complete_task', {
      workspace: 'app',
      task_id: taskE,
      summary: 'Task E must detect task F changed the shared worktree.'
    }, sharedWorkspaceScope),
    error => error?.code === 'TASK_PERSISTENCE_CONFLICT' && /another logical task changed/i.test(error.message)
  );
  await callTool('relai_run_checks', { workspace: 'app', task_id: taskE, level: 'standard' }, sharedWorkspaceScope);
  const completedE = await callTool('relai_complete_task', {
    workspace: 'app',
    task_id: taskE,
    summary: 'Task E revalidated the shared worktree and completed safely.'
  }, sharedWorkspaceScope);
  assert.equal(completedE.task_id, taskE);
  assert.equal(getToolActivity().tasks.some(task => task.taskId === taskF), true, 'task F must remain active after task E completes');

  console.log('Task-scoped atomic, standalone, retry, restart, shared-worktree, and multi-chat completion tests passed.');
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(temp, { recursive: true, force: true });
}
