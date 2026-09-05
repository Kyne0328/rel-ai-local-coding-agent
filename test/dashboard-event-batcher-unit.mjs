import assert from 'node:assert/strict';

import { createDashboardTaskEventBatcher } from '../src/http/dashboardEventBatcher.js';

const scheduled = [];
const cleared = [];
const batches = [];
const batcher = createDashboardTaskEventBatcher({
  setTimer(callback) {
    const timer = { callback, unref() {} };
    scheduled.push(timer);
    return timer;
  },
  clearTimer(timer) { cleared.push(timer); },
  onFlush(batch) { batches.push(batch); }
});

batcher.push({ taskId: 'task-a', phase: 'update', revision: 1, currentActivity: 'First' });
batcher.push({ taskId: 'task-a', phase: 'update', revision: 2, currentActivity: 'Latest' });

assert.equal(scheduled.length, 1, 'a pending batch must use one flush timer');
assert.equal(batcher.pendingCount(), 1, 'same-task same-phase updates must coalesce');

scheduled[0].callback();
assert.equal(batches.length, 1);
assert.equal(batches[0].revision, 2, 'a coalesced batch must publish the newest revision');
assert.deepEqual(batches[0].activities, [
  { taskId: 'task-a', phase: 'update', revision: 2, currentActivity: 'Latest' }
]);

batcher.push({ taskId: 'task-a', phase: 'update', revision: 3, activityEvent: { eventId: 'event-1' } });
batcher.push({ taskId: 'task-a', phase: 'update', revision: 4, activityEvent: { eventId: 'event-2' } });
assert.equal(batcher.pendingCount(), 2, 'distinct activity events must not overwrite each other');
assert.equal(batcher.flush(), true);
assert.equal(batches.at(-1).revision, 4);
assert.deepEqual(batches.at(-1).activities.map(item => item.activityEvent.eventId), ['event-1', 'event-2']);

batcher.push({ taskId: 'task-b', phase: 'update', revision: 5 });
assert.equal(batcher.pendingCount(), 1);
batcher.close();
assert.equal(batcher.pendingCount(), 0, 'closing the batcher must discard pending work');
assert.ok(cleared.length >= 1, 'closing or flushing must clear the active timer');

console.log('Dashboard task-event batching coalesces replaceable progress while preserving distinct events.');
