import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  beginConnectorToolCall,
  onToolActivity,
  getToolActivity
} = require('../src/toolActivity.js');
const { createToolSleepBlocker, createTaskActivityRuntime } = require('../electron/tool-sleep-blocker.js');

const events = [];
const unsubscribe = onToolActivity(event => events.push(event));

const finishRead = beginConnectorToolCall({ tool: 'relai_read', workspace: 'repo' });
const finishChecks = beginConnectorToolCall({ tool: 'relai_run_checks', workspace: 'repo' });
assert.equal(getToolActivity().activeConnectorCalls, 2);

finishRead();
assert.equal(getToolActivity().activeConnectorCalls, 1);
finishRead();
assert.equal(getToolActivity().activeConnectorCalls, 1, 'finishing a call twice must be harmless');
finishChecks();
assert.equal(getToolActivity().activeConnectorCalls, 0);
unsubscribe();

assert.deepEqual(events.map(event => [event.phase, event.activeConnectorCalls]), [
  ['started', 1],
  ['started', 2],
  ['finished', 1],
  ['finished', 0]
]);

let nextId = 40;
const started = new Set();
const calls = [];
const fakePowerSaveBlocker = {
  start(type) {
    calls.push(['start', type]);
    const id = nextId++;
    started.add(id);
    return id;
  },
  stop(id) {
    calls.push(['stop', id]);
    return started.delete(id);
  },
  isStarted(id) {
    return started.has(id);
  }
};

const blocker = createToolSleepBlocker(fakePowerSaveBlocker);
blocker.update(1);
blocker.update(2);
assert.equal(blocker.isActive(), true);
assert.deepEqual(calls, [['start', 'prevent-app-suspension']], 'concurrent calls must share one blocker');
blocker.update(1);
assert.equal(blocker.isActive(), true);
blocker.update(0);
assert.equal(blocker.isActive(), false);
assert.deepEqual(calls, [
  ['start', 'prevent-app-suspension'],
  ['stop', 40]
]);
assert.equal(blocker.stop(), false, 'stopping an inactive blocker must be harmless');

let boundListener = null;
let unsubscribed = false;
const runtime = createTaskActivityRuntime({
  toolActivity: {
    onToolActivity(listener) {
      boundListener = listener;
      return () => { unsubscribed = true; };
    },
    getToolActivity() { return { activeConnectorCalls: 0 }; }
  },
  powerSaveBlocker: fakePowerSaveBlocker,
  Notification: class { static isSupported() { return false; } },
  isReady: () => true
});
runtime.setNotificationsEnabled(false);
boundListener({ phase: 'started', activeConnectorCalls: 1 });
assert.equal(started.has(41), true);
boundListener({ phase: 'finished', activeConnectorCalls: 0, ok: true });
assert.equal(started.has(41), false);
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
  const { callTool } = require('../src/tools.js');
  const callEvents = [];
  const stopListening = onToolActivity(event => callEvents.push(event));

  await callTool('relai_status', {}, { publicHttpOnly: true });
  assert.deepEqual(callEvents.map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_status', 1],
    ['finished', 'relai_status', 0]
  ]);

  callEvents.length = 0;
  await callTool('relai_status', {}, { publicHttpOnly: false });
  assert.deepEqual(callEvents, [], 'stdio/local calls must not prevent system sleep');

  await assert.rejects(
    () => callTool('relai_read', {}, { publicHttpOnly: true }),
    /Workspace alias is required|Unknown workspace|workspace/i
  );
  assert.deepEqual(callEvents.map(event => [event.phase, event.tool, event.activeConnectorCalls]), [
    ['started', 'relai_read', 1],
    ['finished', 'relai_read', 0]
  ], 'failed connector calls must always release the activity count');
  stopListening();
} finally {
  if (previousConfig == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Tool activity and sleep blocker unit tests passed.');
