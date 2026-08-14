import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpMcpSession, mcpBody, mcpHeaders, postMcp, readMcpResponse } from './helpers/http-mcp.mjs';
import { activeToolCount } from './helpers/tool-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39877;
const token = 'auth-smoke-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-auth-'));
const configPath = path.join(stateDir, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir,
  workspaces: { repo: { path: root } }
}, null, 2));
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: configPath,
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir,
    REL_AI_MCP_MAX_BODY_BYTES: String(10 * 1024 * 1024),
    REL_AI_MCP_DEBUG: '1'
  }
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
const base = `http://127.0.0.1:${port}`;

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. ${stderr}`);
}

let session = null;
try {
  await waitForHealth();
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/dashboard`)).status, 401);
  const unauthorizedDashboard = await fetch(`${base}/api/settings`);
  const unauthorizedDashboardBody = await unauthorizedDashboard.json();
  assert.equal(unauthorizedDashboard.status, 401);
  assert.equal(unauthorizedDashboardBody.errorCode, 'dashboard_unavailable');
  assert.match(unauthorizedDashboardBody.error || '', /Dashboard authorization expired/i);
  assert.doesNotMatch(unauthorizedDashboardBody.error || '', /Bearer|REL_AI_MCP_TOKEN/i);
  assert.equal((await fetch(`${base}/dashboard`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${token}` } })).status, 200);

  const challenge = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders('tools/list'),
    body: mcpBody(1, 'tools/list')
  });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('www-authenticate') || '', /Bearer realm="rel-ai-local"/);

  session = await createHttpMcpSession(base, { token, clientName: 'relai-http-auth' });
  const listed = await session.request('tools/list');
  assert.equal(listed.response.status, 200, `${JSON.stringify(listed.body)}\n${stderr}`);
  assert.equal(listed.body.result?.tools?.length, activeToolCount);

  const legacyInitializeResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 20,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'chatgpt-compatibility-smoke', version: '1.0.0' }
      }
    })
  });
  const legacyInitialize = await readMcpResponse(legacyInitializeResponse);
  assert.equal(legacyInitializeResponse.status, 200, `${JSON.stringify(legacyInitialize)}\n${stderr}`);
  assert.equal(legacyInitialize.result?.protocolVersion, '2025-11-25');
  assert.equal(legacyInitialize.result?.serverInfo?.name, 'rel-ai-mcp');
  assert.equal(legacyInitializeResponse.headers.get('mcp-session-id'), null);

  const legacyInitializedResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  });
  assert.equal(legacyInitializedResponse.status, 202);
  assert.equal(await legacyInitializedResponse.text(), '');

  const legacyToolsResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} })
  });
  const legacyTools = await readMcpResponse(legacyToolsResponse);
  assert.equal(legacyToolsResponse.status, 200, `${JSON.stringify(legacyTools)}\n${stderr}`);
  assert.equal(legacyTools.result?.tools?.length, activeToolCount);

  const legacyStatusResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'relai_work', arguments: { action: 'status', workspace: 'repo' } }
    })
  });
  const legacyStatus = await readMcpResponse(legacyStatusResponse);
  assert.equal(legacyStatusResponse.status, 200, `${JSON.stringify(legacyStatus)}\n${stderr}`);
  assert.equal(legacyStatus.result?.isError, false, JSON.stringify(legacyStatus));
  assert.equal(legacyStatus.result?.structuredContent?.ok, true);

  const legacyBatchResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify([
      { jsonrpc: '2.0', id: 23, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 24, method: 'resources/list', params: {} }
    ])
  });
  const legacyBatch = await readMcpResponse(legacyBatchResponse);
  assert.equal(legacyBatchResponse.status, 400);
  assert.equal(legacyBatch.error?.code, -32600);
  assert.match(legacyBatch.error?.message || '', /batches are not supported/i);

  const missingVersion = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders('tools/list', { token, sessionId: session.sessionId, protocolVersion: '' }),
    body: mcpBody(3, 'tools/list')
  });
  assert.equal(missingVersion.status, 400);

  const oldSession = await postMcp(base, {
    id: 4,
    method: 'tools/list',
    token,
    sessionId: 'removed-session'
  });
  assert.equal(oldSession.response.status, 400);
  assert.match(oldSession.body.error?.message || '', /session.*not supported/i);

  const initialize = await postMcp(base, {
    id: 5,
    method: 'initialize',
    token,
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'second-client', version: '1.0.0' } }
  });
  assert.equal(initialize.response.status, 400);
  assert.equal(initialize.body.error?.code, -32601);

  const getMcp = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(getMcp.status, 405);

  const invalidOrigin = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders('tools/list', { token, sessionId: session.sessionId, extra: { origin: 'https://attacker.example' } }),
    body: mcpBody(6, 'tools/list')
  });
  assert.equal(invalidOrigin.status, 403);
  assert.match(await invalidOrigin.text(), /(?:invalid|forbidden) origin/i);

  for (const removedPath of ['/register', '/authorize', '/token', '/.well-known/oauth-protected-resource/mcp']) {
    const removed = await fetch(`${base}${removedPath}`, { method: removedPath === '/register' || removedPath === '/token' ? 'POST' : 'GET' });
    assert.equal(removed.status, 404, `${removedPath} must be removed after the Secure MCP Tunnel hard cut`);
  }

  const withinMcpEnvelope = "x".repeat(8 * 1024 * 1024);
  let withinMcpEnvelopeStatus = 0;
  try {
    withinMcpEnvelopeStatus = (await fetch(`${base}/mcp`, {
      method: "POST",
      headers: mcpHeaders("tools/list", { token, sessionId: session.sessionId }),
      body: mcpBody(7, "tools/list", { pad: withinMcpEnvelope })
    })).status;
  } catch {}
  assert.notEqual(withinMcpEnvelopeStatus, 0, "an 8 MiB MCP request must reach protocol handling");
  assert.notEqual(withinMcpEnvelopeStatus, 413, "an 8 MiB MCP request must stay below the MCP body ceiling");

  const overMcpEnvelope = "x".repeat(11 * 1024 * 1024);
  let overMcpEnvelopeStatus = 0;
  try {
    overMcpEnvelopeStatus = (await fetch(`${base}/mcp`, {
      method: "POST",
      headers: mcpHeaders("tools/list", { token, sessionId: session.sessionId, extra: { connection: "close" } }),
      body: mcpBody(8, "tools/list", { pad: overMcpEnvelope })
    })).status;
  } catch {}
  assert.ok([0, 413].includes(overMcpEnvelopeStatus), "an 11 MiB MCP request must be rejected at the body boundary, got " + overMcpEnvelopeStatus);
} finally {
  if (session) await session.close().catch(() => {});
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('HTTP authentication, stateless ChatGPT initialization, modern protocol validation, and Origin protection tests passed.');
