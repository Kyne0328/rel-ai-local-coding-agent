import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dashboardSource = fs.readFileSync(new URL('../src/http/dashboard.js', import.meta.url), 'utf8');
assert.match(dashboardSource, /: keepalive/, 'dashboard SSE must include a heartbeat for quiet connections');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-events-'));
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
  maxIndexFiles: 3000,
  workspaces: {},
  productUx: {
    dashboardRefreshSeconds: 5,
    liveLogPollSeconds: 1,
    staleHours: 24,
    cleanupOlderThanHours: 168,
    enableStateExport: true
  }
}, null, 2));

process.env.REL_AI_MCP_CONFIG = configPath;
const { startHttpServer } = await import('../src/httpServer.js');
const server = startHttpServer({
  host: '127.0.0.1',
  port: 0,
  token,
  exitOnError: false,
  getDesktopStatus: () => desktopStatus
});
const controller = new AbortController();

try {
  await waitForListening(server);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const response = await fetch(`http://127.0.0.1:${address.port}/events?token=${encodeURIComponent(token)}`, {
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  assert.ok(response.body, 'dashboard event stream must expose a response body');

  const stream = createEventReader(response.body.getReader());
  const ready = await stream.nextEvent();
  assert.equal(ready.event, 'ready');
  assert.equal(JSON.parse(ready.data).ok, true);

  const entry = {
    ts: new Date().toISOString(),
    event: 'tool_call',
    tool: 'relai_read',
    workspace: 'test',
    ok: true
  };
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, 'utf8');

  const updated = await stream.nextDashboardEvent();
  assert.equal(updated.desktopStatus?.tunnelStatus, 'connecting');
  assert.ok(
    updated.auditTail?.entries?.some(item => item.tool === 'relai_read' && item.workspace === 'test'),
    'dashboard SSE must emit newly appended audit entries without a manual refresh'
  );

  desktopStatus = {
    ...desktopStatus,
    tunnelStatus: 'running',
    mcpUrl: 'https://example.ngrok-free.dev/mcp'
  };
  const desktopUpdated = await stream.nextDashboardEvent();
  assert.equal(desktopUpdated.desktopStatus?.tunnelStatus, 'running');
  assert.equal(desktopUpdated.desktopStatus?.mcpUrl, 'https://example.ngrok-free.dev/mcp');
} finally {
  controller.abort();
  await closeServer(server);
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
