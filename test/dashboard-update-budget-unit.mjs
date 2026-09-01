import assert from 'node:assert/strict';

import { createDashboardTaskEventBatcher } from '../src/http/dashboardEventBatcher.js';
import { createDashboardClock } from '../src/ui/clock.js';

let scheduledFlush = null;
let timerCount = 0;
let flushCount = 0;
let flushedBatch = null;
const batcher = createDashboardTaskEventBatcher({
  setTimer(callback) {
    timerCount += 1;
    scheduledFlush = callback;
    return { unref() {} };
  },
  clearTimer() {},
  onFlush(batch) {
    flushCount += 1;
    flushedBatch = batch;
  }
});
for (let revision = 1; revision <= 100; revision += 1) {
  batcher.push({ taskId: 'task-budget', phase: 'update', revision, currentActivity: `Progress ${revision}` });
}
assert.equal(timerCount, 1, '100 same-phase progress updates must schedule one dashboard flush');
assert.equal(batcher.pendingCount(), 1, 'same-task progress updates must coalesce to one pending projection');
scheduledFlush();
assert.equal(flushCount, 1, 'the coalesced progress burst must publish one dashboard batch');
assert.equal(flushedBatch.activities.length, 1);
assert.equal(flushedBatch.revision, 100);
batcher.close();

class ClockNode {
  constructor(attributes) {
    this.attributes = new Map(Object.entries(attributes));
    this._textContent = '';
    this.isConnected = true;
    this.updates = 0;
  }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get textContent() { return this._textContent; }
  set textContent(value) {
    const next = String(value);
    if (next === this._textContent) return;
    this._textContent = next;
    this.updates += 1;
  }
}

const startedAt = Date.parse('2026-08-08T12:00:00.000Z');
let currentTime = startedAt;
const liveNodes = [
  new ClockNode({ 'data-clock-elapsed-start': String(startedAt) }),
  new ClockNode({ 'data-clock-elapsed-start': String(startedAt - 30_000) })
];
const historicalNodes = Array.from({ length: 50 }, (_, index) => new ClockNode({
  'data-clock-relative': new Date(startedAt - (index + 1) * 60_000).toISOString()
}));
const nodes = [...liveNodes, ...historicalNodes];
let documentQueries = 0;
const documentRef = {
  visibilityState: 'visible',
  querySelectorAll() { documentQueries += 1; return nodes; },
  addEventListener() {},
  removeEventListener() {}
};
const clock = createDashboardClock({
  documentRef,
  windowRef: {},
  now: () => currentTime,
  setIntervalFn: () => 1,
  clearIntervalFn: () => {}
});
clock.start();
const queriesAfterStart = documentQueries;
const liveUpdatesAfterStart = liveNodes.reduce((sum, node) => sum + node.updates, 0);
for (let second = 0; second < 60; second += 1) {
  currentTime += 1000;
  clock.tick();
}
const liveTickUpdates = liveNodes.reduce((sum, node) => sum + node.updates, 0) - liveUpdatesAfterStart;
assert.equal(documentQueries, queriesAfterStart,
  '60 clock ticks must update registered nodes without re-querying the document');
assert.ok(liveTickUpdates <= 120,
  `two live durations over 60 ticks must perform at most 120 node updates, got ${liveTickUpdates}`);
clock.stop();

console.log('Lightweight dashboard update budgets passed: progress coalescing and clock ticks stay incremental.');
