import assert from 'node:assert/strict';
import { applyLiveEvent, get, init, patchLocalConnection } from '../src/ui/store.js';

init({
  ok: true,
  tasks: [],
  managedProcesses: [],
  config: { workspaces: [{ alias: 'app', operational: null }] },
  live: { streamId: 'stream-a', revisions: { task: 1, connection: 1, workspace: 1, process: 1 } }
});

assert.equal(applyLiveEvent('task.updated', {
  streamId: 'stream-a', revision: 2,
  taskActivity: { state: 'working', activeTaskCount: 1, tasks: [{ id: 'task-1', workspace: 'app', state: 'working' }] },
  taskUpdates: [{ id: 'task-1', workspace: 'app', updatedAt: '2026-08-15T00:00:00.000Z' }],
  activityEntries: [{ eventId: 'event-1', ts: '2026-08-15T00:00:00.000Z', message: 'Started' }]
}).accepted, true);
assert.equal(get().tasks[0].id, 'task-1');
assert.equal(get().auditTail.entries[0].eventId, 'event-1');
assert.equal(get().workspaceStates.app.currentActivity.taskId, 'task-1');
assert.equal(get().live.revisions.task, 2);

assert.equal(applyLiveEvent('task.updated', {
  streamId: 'stream-a', revision: 2, tasks: [{ id: 'stale' }]
}).accepted, false, 'duplicate domain revisions are idempotent');
assert.equal(get().tasks[0].id, 'task-1');

assert.equal(applyLiveEvent('connection.updated', {
  streamId: 'stream-a', revision: 3, connectionState: { status: 'ready' }
}).accepted, true);
assert.equal(get().connectionState.status, 'ready');
assert.equal(get().live.revisions.connection, 3);
assert.equal(get().live.revisions.task, 2, 'domain revisions advance independently');

assert.equal(applyLiveEvent('workspace.updated', {
  streamId: 'stream-a', revision: 2, alias: 'app', state: { status: 'dirty' }
}).accepted, true);
assert.equal(get().workspaceStates.app.status, 'dirty');
assert.equal(get().config.workspaces[0].operational.status, 'dirty');

assert.equal(applyLiveEvent('process.updated', {
  streamId: 'stream-a', revision: 4, managedProcesses: [{ processId: 'proc-1' }]
}).accepted, true);
assert.equal(get().managedProcesses[0].processId, 'proc-1');

assert.equal(applyLiveEvent('task.updated', {
  streamId: 'stream-b', revision: 99, tasks: [{ id: 'wrong-stream' }]
}).accepted, false, 'events from a different live stream must not mutate the current store');

patchLocalConnection({ desktopStatus: { serverRunning: true }, connectionState: { status: 'ready' } });
assert.equal(get().tasks[0].id, 'task-1', 'desktop-only state patches must not replace task state');

init({
  ok: true,
  tasks: [{ id: 'refresh-2' }],
  live: { streamId: 'stream-b', revisions: { task: 5, connection: 2, workspace: 1, process: 0, diagnostics: 3 } }
});
assert.equal(get().tasks[0].id, 'refresh-2', 'an authoritative aggregate refresh establishes the new stream atomically');
assert.equal(get().live.streamId, 'stream-b');
assert.equal(get().live.revisions.task, 5);
assert.equal(get().live.revisions.diagnostics, 3);

console.log('Dashboard typed domain revisions reject stale and cross-stream deltas.');
