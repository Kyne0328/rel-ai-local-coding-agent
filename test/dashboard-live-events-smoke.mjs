import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as dashboardSessions from "../src/http/dashboardSessions.js";
import { beginConnectorToolCall, resetToolActivity } from "../src/toolActivity.js";
import { mcpConnectionManager } from '../src/mcp/connectionManager.js';
const dashboardSource = fs.readFileSync(new URL('../src/http/dashboard.js', import.meta.url), 'utf8');
const eventClientSource = fs.readFileSync(new URL('../src/ui/events.js', import.meta.url), 'utf8');
const dashboardClientSource = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
const connectionStateSource = fs.readFileSync(new URL('../src/ui/connection-state.js', import.meta.url), 'utf8');
assert.match(dashboardSource, /: keepalive/, 'dashboard SSE must include a heartbeat for quiet connections');
assert.match(eventClientSource, /addEventListener\('ready'/, 'the dashboard client must treat the server ready event as a live connection');
assert.match(eventClientSource, /stopSSE\(\{ emit: false \}\)/, 'normal SSE restarts must not flash an offline state');
assert.match(eventClientSource, /emitState\('reconnecting'\)/, 'temporary transport failures must be represented as reconnecting');
assert.match(eventClientSource, /750 \* \(2 \*\*/, 'reconnect attempts must use bounded exponential backoff');
assert.doesNotMatch(eventClientSource, /emitState\('paused'\)/, 'background windows must keep the live transport active');
assert.doesNotMatch(eventClientSource, /visibilityState === 'hidden'/, 'background windows must not disconnect the live transport');
assert.match(eventClientSource, /visibilityState !== 'visible'/, 'visibility recovery must reconnect only when the window becomes visible and the stream is absent');
assert.match(eventClientSource, /new EventSource\(url, \{ withCredentials: true \}\)/, 'Electron EventSource requests must include the dashboard session cookie');
assert.match(dashboardSource, /sendSnapshot\(true\)/, 'every new SSE connection must receive an immediate catch-up snapshot');
assert.match(dashboardSource, /payload\.snapshot\.streamId.*payload\.snapshot\.sequence/, 'SSE snapshots must expose a stable stream ID and monotonic sequence');
assert.match(dashboardClientSource, /source: 'visibility-resume'/, 'returning to the dashboard must force a catch-up refresh');
assert.match(dashboardSource, /onToolActivity\(scheduleSnapshot\)/, 'tool activity must schedule dashboard snapshots');
assert.doesNotMatch(dashboardSource, /setInterval\(\(\) => sendSnapshot/, 'dashboard updates must not depend on a polling timer');
assert.doesNotMatch(dashboardClientSource, /configureLiveRefresh|dashboardRefreshSeconds|liveLogPollSeconds|_liveState = 'polling'/);
assert.doesNotMatch(connectionStateSource, /polling:/);

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
  maxOutputBytes: 2097152,
  workspaces: {},
  productUx: {
    staleHours: 24,
    cleanupOlderThanHours: 168,
    enableStateExport: true
  }
}, null, 2));

process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = sandbox;
const { startHttpServer } = await import('../src/httpServer.js');
const server = startHttpServer({
  host: '127.0.0.1',
  port: 0,
  token,
  exitOnError: false,
  getDesktopStatus: () => desktopStatus
});
const controller = new AbortController();
let responseReader;

try {
  await waitForListening(server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  assert.equal(fs.existsSync(path.join(sandbox, 'connection.json')), false, 'ephemeral validation servers must not publish or replace the active connector profile');

  const bootstrap = dashboardSessions.createDashboardBootstrap(token);
  const dashboardResponse = await fetch(`http://127.0.0.1:${address.port}/dashboard?surface=desktop&bootstrap=${encodeURIComponent(bootstrap)}`);
  assert.equal(dashboardResponse.status, 200);
  const dashboardCookie = String(dashboardResponse.headers.get('set-cookie') || '').split(';')[0];
  assert.match(dashboardCookie, /^relai_dashboard_session=/, 'desktop bootstrap must issue a dashboard session cookie');

  const response = await fetch(`http://127.0.0.1:${address.port}/events`, {
    headers: { cookie: dashboardCookie },
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.ok(response.body, 'dashboard event stream must expose a response body');

  responseReader = response.body.getReader();
  const stream = createEventReader(responseReader);
  const ready = await stream.nextEvent();
  assert.equal(ready.event, 'ready');
  assert.equal(JSON.parse(ready.data).ok, true);
  const initialSnapshot = await stream.nextDashboardEvent();
  assert.equal(initialSnapshot.desktopStatus?.tunnelStatus, 'connecting');
  assert.equal(initialSnapshot.connectionState?.localService?.status, 'running');
  assert.equal(initialSnapshot.snapshot?.modelVersion, 3);
  assert.ok(initialSnapshot.snapshot?.streamId);
  assert.ok(initialSnapshot.snapshot?.sequence > 0);

  const entry = {
    ts: new Date().toISOString(),
    event: 'tool_call',
    tool: 'relai_read',
    workspace: 'test',
    ok: true
  };
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
  const finishStart = beginConnectorToolCall({
    scopeId: 'dashboard-live-events-test',
    tool: 'relai_begin_work',
    operation: 'Starting dashboard test task',
    workspace: 'test',
    createTask: true
  });
  const taskId = finishStart.taskId;
  finishStart({ ok: true });

  const updated = await stream.nextDashboardEvent();
  assert.equal(updated.desktopStatus?.tunnelStatus, 'connecting');
  assert.equal(updated.connectionState?.localService?.status, 'running');
  assert.equal(updated.connectionState?.publicEndpoint?.status, 'connecting');
  assert.equal(updated.snapshot?.streamId, initialSnapshot.snapshot?.streamId);
  assert.ok(updated.snapshot?.sequence > initialSnapshot.snapshot?.sequence);
  assert.ok(
    updated.auditTail?.entries?.some(item => item.tool === 'relai_read' && item.workspace === 'test'),
    'dashboard SSE must emit newly appended audit entries without a manual refresh'
  );

  desktopStatus = {
    ...desktopStatus,
    tunnelStatus: 'running',
    mcpUrl: 'https://example.ngrok-free.dev/mcp'
  };
  const finishStatus = beginConnectorToolCall({
    scopeId: 'dashboard-live-events-status-test',
    taskId,
    tool: 'relai_status',
    operation: 'Reading connection status',
    workspace: 'test'
  });
  finishStatus({ ok: true });
  const desktopUpdated = await stream.nextDashboardEvent();
  assert.equal(desktopUpdated.desktopStatus?.tunnelStatus, 'running');
  assert.equal(desktopUpdated.desktopStatus?.mcpUrl, 'https://example.ngrok-free.dev/mcp');
  assert.equal(desktopUpdated.connectionState?.publicEndpoint?.status, 'available');
  assert.equal(desktopUpdated.connectionState?.chatgptReadiness?.status, 'ready');
  assert.equal(desktopUpdated.mcpConnection?.activityStatus, 'no_requests');
  assert.equal(desktopUpdated.mcpAuthentication?.status, 'awaiting_authentication');
  assert.ok(desktopUpdated.snapshot?.sequence > updated.snapshot?.sequence);

  const requestId = mcpConnectionManager.beginRequest({
    principal: 'dashboard-live-events-client',
    method: 'tools/list',
    authMode: 'static_bearer'
  });
  const activeRequest = await stream.nextDashboardEvent();
  assert.equal(activeRequest.mcpConnection?.activityStatus, 'active');
  assert.equal(activeRequest.mcpConnection?.activeRequestCount, 1);
  assert.equal(activeRequest.mcpAuthentication?.status, 'bearer_authorized');
  assert.ok(activeRequest.snapshot?.sequence > desktopUpdated.snapshot?.sequence);

  mcpConnectionManager.finishRequest(requestId, { method: 'tools/list', ok: true });
  const recentRequest = await stream.nextDashboardEvent();
  assert.equal(recentRequest.mcpConnection?.activityStatus, 'recent');
  assert.equal(recentRequest.mcpConnection?.activeRequestCount, 0);
  assert.equal(recentRequest.mcpAuthentication?.status, 'bearer_authorized');
  assert.equal(recentRequest.mcpAuthentication?.authMode, 'static_bearer');
  assert.ok(recentRequest.snapshot?.sequence > activeRequest.snapshot?.sequence);
} finally {
  controller.abort();
  await responseReader?.cancel().catch(() => {});
  resetToolActivity();
  server.closeAllConnections?.();
  await closeServer(server);
  if (previousConfigPath == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfigPath;
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(sandbox, { recursive: true, force: true });
}

function createEventReader(reader) {
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async nextEvent(timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const block = takeEventBlock();
        if (block) return parseEventBlock(block);

        const remaining = deadline - Date.now();
        const result = await Promise.race([
          reader.read(),
          delayReject(remaining, 'Timed out waiting for a dashboard SSE event.')
        ]);
        if (result.done) throw new Error('Dashboard SSE stream closed unexpectedly.');
        buffer += decoder.decode(result.value, { stream: true }).replaceAll('\r\n', '\n');
      }
      throw new Error('Timed out waiting for a dashboard SSE event.');
    },
    async nextDashboardEvent(timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const parsed = await this.nextEvent(deadline - Date.now());
        if (parsed.event === 'dashboard') return JSON.parse(parsed.data);
      }
      throw new Error('Timed out waiting for a dashboard SSE event.');
    }
  };

  function takeEventBlock() {
    const boundary = buffer.indexOf('\n\n');
    if (boundary === -1) return '';
    const block = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    return block;
  }
}

function parseEventBlock(block) {
  let event = '';
  const data = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return { event, data: data.join('\n') };
}

function delayReject(ms, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), Math.max(1, ms));
    timer.unref?.();
  });
}

function waitForListening(target) {
  if (target.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    target.once('listening', resolve);
    target.once('error', reject);
  });
}

function closeServer(target) {
  return new Promise(resolve => {
    if (!target?.listening) return resolve();
    target.close(resolve);
  });
}
