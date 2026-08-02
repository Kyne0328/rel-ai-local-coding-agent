import { callTool } from "../src/tools.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createToolActivityTracker, getToolActivity, onToolActivity, resetToolActivity } from "../src/toolActivity.js";
import { createToolSleepBlocker, createTaskActivityRuntime } from "../electron/tool-sleep-blocker.js";

let nowValue = 1000;
let timerId = 0;
const timers = new Map();
const trackerEvents = [];
const tracker = createToolActivityTracker({
  idleMs: 60_000,
  now: () => nowValue,
  setTimer(callback, delay) {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimer(id) { timers.delete(id); }
});
tracker.onToolActivity(event => trackerEvents.push(event));

const finishRead = tracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'repo', scopeId: 'request-a', createTask: true, operation: 'Reading src/app.js' });
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.operation, 'Reading src/app.js');
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.title, 'Reading src/app.js');
finishRead.update({ operation: 'Reading src/config.js' });
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.operation, 'Reading src/config.js');
const finishChecks = tracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'other', scopeId: 'request-b', createTask: true });
assert.notEqual(finishRead.taskId, finishChecks.taskId, 'each explicit task start must create a separate task');
assert.equal(tracker.getToolActivity().activeConnectorCalls, 2);
assert.equal(tracker.getToolActivity().activeTaskCount, 2);
finishRead();
finishChecks();
assert.equal(tracker.getToolActivity().state, 'waiting');
assert.equal(timers.size, 2);

nowValue = 30_000;
const finishEdit = tracker.beginConnectorToolCall({ tool: 'relai_edit', workspace: 'repo', scopeId: 'request-c', taskId: finishRead.taskId });
assert.equal(finishEdit.taskId, finishRead.taskId, 'follow-up calls must use the supplied exact task ID');
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.calls, 2);
finishEdit();
const waitingTask = tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId);
assert.equal(waitingTask?.status, 'planning');
assert.equal(waitingTask?.events.length, 2, 'each tool invocation must retain one lifecycle event');
assert.equal(waitingTask?.events.at(-1)?.status, 'succeeded');
assert.equal(waitingTask?.correlation?.workspaceId, 'repo');
assert.equal([...timers.values()].every(timer => timer.delay === 60_000), true);

const queueTracker = createToolActivityTracker({ idleMs: 60_000 });
const finishQueuedRead = queueTracker.beginConnectorToolCall({
  tool: 'relai_read',
  workspace: 'repo',
  scopeId: 'queue-test',
  taskId: finishRead.taskId,
  input: { paths: ['src/app.js'] }
});
finishQueuedRead.update({
  currentStage: 'Workspace queue admitted',
  currentActivity: 'Waited 1.8 seconds for the workspace execution queue.',
  metadata: { waitMs: 1800, queueMode: 'write', queued: 2 }
});
finishQueuedRead({
  ok: true,
  activity: {
    status: 'succeeded',
    title: 'Read repository files',
    summary: 'Read 1 repository item.',
    currentStage: 'Inspecting repository',
    currentActivity: 'Read 1 repository item.',
    progress: { mode: 'determinate', completedUnits: 1, totalUnits: 1, percentage: 100, source: 'batch' },
    metadata: { pathCount: 1 }
  }
});
const queuedEvent = queueTracker.getToolActivity().tasks[0]?.events[0];
assert.equal(queuedEvent?.metadata?.waitMs, 1800);
assert.match(queuedEvent?.summary || '', /Waited 1\.8 seconds for the workspace execution queue/);

const approvalTracker = createToolActivityTracker({ idleMs: 60_000 });
const finishApproval = approvalTracker.beginConnectorToolCall({
  tool: 'relai_edit',
  workspace: 'repo',
  scopeId: 'approval-test',
  createTask: true
});
finishApproval({
  ok: false,
  error: 'Approval required.',
  activity: {
    status: 'blocked',
    title: 'Update repository files',
    summary: 'Approval is required before updating repository files.',
    currentStage: 'Waiting for approval',
    currentActivity: 'Approval is required before updating repository files.',
    progress: { mode: 'indeterminate', label: 'Approval required' }
  }
});
const approvalTask = approvalTracker.getToolActivity().tasks[0];
assert.equal(approvalTask?.status, 'waiting_for_approval');
assert.equal(approvalTask?.currentStage, 'Waiting for approval');
assert.equal(approvalTask?.events[0]?.status, 'blocked');

const revalidationTracker = createToolActivityTracker({ idleMs: 60_000 });
const finishRevalidation = revalidationTracker.beginConnectorToolCall({
  tool: 'relai_finish_work',
  workspace: 'repo',
  scopeId: 'revalidation-test',
  createTask: true
});
finishRevalidation({
  ok: false,
  error: 'Task completion is paused because code changed after validation.',
  activity: {
    status: 'blocked',
    title: 'Finalizing logical task',
    summary: 'Task completion paused: final validation is required.',
    currentStage: 'Validation required',
    currentActivity: 'Task completion paused: final validation is required.',
    progress: { mode: 'indeterminate', label: 'Final validation required' },
    error: { code: 'TASK_REVALIDATION_REQUIRED', message: 'Final validation is required.', retryable: true },
    metadata: { errorCode: 'TASK_REVALIDATION_REQUIRED', retryable: true },
    result: { outcome: 'Final validation required' }
  }
});
const revalidationTask = revalidationTracker.getToolActivity().tasks[0];
assert.equal(revalidationTask?.status, 'blocked');
assert.equal(revalidationTask?.currentStage, 'Validation required');
assert.equal(revalidationTask?.progress?.label, 'Final validation required');
assert.equal(revalidationTask?.lastOutcome, 'blocked');
assert.equal(revalidationTask?.failures, 0);
assert.equal(revalidationTask?.events[0]?.status, 'blocked');
assert.equal(revalidationTask?.events[0]?.result?.outcome, 'Final validation required');

const volumeTracker = createToolActivityTracker({ idleMs: 60_000 });
const finishVolumeStart = volumeTracker.beginConnectorToolCall({
  tool: 'relai_begin_work',
  workspace: 'repo',
  scopeId: 'volume-test',
  createTask: true
});
const volumeTaskId = finishVolumeStart.taskId;
finishVolumeStart();
for (let index = 1; index < 250; index += 1) {
  const finishVolumeCall = volumeTracker.beginConnectorToolCall({
    tool: 'relai_status',
    workspace: 'repo',
    scopeId: `volume-${index}`,
    taskId: volumeTaskId
  });
  finishVolumeCall();
}
const volumeTask = volumeTracker.getToolActivity().tasks[0];
assert.equal(volumeTask?.calls, 250);
assert.equal(volumeTask?.events.length, 200, 'long tasks must retain a bounded activity timeline');
assert.equal(new Set(volumeTask?.events.map(event => event.eventId)).size, 200, 'bounded timelines must retain unique lifecycle events');

nowValue = 91_000;
for (const { callback } of [...timers.values()]) callback();
timers.clear();
assert.equal(tracker.getToolActivity().state, 'idle');
const inactive = trackerEvents.filter(event => event.phase === 'cancelled' && event.endReason === 'inactivity_window').map(event => event.task);
assert.equal(inactive.length, 2);
assert.equal(inactive.find(task => task.taskId === finishRead.taskId)?.calls, 2);
assert.equal(inactive.find(task => task.taskId === finishChecks.taskId)?.calls, 1);
assert.equal(inactive.every(task => task.status === 'cancelled' && task.endReason === 'inactivity_window'), true);
assert.equal(inactive.every(task => task.endedAt && task.title && ['determinate', 'indeterminate'].includes(task.progress?.mode)), true);

const reconnectTracker = createToolActivityTracker({ idleMs: 60_000 });
const startedTask = reconnectTracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'repo', scopeId: 'transport-a', createTask: true });
startedTask();
const rotatedTransport = reconnectTracker.beginConnectorToolCall({ tool: 'relai_finish_work', workspace: 'repo', scopeId: 'transport-b', taskId: startedTask.taskId });
assert.equal(rotatedTransport.taskId, startedTask.taskId, 'an exact task ID must survive transport rotation');
rotatedTransport();
assert.throws(
  () => reconnectTracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'transport-c' }),
  error => error?.code === 'TASK_ID_REQUIRED',
  'tracked calls without an explicit task ID must fail rather than infer by scope or workspace'
);
const secondTask = reconnectTracker.beginConnectorToolCall({ tool: 'relai_begin_work', workspace: 'repo', scopeId: 'transport-b', createTask: true });
assert.notEqual(secondTask.taskId, startedTask.taskId, 'separate explicit starts remain isolated even on one transport');
secondTask();
reconnectTracker.reset();

const warningCompletionTracker = createToolActivityTracker({ idleMs: 60_000 });
const warningStart = warningCompletionTracker.beginConnectorToolCall({
  tool: 'relai_begin_work',
  workspace: 'repo',
  scopeId: 'warning-completion',
  createTask: true,
  title: 'Completed task with retained warnings'
});
const warningTaskId = warningStart.taskId;
warningStart();
const failedProbe = warningCompletionTracker.beginConnectorToolCall({
  tool: 'relai_http_probe',
  workspace: 'repo',
  scopeId: 'warning-completion',
  taskId: warningTaskId
});
failedProbe({ ok: false, error: 'Probe unavailable.' });
const warningCompletion = warningCompletionTracker.beginConnectorToolCall({
  tool: 'relai_finish_work',
  workspace: 'repo',
  scopeId: 'warning-completion',
  taskId: warningTaskId
});
warningCompletion.requestCompletion({ summary: 'Task completed after a non-fatal diagnostic warning.' });
warningCompletion();
const completedWithWarningMetadata = warningCompletionTracker.getToolActivity().lastTask;
assert.equal(completedWithWarningMetadata?.status, 'completed', 'explicit completion must remain the primary lifecycle status');
assert.equal(completedWithWarningMetadata?.completionKnown, true);
assert.equal(completedWithWarningMetadata?.failures, 1, 'failed calls remain available as warning metadata');
assert.equal(completedWithWarningMetadata?.failedToolCallCount, 1);
assert.equal(completedWithWarningMetadata?.progress?.percentage, 100);
warningCompletionTracker.reset();

let nextId = 40;
const started = new Set();
const blockerCalls = [];
const fakePowerSaveBlocker = {
  start(type) {
    blockerCalls.push(['start', type]);
    const id = nextId++;
    started.add(id);
    return id;
  },
  stop(id) {
    blockerCalls.push(['stop', id]);
    return started.delete(id);
  },
  isStarted(id) { return started.has(id); }
};

const blocker = createToolSleepBlocker(fakePowerSaveBlocker);
blocker.update(1);
blocker.update(2);
assert.equal(blocker.isActive(), true);
assert.deepEqual(blockerCalls, [['start', 'prevent-display-sleep']], 'concurrent work must share one display-sleep blocker');
blocker.update(1);
assert.equal(blocker.isActive(), true);
blocker.update(0);
assert.equal(blocker.isActive(), false);
assert.deepEqual(blockerCalls, [['start', 'prevent-display-sleep'], ['stop', 40]]);

let boundListener = null;
let unsubscribed = false;
let resetCalls = 0;
let runtimeStatus = { state: 'idle', activeConnectorCalls: 0, activeTaskCount: 0, tasks: [] };
const runtime = createTaskActivityRuntime({
  toolActivity: {
    onToolActivity(listener) {
      boundListener = listener;
      return () => { unsubscribed = true; };
    },
    getToolActivity() { return runtimeStatus; },
    resetToolActivity() {
      resetCalls += 1;
      runtimeStatus = { state: 'idle', activeConnectorCalls: 0, activeTaskCount: 0, tasks: [] };
    }
  },
  powerSaveBlocker: fakePowerSaveBlocker,
  Notification: class { static isSupported() { return false; } },
  isReady: () => true
});
runtime.setNotificationsEnabled(false);
runtimeStatus = { state: 'working', activeConnectorCalls: 1, activeTaskCount: 1, tasks: [{ id: 'task', state: 'working', activeCalls: 1 }] };
boundListener({ phase: 'started', activeConnectorCalls: 1 });
assert.equal(started.has(41), true);
runtimeStatus = { state: 'waiting', activeConnectorCalls: 0, activeTaskCount: 1, tasks: [{ id: 'task', state: 'waiting', activeCalls: 0 }] };
boundListener({ phase: 'finished', activeConnectorCalls: 0, ok: true });
assert.equal(started.has(41), true, 'the blocker must remain active while the work session is open between calls');
assert.equal(runtime.getStatus().activeTaskCount, 1);
assert.deepEqual(runtime.resetHistory(), { ok: true });
assert.equal(started.has(41), false, 'clearing the final open session must release the blocker');
assert.equal(resetCalls, 1);
runtimeStatus = { state: 'working', activeCalls: 1, activeConnectorCalls: 1, activeTaskCount: 1, tasks: [{ id: 'task', state: 'working', activeCalls: 1 }] };
assert.equal(runtime.resetHistory().ok, false, 'history reset must refuse while a tool call is active');
runtime.stop();
assert.equal(unsubscribed, true);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tool-activity-'));
const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_CONFIG = path.join(sandbox, 'config.json');
fs.writeFileSync(process.env.REL_AI_MCP_CONFIG, JSON.stringify({
  stateDir: path.join(sandbox, 'state'),
  workspaces: {}
}, null, 2));

try {
  resetToolActivity();

  const callEvents = [];
  const stopListening = onToolActivity(event => callEvents.push(event));

  await callTool('relai_work', { action: 'status' }, { publicHttpOnly: true });
  assert.deepEqual(callEvents.slice(0, 2).map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_work', 1],
    ['finished', 'relai_work', 0]
  ]);
  assert.equal(callEvents[0].taskId, '');
  assert.equal(callEvents[1].taskId, '');
  assert.equal(getToolActivity().activeTaskCount, 0, 'taskless status calls must not create logical sessions');

  callEvents.length = 0;
  await callTool('relai_work', { action: 'status' }, { publicHttpOnly: false });
  assert.deepEqual(callEvents.map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_work', 0],
    ['finished', 'relai_work', 0]
  ], 'stdio/local calls must be grouped without activating the connector sleep blocker');
  assert.equal(callEvents[0].taskId, '');
  assert.equal(callEvents[1].taskId, '');
  assert.equal(getToolActivity().activeTaskCount, 0, 'local status calls must remain activity-only');

  callEvents.length = 0;
  await assert.rejects(
    () => callTool('relai_read', {}, { publicHttpOnly: true }),
    error => error?.code === 'TASK_ID_REQUIRED'
  );
  assert.deepEqual(callEvents, [], 'schema-level task rejection must happen before activity begins');
  assert.equal(getToolActivity().activeTaskCount, 0, 'rejected taskless calls must not leave waiting sessions');
  stopListening();
  resetToolActivity();
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Concurrent tool activity, task grouping, and sleep blocker tests passed.');
