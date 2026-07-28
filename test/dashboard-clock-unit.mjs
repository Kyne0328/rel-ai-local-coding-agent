import assert from 'node:assert/strict';
import { createDashboardClock, elapsedAt, parseClockTime } from '../src/ui/clock.js';

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
  querySelectorAll() { return this.nodes; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
  emit(name) { this.listeners.get(name)?.(); }
}

assert.equal(parseClockTime('2026-07-28T10:00:00.000Z'), Date.parse('2026-07-28T10:00:00.000Z'));
assert.equal(elapsedAt('2026-07-28T10:00:00.000Z', '', Date.parse('2026-07-28T10:01:05.000Z')), '1m 5s');
assert.equal(elapsedAt(1000, 2500, 5000), '2s');

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

now = Date.parse('2026-07-28T10:01:10.000Z');
[...timers.values()][0].callback();
assert.equal(elapsedNode.textContent, '1m 10s');
assert.equal(relativeNode.textContent, '2m ago');
assert.equal(completedNode.textContent, '30s', 'completed durations must remain anchored to completion time');

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
