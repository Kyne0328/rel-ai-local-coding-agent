import assert from 'node:assert/strict';
import { createDashboardClock, elapsedAt, parseClockTime } from '../src/ui/clock.js';
import { formatDuration } from '../src/ui/utils.js';

class FakeNode {
  constructor(attributes = {}) {
    this.attributes = new Map(Object.entries(attributes));
    this.textContent = '';
  }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

class FakeDocument {
  constructor(nodes) {
    this.nodes = nodes;
    this.visibilityState = 'visible';
    this.listeners = new Map();
  }
  querySelectorAll() { this.queryCount = (this.queryCount || 0) + 1; return this.nodes; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
  emit(name) { this.listeners.get(name)?.(); }
}

assert.equal(parseClockTime('2026-07-28T10:00:00.000Z'), Date.parse('2026-07-28T10:00:00.000Z'));
assert.equal(elapsedAt('2026-07-28T10:00:00.000Z', '', Date.parse('2026-07-28T10:01:05.000Z')), '1m 5s');
assert.equal(elapsedAt(1000, 2500, 5000), '2s');
assert.equal(formatDuration((6 * 60 * 60 + 40 * 60 + 30) * 1000), '6h 40m', 'completed durations must use compact hour/minute formatting');
assert.equal(formatDuration(45_000, { historical: true }), '<1m', 'historical durations under one minute must not show seconds');
assert.equal(formatDuration((2 * 60 * 60 + 1 * 60 + 1) * 1000, { historical: true }), '2h 1m', 'historical durations must omit seconds');
assert.equal(formatDuration((66 * 60 * 60 + 25 * 60 + 53) * 1000, { historical: true }), '2d 18h 25m', 'historical durations must use days instead of unbounded hours');
assert.equal(elapsedAt(0, '', (1 * 60 * 60 + 2 * 60 + 3) * 1000), '1h 2m 3s', 'live elapsed durations keep seconds');
const sessionsUi = await import('../src/ui/features/sessions/index.js');
assert.equal(typeof sessionsUi.isOngoingSession, 'function', 'Sessions must expose its live-state predicate for regression coverage');
assert.equal(sessionsUi.isOngoingSession({ status: 'inactive' }), false, 'inactive history must not use the live seconds clock');
assert.equal(sessionsUi.isOngoingSession({ status: 'validation_failed' }), false, 'validation-failed history must not use the live seconds clock');
assert.equal(sessionsUi.isOngoingSession({ status: 'running' }), true, 'active running sessions must keep the live seconds clock');

let now = Date.parse('2026-07-28T10:00:05.000Z');
let nextTimer = 0;
const timers = new Map();
const cleared = [];
const elapsedNode = new FakeNode({ 'data-clock-elapsed-start': '2026-07-28T10:00:00.000Z' });
const relativeNode = new FakeNode({ 'data-clock-relative': '2026-07-28T09:59:00.000Z' });
const completedNode = new FakeNode({
  'data-clock-elapsed-start': '2026-07-28T09:00:00.000Z',
  'data-clock-elapsed-end': '2026-07-28T09:00:30.000Z'
});
const documentRef = new FakeDocument([elapsedNode, relativeNode, completedNode]);
let ticks = 0;
const clock = createDashboardClock({
  documentRef,
  windowRef: {},
  now: () => now,
  setIntervalFn(callback, delay) {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  },
  clearIntervalFn(id) {
    cleared.push(id);
    timers.delete(id);
  },
  onTick() { ticks += 1; }
});

clock.start();
assert.equal(clock.isRunning(), true);
assert.equal(timers.size, 1, 'one shared interval must serve all time-sensitive nodes');
assert.equal([...timers.values()][0].delay, 1000);
assert.equal(elapsedNode.textContent, '5s');
assert.equal(relativeNode.textContent, '1m ago');
assert.equal(completedNode.textContent, '30s');
const queriesAfterStart = documentRef.queryCount;

now = Date.parse('2026-07-28T10:01:10.000Z');
[...timers.values()][0].callback();
assert.equal(elapsedNode.textContent, '1m 10s');
assert.equal(relativeNode.textContent, '2m ago');
assert.equal(completedNode.textContent, '30s', 'completed durations must remain anchored to completion time');
assert.equal(documentRef.queryCount, queriesAfterStart, 'clock ticks must not rescan the whole document');

const ticksBeforeHidden = ticks;
documentRef.visibilityState = 'hidden';
documentRef.emit('visibilitychange');
assert.equal(clock.isRunning(), false);
assert.equal(timers.size, 0);
assert.equal(cleared.length, 1);

now = Date.parse('2026-07-28T10:02:10.000Z');
documentRef.visibilityState = 'visible';
documentRef.emit('visibilitychange');
assert.equal(clock.isRunning(), true);
assert.equal(elapsedNode.textContent, '2m 10s', 'resume must recompute from timestamps instead of increment counters');
assert.ok(ticks > ticksBeforeHidden);
assert.equal(timers.size, 1);

clock.stop();
assert.equal(clock.isRunning(), false);
assert.equal(timers.size, 0);
assert.equal(documentRef.listeners.has('visibilitychange'), false);

console.log('Shared dashboard clock updates elapsed and relative time without backend events.');
