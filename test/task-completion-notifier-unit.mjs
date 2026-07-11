import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createToolActivityTracker } = require('../src/toolActivity.js');
const { createTaskActivityRuntime } = require('../electron/tool-sleep-blocker.js');

let nowValue = 1000;
let timerId = 0;
const timers = new Map();
const notifications = [];
const statuses = [];
let clicked = 0;
const startedBlockers = new Set();
let nextBlocker = 1;

class FakeNotification {
  static isSupported() { return true; }
  constructor(options) {
    this.options = options;
    this.listeners = new Map();
    notifications.push(this);
  }
  on(name, callback) { this.listeners.set(name, callback); }
  show() { this.shown = true; }
  click() { this.listeners.get('click')?.(); }
}

const tracker = createToolActivityTracker({
  idleMs: 60_000,
  now: () => nowValue,
  setTimer(callback, delay) {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimer(id) { timers.delete(id); }
});
const runtime = createTaskActivityRuntime({
  toolActivity: tracker,
  powerSaveBlocker: {
    start(type) {
      assert.equal(type, 'prevent-app-suspension');
      const id = nextBlocker++;
      startedBlockers.add(id);
      return id;
    },
    isStarted(id) { return startedBlockers.has(id); },
    stop(id) { return startedBlockers.delete(id); }
  },
  Notification: FakeNotification,
  isReady: () => true,
  onNotificationClick: () => { clicked += 1; },
  onStatusChange: status => statuses.push(structuredClone(status))
});

const finishRead = tracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'conversation-a' });
const finishOther = tracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'other', scopeId: 'conversation-b' });
assert.equal(runtime.getStatus().state, 'working');
assert.equal(runtime.getStatus().activeTaskCount, 2);
assert.equal(runtime.getStatus().activeCalls, 2);
assert.equal(startedBlockers.size, 1);
finishRead();
finishOther();
assert.equal(runtime.getStatus().state, 'settling');
assert.equal(runtime.getStatus().activeTaskCount, 2);
assert.equal(startedBlockers.size, 0);
assert.equal(notifications.length, 0, 'tasks must not notify before the idle lease expires');

nowValue = 30_000;
const finishEdit = tracker.beginConnectorToolCall({ tool: 'relai_edit', workspace: 'repo', scopeId: 'conversation-a' });
assert.equal(finishEdit.taskId, finishRead.taskId);
finishEdit();
assert.equal([...timers.values()].every(timer => timer.delay === 60_000), true);

nowValue = 91_000;
for (const [id, timer] of [...timers]) {
  timers.delete(id);
  timer.callback();
}
const completed = runtime.getStatus();
assert.equal(completed.state, 'idle');
assert.equal(completed.activeTaskCount, 0);
assert.equal(notifications.length, 2);
const repoNotification = notifications.find(item => /repo/.test(item.options.body));
assert.match(repoNotification.options.body, /2 tool calls in repo/);
repoNotification.click();
assert.equal(clicked, 1);

const finishFailed = tracker.beginConnectorToolCall({ tool: 'relai_run_checks', workspace: 'repo', scopeId: 'conversation-c' });
finishFailed({ ok: false });
nowValue = 152_000;
for (const [id, timer] of [...timers]) {
  timers.delete(id);
  timer.callback();
}
assert.equal(runtime.getStatus().lastTask.status, 'attention');
assert.equal(runtime.getStatus().lastTask.failures, 1);
assert.equal(notifications.at(-1).options.title, 'Rel.AI task needs attention');

runtime.setNotificationsEnabled(false);
const finishMuted = tracker.beginConnectorToolCall({ tool: 'relai_diff', workspace: 'repo', scopeId: 'conversation-d' });
finishMuted();
nowValue = 213_000;
for (const [id, timer] of [...timers]) {
  timers.delete(id);
  timer.callback();
}
assert.equal(notifications.length, 3, 'muted completion must not notify');

assert.ok(statuses.some(status => status.activeTaskCount === 2 && status.activeCalls === 2));
assert.ok(statuses.some(status => status.state === 'settling'));
assert.ok(statuses.some(status => status.lastTask?.status === 'completed'));
runtime.stop();

console.log('Concurrent task completion and notification tests passed.');
