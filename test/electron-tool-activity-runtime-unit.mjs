import assert from 'node:assert/strict';

import { createTaskActivityRuntime, taskActivityBlockReason } from '../electron/tool-sleep-blocker.js';

let snapshotReads = 0;
let listener = null;
const statusChanges = [];
const notifications = [];
const completedTasks = [];
const blockerState = new Set();
const blockerTypes = [];
let nextBlockerId = 1;
const toolActivity = {
  getToolActivity() {
    snapshotReads += 1;
    return { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], lastTask: null };
  },
  onToolActivity(callback) {
    listener = callback;
    return () => { listener = null; };
  },
  resetToolActivity() {}
};
const runtime = createTaskActivityRuntime({
  toolActivity,
  powerSaveBlocker: {
    start(type) { blockerTypes.push(type); const id = nextBlockerId++; blockerState.add(id); return id; },
    stop(id) { blockerState.delete(id); return true; },
    isStarted(id) { return blockerState.has(id); }
  },
  notify: (category, content) => notifications.push({ category, content }),
  onTaskCompleted: task => completedTasks.push(task.taskId),
  onStatusChange: status => statusChanges.push(status)
});

assert.equal(snapshotReads, 1, 'runtime initialization may read one authoritative snapshot');
assert.equal(taskActivityBlockReason({ state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [] }), '');
assert.match(taskActivityBlockReason({ state: 'waiting', activeCalls: 0, activeTaskCount: 1, tasks: [{ taskId: 'task-a', status: 'waiting' }] }), /active Rel\.AI task/);
const task = {
  id: 'task-a', taskId: 'task-a', workspace: 'repo', status: 'running', state: 'working',
  activeCalls: 1, calls: 1, failures: 0, startedAt: 100, lastTool: 'relai_read', operation: 'Read',
  events: Array.from({ length: 200 }, (_, index) => ({ eventId: `event-${index}` })),
  currentOperations: [{ id: 'operation-a' }]
};
listener({ phase: 'started', revision: 1, activeConnectorCalls: 1, activeCalls: 1, activeTaskCount: 1, taskId: 'task-a', task });
assert.equal(snapshotReads, 1, 'live activity must not rebuild the global task snapshot');
assert.equal(runtime.getStatus().tasks.length, 1);
assert.equal(Object.hasOwn(runtime.getStatus().tasks[0], 'events'), false, 'desktop status must not retain task timelines');
assert.equal(Object.hasOwn(runtime.getStatus().tasks[0], 'currentOperations'), false, 'desktop status must not retain operation payloads');
assert.equal(blockerState.size, 1, 'active connector work keeps the app eligible to continue running');
assert.deepEqual(blockerTypes, ['prevent-app-suspension'], 'background work must not keep the user display awake');
listener({
  phase: 'finished', revision: 2, activeConnectorCalls: 0, activeCalls: 0, activeTaskCount: 1,
  taskId: 'task-a', ok: true, task: { ...task, status: 'waiting', state: 'waiting', activeCalls: 0 }
});
assert.equal(runtime.getStatus().activeTaskCount, 1, 'the logical task remains open between connector calls');
assert.equal(runtime.getStatus().activeConnectorCalls, 0);
assert.equal(blockerState.size, 0, 'reasoning and approval gaps must allow normal app suspension');

const completedEvent = {
  phase: 'completed', revision: 2, activeConnectorCalls: 0, activeCalls: 0, activeTaskCount: 0,
  taskId: 'task-a', task: { ...task, status: 'completed', state: 'ended', activeCalls: 0, completionKnown: true, summary: 'Done.' }
};
listener(completedEvent);
listener(completedEvent);
assert.equal(notifications.filter(item => item.category === 'taskCompleted').length, 1, 'duplicate terminal delivery must not repeat the completion notification');
assert.deepEqual(completedTasks, ['task-a'], 'duplicate terminal delivery must not repeat completion side effects');
const failedEvent = {
  phase: 'finished', revision: 3, activeConnectorCalls: 0, activeCalls: 0, activeTaskCount: 0,
  taskId: 'task-a', operation: 'Checking changes', workspace: 'repo', ok: false, error: 'check failed',
  activityEvent: { eventId: 'operation-failed' }
};
listener(failedEvent);
listener(failedEvent);
assert.equal(notifications.filter(item => item.category === 'errors').length, 1, 'duplicate failed-operation delivery must not repeat the native error notification');
assert.equal(snapshotReads, 1, 'terminal activity must remain event-driven');
assert.equal(runtime.getStatus().activeTaskCount, 0);
assert.equal(runtime.getStatus().tasks.length, 0);
assert.equal(runtime.getStatus().lastTask?.taskId, 'task-a');
assert.equal(blockerState.size, 0, 'terminal work releases the app-suspension blocker');
assert.ok(statusChanges.length >= 3, 'initial, running, and terminal status changes must be published');

runtime.stop();
console.log('Electron task activity runtime stays incremental on live tool events.');
