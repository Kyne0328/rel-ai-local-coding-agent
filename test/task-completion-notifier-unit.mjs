import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskActivityRuntime } = require('../electron/tool-sleep-blocker.js');

let listener = null;
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

const runtime = createTaskActivityRuntime({
  toolActivity: {
    onToolActivity(callback) {
      listener = callback;
      return () => { listener = null; };
    },
    getToolActivity() { return { activeConnectorCalls: 0 }; }
  },
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
  idleMs: 10000,
  isReady: () => true,
  onNotificationClick: () => { clicked += 1; },
  onStatusChange: status => statuses.push(structuredClone(status)),
  now: () => nowValue,
  setTimer(callback, delay) {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  },
  clearTimer(id) { timers.delete(id); }
});

listener({ phase: 'started', tool: 'relai_read', workspace: 'repo', activeConnectorCalls: 1 });
assert.equal(runtime.getStatus().state, 'working');
assert.equal(startedBlockers.size, 1);
listener({ phase: 'finished', tool: 'relai_read', workspace: 'repo', activeConnectorCalls: 0, ok: true });
assert.equal(runtime.getStatus().state, 'settling');
assert.equal(startedBlockers.size, 0);
assert.equal(timers.size, 1);

listener({ phase: 'started', tool: 'relai_edit', workspace: 'repo', activeConnectorCalls: 1 });
assert.equal(timers.size, 0, 'new activity cancels pending completion');
listener({ phase: 'finished', tool: 'relai_edit', workspace: 'repo', activeConnectorCalls: 0, ok: true });
nowValue = 16000;
const completion = [...timers.values()][0];
assert.equal(completion.delay, 10000);
timers.clear();
completion.callback();

const completed = runtime.getStatus();
assert.equal(completed.state, 'idle');
assert.equal(completed.lastTask.status, 'completed');
assert.equal(completed.lastTask.calls, 2);
assert.equal(completed.lastTask.workspace, 'repo');
assert.equal(completed.lastTask.durationMs, 15000);
assert.equal(notifications.length, 1);
assert.equal(notifications[0].options.title, 'Rel.AI task completed');
assert.match(notifications[0].options.body, /2 tool calls in repo/);
notifications[0].click();
assert.equal(clicked, 1);

listener({ phase: 'started', tool: 'relai_run_checks', workspace: 'repo', activeConnectorCalls: 1 });
listener({ phase: 'finished', tool: 'relai_run_checks', workspace: 'repo', activeConnectorCalls: 0, ok: false });
nowValue = 30000;
const failedCompletion = [...timers.values()][0];
timers.clear();
failedCompletion.callback();
assert.equal(runtime.getStatus().lastTask.status, 'attention');
assert.equal(runtime.getStatus().lastTask.failures, 1);
assert.equal(notifications[1].options.title, 'Rel.AI task needs attention');

runtime.setNotificationsEnabled(false);
listener({ phase: 'started', tool: 'relai_diff', workspace: 'repo', activeConnectorCalls: 1 });
listener({ phase: 'finished', tool: 'relai_diff', workspace: 'repo', activeConnectorCalls: 0, ok: true });
nowValue = 45000;
const mutedCompletion = [...timers.values()][0];
timers.clear();
mutedCompletion.callback();
assert.equal(notifications.length, 2, 'muted completion must not notify');

assert.ok(statuses.some(status => status.state === 'working'));
assert.ok(statuses.some(status => status.state === 'settling'));
assert.ok(statuses.some(status => status.lastTask?.status === 'completed'));
runtime.stop();
assert.equal(listener, null);

console.log('Task activity runtime tests passed.');
