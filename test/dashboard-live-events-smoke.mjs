import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as dashboardSessions from '../src/http/dashboardSessions.js';
import { beginConnectorToolCall, getToolActivity, resetToolActivity } from '../src/toolActivity.js';
import { resetTaskHistoryCaches } from '../src/taskHistoryStorage.js';
import { mcpConnectionManager } from '../src/mcp/connectionManager.js';

const dashboardSource = fs.readFileSync(new URL('../src/http/dashboard.js', import.meta.url), 'utf8');
const eventClientSource = fs.readFileSync(new URL('../src/ui/events.js', import.meta.url), 'utf8');
const dashboardClientSource = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');

assert.match(dashboardSource, /: keepalive/, 'dashboard SSE must include a heartbeat');
for (const eventName of ['task.updated', 'connection.updated', 'workspace.updated', 'process.updated', 'diagnostics.updated', 'dashboard.error']) {
  assert.match(dashboardSource, new RegExp(eventName.replace('.', '\\.')), `server must emit ${eventName}`);
  assert.match(eventClientSource, new RegExp(eventName.replace('.', '\\.')), `client must subscribe to ${eventName}`);
}
assert.doesNotMatch(dashboardSource, /dashboard\.bootstrap/, 'SSE must not rebuild the aggregate dashboard snapshot after HTML bootstrap');
assert.doesNotMatch(eventClientSource, /dashboard\.bootstrap/, 'client must not subscribe to the deleted duplicate bootstrap event');
assert.doesNotMatch(dashboardSource, /sendSse\(res, ['"]dashboard['"]/, 'legacy broad dashboard SSE events must be deleted');
assert.match(dashboardSource, /createDashboardTaskEventBatcher/, 'production task updates must be coalesced before SSE publication');
assert.doesNotMatch(dashboardSource, /DASHBOARD_SNAPSHOT_MAX_WAIT_MS|dashboardStreamPayload|requestedDashboardRevision/);
assert.doesNotMatch(eventClientSource, /_snapshotRevision|params\.set\(['"]revision['"]/, 'client must not request legacy snapshot catch-up');
assert.doesNotMatch(eventClientSource, /token|Authorization|URLSearchParams/, 'SSE authentication must rely only on the HttpOnly dashboard session cookie');
assert.doesNotMatch(dashboardClientSource, /relai_dashboard_token|setToken|getToken/, 'dashboard renderer must never persist or read the MCP bearer token');
assert.match(eventClientSource, /removeEventListener/, 'SSE listeners must be removed when a source closes');
assert.match(eventClientSource, /function parseEventData[\s\S]*try[\s\S]*JSON\.parse[\s\S]*catch/, 'SSE payload parsing must fail safely');
assert.match(dashboardSource, /sendSse\(res, ['"]dashboard\.error['"]/, 'application-side SSE failures must not use EventSource\'s reserved transport error event');
assert.doesNotMatch(dashboardSource, /sendSse\(res, ['"]error['"]/, 'application-side SSE failures must not trigger transport reconnect backoff');
assert.match(dashboardClientSource, /event\.type === ['"]dashboard\.error['"][\s\S]*recoverDashboard/, 'application-side SSE failures must recover with an authoritative dashboard refresh');
assert.match(dashboardClientSource, /applyLiveEvent\(event\.type, event\.data\)/, 'browser coordinator must apply typed deltas through the canonical store');
assert.match(dashboardClientSource, /liveCatchUpRequired/, 'browser coordinator must compare ready revisions and fetch only when live events were missed');
assert.match(dashboardClientSource, /function viewRevisionKey/, 'route invalidation must use explicit revision keys');
assert.doesNotMatch(dashboardClientSource, /viewFingerprint|createSnapshotGate|snapshot-order/, 'legacy snapshot ordering/fingerprinting must be removed');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-events-'));
const previousConfigPath = process.env.REL_AI_MCP_CONFIG;
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const configPath = path.join(sandbox, 'config.json');
const auditPath = path.join(sandbox, 'audit.jsonl');
const token = 'dashboard-live-events-token';
const desktopStatusListeners = new Set();
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
  getDesktopStatus: () => desktopStatus,
  onDesktopStatusChange: listener => {
    desktopStatusListeners.add(listener);
    return () => desktopStatusListeners.delete(listener);
  },
  getTaskActivity: () => getToolActivity()
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
  const initial = initialDashboardPayload(html);
  assert.equal(initial.ok, true);
  assert.ok(initial.live?.streamId, 'HTML bootstrap must carry the live stream identity');
  assert.deepEqual(Object.keys(initial.live.revisions).sort(), ['connection', 'diagnostics', 'process', 'task', 'workspace']);
  assert.ok(Array.isArray(initial.tasks));
  assert.ok(Array.isArray(initial.managedProcesses));

  const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
    headers: { cookie: dashboardCookie }, signal: controller.signal
  });
  assert.equal(response.status, 200);
  responseReader = response.body.getReader();
  const stream = createEventReader(responseReader);

  const ready = JSON.parse((await stream.nextType('ready')).data);
  assert.equal(ready.ok, true);
  assert.equal(ready.streamId, initial.live.streamId, 'SSE ready must identify the same stream as the HTML bootstrap');
  assert.deepEqual(Object.keys(ready.revisions).sort(), ['connection', 'diagnostics', 'process', 'task', 'workspace']);

  fs.appendFileSync(auditPath, `${JSON.stringify({ ts: new Date().toISOString(), event: 'tool_call', tool: 'relai_read', workspace: 'test', ok: true })}\n`);
  const finishStart = beginConnectorToolCall({
    scopeId: 'dashboard-live-events-test', tool: 'relai_work', internalOperation: 'work.begin',
    operation: 'Starting dashboard test task', workspace: 'test', createTask: true,
    objective: 'Exercise typed dashboard events'
  });
  const taskId = finishStart.taskId;
  finishStart({ ok: true });

  const taskEvent = JSON.parse((await stream.nextType('task.updated')).data);
  assert.equal(taskEvent.domain, 'task');
  assert.ok(taskEvent.revision > ready.revisions.task);
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
  for (const listener of [...desktopStatusListeners]) listener(desktopStatus);
  let desktopConnection = null;
  for (let attempt = 0; attempt < 4 && desktopConnection?.desktopStatus?.tunnelStatus !== 'running'; attempt += 1) {
    desktopConnection = JSON.parse((await stream.nextType('connection.updated')).data);
  }
  assert.equal(desktopConnection?.desktopStatus?.tunnelStatus, 'running', 'desktop tunnel status must stream without unrelated task activity');

  const secondController = new AbortController();
  let secondReader;
  try {
    const reconnect = await fetch(`http://127.0.0.1:${address.port}/events`, {
      headers: { cookie: dashboardCookie }, signal: secondController.signal
    });
    secondReader = reconnect.body.getReader();
    const secondStream = createEventReader(secondReader);
    const reconnectReady = JSON.parse((await secondStream.nextType('ready')).data);
    assert.equal(reconnectReady.streamId, ready.streamId, 'reconnect uses the current server event stream');
    assert.ok(reconnectReady.revisions.task >= taskEvent.revision, 'ready metadata must expose revisions needed for catch-up decisions');
    const catchUpResponse = await fetch(`http://127.0.0.1:${address.port}/api/dashboard/v10?limit=100`, {
      headers: { cookie: dashboardCookie }
    });
    assert.equal(catchUpResponse.status, 200);
    const catchUp = await catchUpResponse.json();
    assert.equal(catchUp.live.streamId, reconnectReady.streamId);
    assert.ok(catchUp.tasks.some(task => task.id === taskId), 'aggregate catch-up fetch must contain the authoritative task state');
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

console.log('Dashboard typed live events and revision-based reconnect catch-up passed.');

function initialDashboardPayload(html) {
  const match = String(html).match(/<script type="application\/json" id="initialDashboardData"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match?.[1], 'HTML bootstrap must contain serialized dashboard data');
  return JSON.parse(match[1]);
}

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
