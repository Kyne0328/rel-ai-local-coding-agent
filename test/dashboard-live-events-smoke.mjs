import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as dashboardSessions from '../src/http/dashboardSessions.js';
import { beginConnectorToolCall, resetToolActivity } from '../src/toolActivity.js';
import { resetTaskHistoryCaches } from '../src/taskHistoryStorage.js';
import { mcpConnectionManager } from '../src/mcp/connectionManager.js';

const dashboardSource = fs.readFileSync(new URL('../src/http/dashboard.js', import.meta.url), 'utf8');
const eventClientSource = fs.readFileSync(new URL('../src/ui/events.js', import.meta.url), 'utf8');
const dashboardClientSource = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');

assert.match(dashboardSource, /: keepalive/, 'dashboard SSE must include a heartbeat');
for (const eventName of ['dashboard.bootstrap', 'task.updated', 'connection.updated', 'workspace.updated', 'process.updated']) {
  assert.match(dashboardSource, new RegExp(eventName.replace('.', '\\.')), `server must emit ${eventName}`);
  assert.match(eventClientSource, new RegExp(eventName.replace('.', '\\.')), `client must subscribe to ${eventName}`);
}
assert.doesNotMatch(dashboardSource, /sendSse\(res, ['"]dashboard['"]/, 'legacy broad dashboard SSE events must be deleted');
assert.match(dashboardSource, /createDashboardTaskEventBatcher/, 'production task updates must be coalesced before SSE publication');
assert.doesNotMatch(dashboardSource, /DASHBOARD_SNAPSHOT_MAX_WAIT_MS|dashboardStreamPayload|requestedDashboardRevision/);
assert.doesNotMatch(eventClientSource, /_snapshotRevision|params\.set\(['"]revision['"]/, 'client must not request legacy snapshot catch-up');
assert.match(eventClientSource, /removeEventListener/, 'SSE listeners must be removed when a source closes');
assert.match(eventClientSource, /function parseEventData[\s\S]*try[\s\S]*JSON\.parse[\s\S]*catch/, 'SSE payload parsing must fail safely');
assert.match(dashboardClientSource, /applyLiveEvent\(event\.type, event\.data\)/, 'browser coordinator must apply typed deltas through the canonical store');
assert.match(dashboardClientSource, /function viewRevisionKey/, 'route invalidation must use explicit revision keys');
assert.doesNotMatch(dashboardClientSource, /viewFingerprint|createSnapshotGate|snapshot-order/, 'legacy snapshot ordering/fingerprinting must be removed');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-events-'));
const previousConfigPath = process.env.REL_AI_MCP_CONFIG;
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const configPath = path.join(sandbox, 'config.json');
const auditPath = path.join(sandbox, 'audit.jsonl');
const token = 'dashboard-live-events-token';
let desktopStatus = {
  serverRunning: true,
  tunnelStatus: 'connecting',
  mcpUrl: '',
  error: '',
  localUrl: 'http://127.0.0.1:3333'
};

fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir: sandbox,
  auditLogPath: auditPath,
  toolMode: 'chatgpt_local_repo',
  trustedLocalAgent: true,
  workspaces: {},
  productUx: { staleHours: 24, cleanupOlderThanHours: 168, enableStateExport: true }
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = sandbox;

const { startHttpServer } = await import('../src/httpServer.js');
const server = startHttpServer({
  host: '127.0.0.1', port: 0, token, exitOnError: false,
  getDesktopStatus: () => desktopStatus
});
const controller = new AbortController();
let responseReader;

try {
  await waitForListening(server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const bootstrapToken = dashboardSessions.createDashboardBootstrap(token);
  const dashboardResponse = await fetch(`http://127.0.0.1:${address.port}/dashboard?surface=desktop&bootstrap=${encodeURIComponent(bootstrapToken)}`);
  assert.equal(dashboardResponse.status, 200);
  const dashboardCookie = String(dashboardResponse.headers.get('set-cookie') || '').split(';')[0];
  assert.match(dashboardCookie, /^relai_dashboard_session=/);
  const html = await dashboardResponse.text();
  assert.match(html, /id="initialDashboardData"/, 'HTML bootstrap remains available before SSE connects');

  const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
    headers: { cookie: dashboardCookie }, signal: controller.signal
  });
  assert.equal(response.status, 200);
  responseReader = response.body.getReader();
  const stream = createEventReader(responseReader);

  const ready = await stream.nextType('ready');
  assert.equal(JSON.parse(ready.data).ok, true);
  const bootstrapEvent = await stream.nextType('dashboard.bootstrap');
  const bootstrap = JSON.parse(bootstrapEvent.data);
  assert.equal(bootstrap.ok, true);
  assert.ok(bootstrap.streamId);
  assert.deepEqual(Object.keys(bootstrap.live.revisions).sort(), ['connection', 'process', 'task', 'workspace']);
  assert.ok(Array.isArray(bootstrap.tasks));
  assert.ok(Array.isArray(bootstrap.managedProcesses));

  fs.appendFileSync(auditPath, `${JSON.stringify({ ts: new Date().toISOString(), event: 'tool_call', tool: 'relai_read', workspace: 'test', ok: true })}\n`);
  const finishStart = beginConnectorToolCall({
    scopeId: 'dashboard-live-events-test', tool: 'relai_begin_work',
    operation: 'Starting dashboard test task', workspace: 'test', createTask: true,
    objective: 'Exercise typed dashboard events'
  });
  const taskId = finishStart.taskId;
  finishStart({ ok: true });

  const taskEvent = JSON.parse((await stream.nextType('task.updated')).data);
  assert.equal(taskEvent.domain, 'task');
  assert.ok(taskEvent.revision > bootstrap.live.revisions.task);
  assert.ok(taskEvent.taskUpdates.some(task => task.id === taskId));
  assert.ok(Array.isArray(taskEvent.activityEntries), 'task delta must carry only changed activity entries');
  assert.equal(Object.hasOwn(taskEvent, 'release'), false, 'task delta must not rebuild unrelated release state');
  assert.equal(Object.hasOwn(taskEvent, 'tools'), false, 'task delta must not rebuild static tool data');
  assert.equal(Object.hasOwn(taskEvent, 'managedProcesses'), false, 'task delta must not include process state');

  const requestId = mcpConnectionManager.beginRequest({
    principal: 'dashboard-live-events-client', method: 'tools/list', authMode: 'static_bearer'
  });
  const connectionEvent = JSON.parse((await stream.nextType('connection.updated')).data);
  assert.equal(connectionEvent.domain, 'connection');
  assert.equal(connectionEvent.mcpConnection.activeRequestCount, 1);
  assert.equal(Object.hasOwn(connectionEvent, 'tasks'), false, 'connection delta must not include task history');
  mcpConnectionManager.finishRequest(requestId, { method: 'tools/list', ok: true });

  desktopStatus = { ...desktopStatus, tunnelStatus: 'running', tunnelId: 'tunnel_12345678' };
  const finishStatus = beginConnectorToolCall({ scopeId: 'dashboard-status', taskId, tool: 'relai_status', operation: 'Status', workspace: 'test' });
  finishStatus({ ok: true });
  let desktopConnection = null;
  for (let attempt = 0; attempt < 4 && desktopConnection?.desktopStatus?.tunnelStatus !== 'running'; attempt += 1) {
    desktopConnection = JSON.parse((await stream.nextType('connection.updated')).data);
  }
  assert.equal(desktopConnection?.desktopStatus?.tunnelStatus, 'running');

  const secondController = new AbortController();
  let secondReader;
  try {
    const reconnect = await fetch(`http://127.0.0.1:${address.port}/events`, {
      headers: { cookie: dashboardCookie }, signal: secondController.signal
    });
    secondReader = reconnect.body.getReader();
    const secondStream = createEventReader(secondReader);
    await secondStream.nextType('ready');
    const reconnectBootstrap = JSON.parse((await secondStream.nextType('dashboard.bootstrap')).data);
    assert.equal(reconnectBootstrap.streamId, bootstrap.streamId, 'reconnect uses the current server event stream');
    assert.ok(reconnectBootstrap.tasks.some(task => task.id === taskId), 'reconnect gets a fresh authoritative bootstrap');
  } finally {
    secondController.abort();
    await secondReader?.cancel().catch(() => {});
  }
} finally {
  controller.abort();
  await responseReader?.cancel().catch(() => {});
  resetToolActivity();
  resetTaskHistoryCaches();
  server.closeAllConnections?.();
  await closeServer(server);
  if (previousConfigPath == null) delete process.env.REL_AI_MCP_CONFIG; else process.env.REL_AI_MCP_CONFIG = previousConfigPath;
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR; else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Dashboard typed live events and reconnect bootstrap passed.');

function createEventReader(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async nextType(type, timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const event = await nextEvent(deadline - Date.now());
        if (event.event === type) return event;
      }
      throw new Error(`Timed out waiting for ${type}.`);
    }
  };
  async function nextEvent(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const eventLine = block.split('\n').find(line => line.startsWith('event:')) || '';
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        return { event: eventLine.slice(6).trim(), data };
      }
      const result = await Promise.race([reader.read(), delayReject(deadline - Date.now())]);
      if (result.done) throw new Error('Dashboard SSE stream closed unexpectedly.');
      buffer += decoder.decode(result.value, { stream: true }).replaceAll('\r\n', '\n');
    }
    throw new Error('Timed out waiting for dashboard event.');
  }
}

function delayReject(ms) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for dashboard SSE event.')), Math.max(1, ms));
    timer.unref?.();
  });
}
function waitForListening(target) {
  if (target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => { target.once('listening', resolve); target.once('error', reject); });
}
function closeServer(target) {
  return new Promise(resolve => { if (!target?.listening) return resolve(); target.close(resolve); });
}
