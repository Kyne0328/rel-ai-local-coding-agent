import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OPERATION_IDS as OP } from '../src/tools/operationIds.js';
import { isTerminalTaskReference } from '../src/tools/task.js';
import { createToolActivityTracker } from '../src/toolActivity.js';

let now = 1000;
const phases = [];
const tracker = createToolActivityTracker({ idleMs: 60_000, now: () => now });
tracker.onToolActivity(event => phases.push(event.phase));
const start = tracker.beginConnectorToolCall({ tool: 'relai_work', internalOperation: 'work.begin', workspace: 'repo', createTask: true });
const taskId = start.taskId;
start({ ok: true });
now = 2000;
const active = tracker.beginConnectorToolCall({ tool: 'relai_validate', internalOperation: 'validate.checks', workspace: 'repo', taskId });
active.update({
  status: 'validating',
  currentStage: 'Validating 1 of 3',
  currentActivity: 'First check passed.',
  progress: { mode: 'determinate', completedUnits: 1, totalUnits: 3, source: 'validation', label: '1 of 3 checks' }
});
assert.equal(active.signal.aborted, false);
assert.throws(() => tracker.cancelTask('unrelated-task', { reason: 'wrong task' }), error => error?.code === 'TASK_NOT_FOUND');
now = 3000;
const cancelled = tracker.cancelTask(taskId, { reason: 'Stop token=synthetic-cancel-secret now.', initiator: 'test' });
assert.equal(cancelled.status, 'cancelled');
assert.equal(cancelled.duplicate, false);
assert.equal(cancelled.progress.completedUnits, 1);
assert.equal(cancelled.progress.totalUnits, 3);
assert.equal(cancelled.endedAt, 3000);
assert.equal(cancelled.cancelledAt, 3000);
assert.equal(active.signal.aborted, true);
assert.doesNotMatch(cancelled.terminalReason, /synthetic-cancel-secret/);
assert.equal(tracker.cancelTask(taskId, { reason: 'duplicate' }).duplicate, true);
assert.throws(() => active.requestCompletion({ summary: 'must not complete' }), error => error?.code === 'INVALID_TASK_STATE');
active({ ok: false, error: 'Operation cancelled.', activity: { status: 'cancelled', summary: 'Validation cancelled.' } });
const final = tracker.getToolActivity();
assert.equal(final.state, 'idle');
assert.equal(final.lastTask.status, 'cancelled');
assert.equal(final.lastTask.endReason, 'explicit_cancellation');
assert.equal(final.lastTask.endedAt, 3000);
assert.equal(final.lastTask.cancelledAt, 3000);
assert.equal(final.lastTask.progress.completedUnits, 1);
assert.equal(final.lastTask.progress.totalUnits, 3);
assert.equal(phases.filter(phase => phase === 'cancelled').length, 1, 'cancellation must emit one terminal lifecycle transition');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-task-cancellation-'));
const workspace = path.join(temp, 'workspace');
const stateDir = path.join(temp, 'state');
const configPath = path.join(temp, 'config.json');
const previousConfig = process.env.REL_AI_MCP_CONFIG;
assert.equal(isTerminalTaskReference({ status: 'cancelled' }, OP.PROCESS_STOP), true);
assert.equal(isTerminalTaskReference({ status: 'completed' }, OP.UI, { action: 'stop' }), true);
assert.equal(isTerminalTaskReference({ status: 'cancelled' }, OP.UI, { action: 'snapshot' }), false);
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'cancel-fixture' }));
fs.writeFileSync(configPath, JSON.stringify({
  version: 3,
  stateDir,
  auditLogPath: path.join(stateDir, 'audit.jsonl'),
  workspaces: { app: { path: workspace, commands: {}, testCommands: {} } }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;

try {
  const { callTool: rawCallTool } = await import('../src/tools.js');
  const callTool = (name, args, context = {}) => rawCallTool(name, args, { principal: 'local:trusted', ...context });
  const { readTaskHistorySession } = await import('../src/taskHistoryStore.js');
  const { readAudit } = await import('../src/audit.js');
  const { resetToolActivity } = await import('../src/toolActivity.js');
  resetToolActivity();
  const context = { publicHttpOnly: true, requestId: 'cancel-test' };
  const started = await callTool('relai_work', { action: 'begin', workspace: 'app', title: 'Cancelable task' }, context);
  assert.equal(started.status, 'planning');
  const managed = await callTool('relai_process', {
    action: 'start',
    workspace: 'app',
    work_id: started.work_id,
    executable: process.execPath,
    argv: ['-e', 'setInterval(() => {}, 1000)'],
    kind: 'service',
    purpose: 'Verify terminal task cleanup.',
    startupWaitMs: 20
  }, context);
  assert.equal(managed.status, 'running');
  const result = await callTool('relai_work', { action: 'cancel',
    workspace: 'app',
    work_id: started.work_id,
    reason: 'User stopped this work.'
  }, context);
  assert.equal(result.ok, true);
  assert.equal(result.work_id, started.work_id);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.duplicate, false);
  assert.equal(result.endReason, 'explicit_cancellation');
  assert.ok(result.endedAt);
  const stopped = await callTool('relai_process', {
    action: 'stop',
    workspace: 'app',
    work_id: started.work_id,
    processId: managed.processId,
    graceMs: 0
  }, context);
  assert.equal(stopped.status, 'stopped', 'terminal task identity must remain usable for owned resource cleanup');

  const persisted = readTaskHistorySession({ stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl') }, started.work_id);
  assert.equal(persisted.status, 'cancelled');
  assert.equal(persisted.endReason, 'explicit_cancellation');
  assert.ok(persisted.endedAt);
  assert.equal(persisted.progress.percentage === 100, false, 'cancelled work must not be fabricated as complete');

  const duplicate = await callTool('relai_work', { action: 'cancel',
    workspace: 'app', work_id: started.work_id, reason: 'Retry'
  }, context);
  assert.equal(duplicate.duplicate, true);
  await assert.rejects(
    () => callTool('relai_read', { workspace: 'app', work_id: started.work_id, paths: ['package.json'] }, context),
    error => error?.code === 'INVALID_TASK_STATE'
  );
  await assert.rejects(
    () => callTool('relai_work', { action: 'cancel', workspace: 'app', work_id: 'unknown-task', reason: 'Wrong target' }, context),
    error => error?.code === 'TASK_NOT_FOUND'
  );
  const audit = readAudit({ stateDir, auditLogPath: path.join(stateDir, 'audit.jsonl') }, { limit: 100 });
  assert.ok(audit.entries.some(entry => entry.taskId === started.work_id && entry.eventType === 'task.cancellation.committed'));
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Explicit logical-task cancellation is exact, idempotent, terminal, persistent, and preserves partial progress.');
