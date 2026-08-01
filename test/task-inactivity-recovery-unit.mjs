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
    }
  };
}

{
  const { tracker, advanceToInactivity } = createHarness();
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_begin_work',
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
  assert.equal(inactive?.status, 'cancelled', 'a recovered historical failure must not poison inactivity classification');
  assert.equal(inactive?.failedToolCallCount, 1);
  assert.equal(inactive?.terminalReason, 'Task was cancelled after the inactivity window elapsed.');
}

{
  const { tracker, advanceToInactivity } = createHarness();
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_begin_work',
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
  assert.equal(inactive?.status, 'failed');
  assert.equal(inactive?.terminalReason, 'Task became inactive after an unrecovered failure.');
}

console.log('Task inactivity recovery tests passed.');
