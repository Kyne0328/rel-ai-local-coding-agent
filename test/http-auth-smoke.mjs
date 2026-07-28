import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpBody, mcpHeaders, postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39877;
const token = 'auth-smoke-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-auth-'));
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir,
    REL_AI_MCP_MAX_BODY_BYTES: String(1024 * 1024),
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

try {
  await waitForHealth();
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/dashboard`)).status, 401);
  assert.equal((await fetch(`${base}/dashboard`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await fetch(`${base}/api/settings`, { headers: { authorization: `Bearer ${token}` } })).status, 200);

  const challenge = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: mcpHeaders('tools/list'),
    body: mcpBody(1, 'tools/list')
  });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('www-authenticate') || '', /oauth-protected-resource\/mcp/);

  const listed = await postMcp(base, { id: 2, method: 'tools/list', token });
  assert.equal(listed.response.status, 200, `${JSON.stringify(listed.body)}\n${stderr}`);
  assert.equal(listed.body.result?.tools?.length, 34);

  const missingVersion = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-method': 'tools/list' },
    body: mcpBody(3, 'tools/list')
  });
  assert.equal(missingVersion.status, 400);

  const oldSession = await postMcp(base, {
    id: 4,
    method: 'tools/list',
    token,
    extraHeaders: { 'mcp-session-id': 'removed-session' }
  });
  assert.equal(oldSession.response.status, 400);
  assert.match(oldSession.body.error?.message || '', /not valid/);

  const initialize = await postMcp(base, { id: 5, method: 'initialize', token });
  assert.equal(initialize.response.status, 400);
  assert.match(initialize.body.error?.message || '', /removed/);

  const getMcp = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(getMcp.status, 405);

  const uri = 'https://example.com/cb-🎉漢字é';
  const payload = Buffer.from(JSON.stringify({ application_type: 'web', redirect_uris: [uri] }), 'utf8');
  const splitAt = payload.indexOf(Buffer.from('🎉', 'utf8')) + 2;
  const registration = await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/register', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': payload.length } }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    request.on('error', reject);
    request.write(payload.subarray(0, splitAt));
    setTimeout(() => request.end(payload.subarray(splitAt)), 25);
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.redirect_uris[0], uri);

  const oversized = 'x'.repeat(2.5 * 1024 * 1024);
  let oversizedStatus = 500;
  try {
    oversizedStatus = (await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: mcpHeaders('tools/list', { token, extra: { connection: 'close' } }),
      body: mcpBody(6, 'tools/list', { pad: oversized })
    })).status;
  } catch {}
  assert.ok(oversizedStatus >= 400);
} finally {
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('HTTP authentication and MCP 2026 header tests passed.');
