import assert from 'node:assert/strict';

import { createToolActivityTracker } from '../src/toolActivity.js';

const tracker = createToolActivityTracker({ idleMs: 60_000 });
const events = [];
tracker.onToolActivity(event => events.push(event));

const start = tracker.beginConnectorToolCall({
  tool: 'relai_work', internalOperation: 'work.begin',
  workspace: 'repo',
  scopeId: 'lifecycle-activity',
  createTask: true,
  objective: 'Add compact task lifecycle events'
});
const taskId = start.taskId;
start.update({ operation: 'Inspecting lifecycle state' });
start();

assert.ok(events.length >= 3);
assert.equal(events.every(event => !Object.hasOwn(event, 'tasks')), true, 'activity notifications must not rematerialize the full task list');
assert.equal(events.every(event => Array.isArray(event.changedFields)), true);
assert.equal(events.every(event => event.revision > 0), true);
assert.equal(events.some(event => event.taskId === taskId && event.changedFields.includes('operation')), true);

const snapshot = tracker.getToolActivity();
assert.equal(snapshot.tasks.length, 1, 'explicit snapshot reads still materialize the full task projection');
assert.equal(snapshot.tasks[0].id, taskId);
assert.equal(snapshot.tasks[0].intent, 'feature');

tracker.reset();
console.log('Task activity notifications use compact lifecycle deltas while snapshot reads remain complete.');
