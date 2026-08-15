import assert from 'node:assert/strict';

import { createTaskActivityRuntime } from '../electron/tool-sleep-blocker.js';

let snapshotReads = 0;
let listener = null;
const statusChanges = [];
const blockerState = new Set();
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
    start() { const id = nextBlockerId++; blockerState.add(id); return id; },
    stop(id) { blockerState.delete(id); return true; },
    isStarted(id) { return blockerState.has(id); }
  },
  onStatusChange: status => statusChanges.push(status)
});

assert.equal(snapshotReads, 1, 'runtime initialization may read one authoritative snapshot');
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
assert.equal(blockerState.size, 1, 'active work keeps the display awake');

listener({
  phase: 'completed', revision: 2, activeConnectorCalls: 0, activeCalls: 0, activeTaskCount: 0,
  taskId: 'task-a', task: { ...task, status: 'completed', state: 'ended', activeCalls: 0, completionKnown: true, summary: 'Done.' }
});
assert.equal(snapshotReads, 1, 'terminal activity must remain event-driven');
assert.equal(runtime.getStatus().activeTaskCount, 0);
assert.equal(runtime.getStatus().tasks.length, 0);
assert.equal(runtime.getStatus().lastTask?.taskId, 'task-a');
assert.equal(blockerState.size, 0, 'terminal work releases the display sleep blocker');
assert.ok(statusChanges.length >= 3, 'initial, running, and terminal status changes must be published');

runtime.stop();
console.log('Electron task activity runtime stays incremental on live tool events.');
