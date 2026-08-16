import assert from 'node:assert/strict';

import { createToolActivityTracker } from '../src/toolActivity.js';

function createHarness() {
  let now = 1_000;
  let nextTimerId = 0;
  const timers = new Map();
  const tracker = createToolActivityTracker({
    idleMs: 300_000,
    now: () => now,
    setTimer(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    }
  });

  return {
    tracker,
    advanceToInactivity() {
      now += 300_000;
      const pending = [...timers.values()];
      timers.clear();
      for (const timer of pending) timer.callback();
    },
    advanceWithoutFiringTimers() {
      now += 300_000;
    }
  };
}

{
  const { tracker, advanceToInactivity } = createHarness();
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_work', internalOperation: 'work.begin',
    workspace: 'repo',
    createTask: true
  });
  const taskId = start.taskId;
  start({ ok: true });

  const failedSearch = tracker.beginConnectorToolCall({
    tool: 'relai_search',
    workspace: 'repo',
    taskId
  });
  failedSearch({ ok: false, error: 'Malformed regular expression.' });

  let active = tracker.getToolActivity().tasks.find(task => task.taskId === taskId);
  assert.equal(active?.failures, 1);
  assert.equal(active?.lastOutcome, 'failed');
  assert.match(active?.errorSummary || '', /Malformed regular expression/);

  const recoveredRead = tracker.beginConnectorToolCall({
    tool: 'relai_read',
    workspace: 'repo',
    taskId
  });
  recoveredRead({ ok: true });

  active = tracker.getToolActivity().tasks.find(task => task.taskId === taskId);
  assert.equal(active?.failures, 1, 'historical failure accounting must be retained');
  assert.equal(active?.lastOutcome, 'succeeded');
  assert.equal(active?.errorSummary, '', 'a successful follow-up must clear the stale active error');

  advanceToInactivity();
  const inactive = tracker.getToolActivity().lastTask;
  assert.equal(inactive?.taskId, taskId);
  assert.equal(inactive?.status, 'inactive', 'a recovered historical failure must remain resumable after inactivity');
  assert.equal(inactive?.failedToolCallCount, 1);
  assert.equal(inactive?.endedAt == null, true);
  assert.ok(inactive?.inactiveAt);
}

{
  const { tracker, advanceToInactivity } = createHarness();
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_work', internalOperation: 'work.begin',
    workspace: 'repo',
    createTask: true
  });
  const taskId = start.taskId;
  start({ ok: true });

  const failedSearch = tracker.beginConnectorToolCall({
    tool: 'relai_search',
    workspace: 'repo',
    taskId
  });
  failedSearch({ ok: false, error: 'Malformed regular expression.' });

  advanceToInactivity();
  const inactive = tracker.getToolActivity().lastTask;
  assert.equal(inactive?.taskId, taskId);
  assert.equal(inactive?.status, 'inactive');
  assert.equal(inactive?.resumeStatus, 'planning', 'inactivity must retain the state the task will resume from');
  assert.equal(inactive?.failedToolCallCount, 1);
  assert.match(inactive?.errorSummary || '', /Malformed regular expression/);
}

{
  const { tracker, advanceWithoutFiringTimers } = createHarness();
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_work', internalOperation: 'work.begin',
    workspace: 'repo',
    createTask: true
  });
  const taskId = start.taskId;
  start({ ok: true });

  advanceWithoutFiringTimers();
  const status = tracker.getToolActivity();
  assert.equal(status.activeTaskCount, 0, 'status reads must reap an overdue task even when its timer was delayed');
  assert.equal(status.lastTask?.taskId, taskId);
  assert.equal(status.lastTask?.status, 'inactive');
  assert.equal(status.lastTask?.endReason || '', '');
  assert.ok(status.lastTask?.inactiveAt);
}

{
  const { tracker } = createHarness();
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_work', internalOperation: 'work.begin',
    workspace: 'repo',
    createTask: true
  });
  const taskId = start.taskId;
  start({ ok: false, error: "Workspace 'repo' is not configured." });

  const status = tracker.getToolActivity();
  assert.equal(status.activeTaskCount, 0, 'a rejected work-session start must never remain open');
  assert.equal(status.lastTask?.taskId, taskId);
  assert.equal(status.lastTask?.status, 'failed');
  assert.equal(status.lastTask?.endReason, 'task_start_rejected');
  assert.match(status.lastTask?.terminalReason || '', /not configured/i);
}

console.log('Task inactivity recovery tests passed.');
