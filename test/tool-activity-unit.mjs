import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createToolActivityTracker,
  onToolActivity,
  resetToolActivity
} = require('../src/toolActivity.js');
const { createToolSleepBlocker, createTaskActivityRuntime } = require('../electron/tool-sleep-blocker.js');

let nowValue = 1000;
let timerId = 0;
const timers = new Map();
const trackerEvents = [];
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
tracker.onToolActivity(event => trackerEvents.push(event));

const finishRead = tracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'conversation-a', operation: 'Reading src/app.js' });
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.operation, 'Reading src/app.js');
finishRead.update({ operation: 'Reading src/config.js' });
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.operation, 'Reading src/config.js');
const finishChecks = tracker.beginConnectorToolCall({ tool: 'relai_run_checks', workspace: 'other', scopeId: 'conversation-b' });
assert.notEqual(finishRead.taskId, finishChecks.taskId, 'separate conversation scopes must create separate tasks');
assert.equal(tracker.getToolActivity().activeConnectorCalls, 2);
assert.equal(tracker.getToolActivity().activeTaskCount, 2);
finishRead();
finishChecks();
assert.equal(tracker.getToolActivity().state, 'waiting');
assert.equal(timers.size, 2);

nowValue = 30_000;
const finishEdit = tracker.beginConnectorToolCall({ tool: 'relai_edit', workspace: 'repo', scopeId: 'conversation-a' });
assert.equal(finishEdit.taskId, finishRead.taskId, 'follow-up calls before idle completion must stay in the same task');
assert.equal(tracker.getToolActivity().tasks.find(task => task.id === finishRead.taskId)?.calls, 2);
finishEdit();
assert.equal([...timers.values()].every(timer => timer.delay === 60_000), true);

nowValue = 91_000;
for (const { callback } of [...timers.values()]) callback();
timers.clear();
assert.equal(tracker.getToolActivity().state, 'idle');
const inactive = trackerEvents.filter(event => event.phase === 'inactive').map(event => event.task);
assert.equal(inactive.length, 2);
assert.equal(inactive.find(task => task.taskId === finishRead.taskId)?.calls, 2);
assert.equal(inactive.find(task => task.taskId === finishChecks.taskId)?.calls, 1);
assert.equal(inactive.every(task => task.status === 'inactive' && task.endReason === 'inactivity_window'), true);

const reconnectTracker = createToolActivityTracker({ idleMs: 60_000 });
const firstTransport = reconnectTracker.beginConnectorToolCall({ tool: 'relai_run_checks', workspace: 'repo', scopeId: 'mcp:transport:a' });
firstTransport();
const rotatedTransport = reconnectTracker.beginConnectorToolCall({ tool: 'relai_complete_task', workspace: 'repo', scopeId: 'mcp:transport:b' });
assert.equal(rotatedTransport.taskId, firstTransport.taskId, 'a single waiting workspace task must survive connector transport rotation');
rotatedTransport();
reconnectTracker.reset();

let fragmentedNow = 1000;
const fragmentedTracker = createToolActivityTracker({ idleMs: 60_000, now: () => fragmentedNow });
const fragmentedA = fragmentedTracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'mcp:transport:a' });
fragmentedNow = 2000;
const fragmentedB = fragmentedTracker.beginConnectorToolCall({ tool: 'relai_search', workspace: 'repo', scopeId: 'mcp:transport:b' });
assert.notEqual(fragmentedA.taskId, fragmentedB.taskId, 'overlapping connector calls may begin as separate weak transport tasks');
fragmentedNow = 3000;
fragmentedA();
fragmentedNow = 4000;
fragmentedB();
assert.equal(fragmentedTracker.getToolActivity().activeTaskCount, 2);
fragmentedNow = 5000;
const repaired = fragmentedTracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'mcp:transport:c' });
assert.equal(repaired.taskId, fragmentedB.taskId, 'the newest weak transport task must absorb fragmented waiting siblings');
assert.equal(fragmentedTracker.getToolActivity().activeTaskCount, 1, 'fragmented weak sessions must not permanently poison future grouping');
assert.equal(fragmentedTracker.getToolActivity().tasks[0].calls, 3);
repaired();
fragmentedTracker.reset();

const strongTracker = createToolActivityTracker({ idleMs: 60_000 });
const strongA = strongTracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'mcp:conversation:a' });
strongA();
const strongB = strongTracker.beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo', scopeId: 'mcp:conversation:b' });
assert.notEqual(strongA.taskId, strongB.taskId, 'different stable conversation scopes must remain separate');
strongB();
strongTracker.reset();

let nextId = 40;
const started = new Set();
const blockerCalls = [];
const fakePowerSaveBlocker = {
  start(type) {
    blockerCalls.push(['start', type]);
    const id = nextId++;
    started.add(id);
    return id;
  },
  stop(id) {
    blockerCalls.push(['stop', id]);
    return started.delete(id);
  },
  isStarted(id) { return started.has(id); }
};

const blocker = createToolSleepBlocker(fakePowerSaveBlocker);
blocker.update(1);
blocker.update(2);
assert.equal(blocker.isActive(), true);
assert.deepEqual(blockerCalls, [['start', 'prevent-app-suspension']], 'concurrent calls must share one blocker');
blocker.update(1);
assert.equal(blocker.isActive(), true);
blocker.update(0);
assert.equal(blocker.isActive(), false);
assert.deepEqual(blockerCalls, [['start', 'prevent-app-suspension'], ['stop', 40]]);

let boundListener = null;
let unsubscribed = false;
let runtimeStatus = { state: 'idle', activeConnectorCalls: 0, activeTaskCount: 0, tasks: [] };
const runtime = createTaskActivityRuntime({
  toolActivity: {
    onToolActivity(listener) {
      boundListener = listener;
      return () => { unsubscribed = true; };
    },
    getToolActivity() { return runtimeStatus; }
  },
  powerSaveBlocker: fakePowerSaveBlocker,
  Notification: class { static isSupported() { return false; } },
  isReady: () => true
});
runtime.setNotificationsEnabled(false);
runtimeStatus = { state: 'working', activeConnectorCalls: 1, activeTaskCount: 1, tasks: [{ id: 'task', state: 'working', activeCalls: 1 }] };
boundListener({ phase: 'started', activeConnectorCalls: 1 });
assert.equal(started.has(41), true);
runtimeStatus = { state: 'waiting', activeConnectorCalls: 0, activeTaskCount: 1, tasks: [{ id: 'task', state: 'waiting', activeCalls: 0 }] };
boundListener({ phase: 'finished', activeConnectorCalls: 0, ok: true });
assert.equal(started.has(41), false);
assert.equal(runtime.getStatus().activeTaskCount, 1);
runtime.stop();
assert.equal(unsubscribed, true);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tool-activity-'));
const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_CONFIG = path.join(sandbox, 'config.json');
fs.writeFileSync(process.env.REL_AI_MCP_CONFIG, JSON.stringify({
  stateDir: path.join(sandbox, 'state'),
  workspaces: {}
}, null, 2));

try {
  resetToolActivity();
  const { callTool } = require('../src/tools.js');
  const callEvents = [];
  const stopListening = onToolActivity(event => callEvents.push(event));

  await callTool('relai_status', {}, { publicHttpOnly: true, taskScopeId: 'http-session-a' });
  assert.deepEqual(callEvents.slice(0, 2).map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_status', 1],
    ['finished', 'relai_status', 0]
  ]);
  assert.equal(callEvents[0].taskId, callEvents[1].taskId);

  callEvents.length = 0;
  await callTool('relai_status', {}, { publicHttpOnly: false });
  assert.deepEqual(callEvents.map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_status', 0],
    ['finished', 'relai_status', 0]
  ], 'stdio/local calls must be grouped without activating the connector sleep blocker');
  assert.equal(callEvents[0].taskId, callEvents[1].taskId);

  callEvents.length = 0;
  await assert.rejects(
    () => callTool('relai_read', {}, { publicHttpOnly: true, taskScopeId: 'http-session-a' }),
    /Workspace alias is required|Unknown workspace|workspace/i
  );
  assert.deepEqual(callEvents.map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_read', 1],
    ['finished', 'relai_read', 0]
  ], 'failed connector calls must always release the activity count');
  stopListening();
  resetToolActivity();
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Concurrent tool activity, task grouping, and sleep blocker tests passed.');
