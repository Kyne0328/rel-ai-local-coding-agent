import assert from 'node:assert/strict';

import {
  CANONICAL_TASK_STATUSES,
  canTransitionTaskStatus,
  isTerminalTaskStatus,
  normalizeHistoricalTaskStatus
} from '../src/taskState.js';
import { SESSION_IDLE_TTL_MS } from '../src/policyResolver.js';
import { createToolActivityTracker, DEFAULT_TASK_IDLE_MS } from '../src/toolActivity.js';

assert.equal(CANONICAL_TASK_STATUSES.includes('inactive'), true);
assert.equal(isTerminalTaskStatus('inactive'), false);
for (const status of ['planning', 'running', 'blocked', 'validating', 'validation_failed']) {
  assert.equal(canTransitionTaskStatus(status, 'inactive'), true, `${status} must be able to become inactive`);
}
for (const status of ['planning', 'running', 'blocked', 'validating']) {
  assert.equal(canTransitionTaskStatus('inactive', status), true, `inactive must resume as ${status}`);
}
assert.equal(canTransitionTaskStatus('completed', 'inactive'), false);
assert.equal(canTransitionTaskStatus('cancelled', 'inactive'), false);
assert.equal(canTransitionTaskStatus('failed', 'inactive'), false);
assert.equal(normalizeHistoricalTaskStatus('cancelled', { completionKnown: false, endReason: 'inactivity_window' }), 'inactive');
assert.equal(normalizeHistoricalTaskStatus('failed', { completionKnown: false, endReason: 'inactivity_window' }), 'inactive');
assert.equal(normalizeHistoricalTaskStatus('cancelled', { completionKnown: false, endReason: 'explicit_cancellation' }), 'cancelled');
assert.equal(normalizeHistoricalTaskStatus('completed', { completionKnown: true, endReason: 'explicit_completion' }), 'completed');
assert.ok(DEFAULT_TASK_IDLE_MS < SESSION_IDLE_TTL_MS, 'activity inactivity must age out before durable session ownership expires');

let now = 1_000;
let timerId = 0;
const timers = new Map();
const events = [];
const tracker = createToolActivityTracker({
  idleMs: 20_000,
  now: () => now,
  setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimer(id) { timers.delete(id); }
});
tracker.onToolActivity(event => events.push(event));
const begin = tracker.beginConnectorToolCall({ tool: 'relai_work', internalOperation: 'work.begin', workspace: 'repo', createTask: true, title: 'Resume me', objective: 'Preserve task identity.' });
const taskId = begin.taskId;
begin({ ok: true });
const failed = tracker.beginConnectorToolCall({ tool: 'relai_search', workspace: 'repo', taskId });
failed({ ok: false, error: 'Recoverable probe failed.' });
now += 10_000;
const stillOpen = tracker.getToolActivity().tasks.find(task => task.taskId === taskId);
assert.equal(stillOpen?.status, 'planning', 'idle work must stay open before the stale threshold');
assert.equal(stillOpen?.activeCalls, 0);
now += 10_000;
for (const timer of [...timers.values()]) timer.callback();
timers.clear();
const inactive = tracker.getToolActivity().lastTask;
assert.equal(inactive?.taskId, taskId);
assert.equal(inactive?.status, 'inactive');
assert.equal(inactive?.failures, 1);
assert.ok(inactive?.inactiveAt);
assert.equal(inactive?.endedAt == null, true);
assert.equal(inactive?.completedAt == null, true);
assert.equal(inactive?.cancelledAt == null, true);
assert.equal(events.some(event => event.phase === 'cancelled' || event.phase === 'failed' || event.phase === 'completed'), false, 'inactivity must not emit a false terminal notification');
assert.equal(events.some(event => event.phase === 'inactive'), true);

const resumed = tracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', taskId, resumeTask: inactive });
assert.equal(resumed.taskId, taskId);
resumed({ ok: true });
const resumedTask = tracker.getToolActivity().tasks.find(task => task.taskId === taskId);
assert.equal(resumedTask?.taskId, taskId);
assert.equal(resumedTask?.status, 'planning');
assert.equal(resumedTask?.title, 'Resume me');
assert.equal(resumedTask?.objective, 'Preserve task identity.');
assert.equal(resumedTask?.toolCallCount, 3, 'resuming must continue the existing call count instead of presenting a new task');
assert.equal(resumedTask?.failedToolCallCount, 1, 'resuming must preserve prior failure accounting');
assert.equal(resumedTask?.startedAt, 1_000, 'resuming must preserve the original task start time');

console.log('Resumable inactivity lifecycle tests passed.');