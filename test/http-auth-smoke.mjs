import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39877;
const token = process.env.TEST_TOKEN ?? 'auth-smoke-token';
const chatgptSecret = 'auth-smoke-secret';
// Use a small body limit so the 2.5 MB body test actually triggers the rejection
const maxBodyBytes = 1 * 1024 * 1024; // 1 MB

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_MAX_BODY_BYTES: String(maxBodyBytes),
    // The /register test below writes the OAuth client store — keep it out of the
    // user's real ~/.rel-ai-mcp state.
    REL_AI_MCP_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-auth-smoke-'))
  }
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

async function waitForHealth() {
  const url = `http://127.0.0.1:${port}/health`;
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. stderr:\n${stderr}`);
}

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}`);
    console.error('    smoke check failed');
    if (process.env.REL_AI_MCP_DEBUG) console.error(error);
    process.exitCode = 1;
  }
}

await waitForHealth();

const base = `http://127.0.0.1:${port}`;
const bearer = { authorization: `Bearer ${token}` };
const jsonType = { 'content-type': 'application/json' };
const mcpToolsList = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

// GET /health — public, no token → 200
await check('GET /health — public, no token → 200', async () => {
  const res = await fetch(`${base}/health`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error('health body.ok was not true');
});

// GET /dashboard — no token → 401 with a stable recovery code
await check('GET /dashboard — no token → 401', async () => {
  const res = await fetch(`${base}/dashboard`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  const body = await res.json();
  if (body.errorCode !== 'approval_token_required') {
    throw new Error(`expected approval_token_required, got ${body.errorCode}`);
  }
});

// GET /dashboard — rejected token → 401 with a distinct recovery code
await check('GET /dashboard — rejected token → 401', async () => {
  const res = await fetch(`${base}/dashboard?token=wrong-token`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  const body = await res.json();
  if (body.errorCode !== 'approval_token_rejected') {
    throw new Error(`expected approval_token_rejected, got ${body.errorCode}`);
  }
});

// GET /dashboard — with bearer → 200
await check('GET /dashboard — with bearer → 200', async () => {
  const res = await fetch(`${base}/dashboard`, { headers: bearer });
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
});

// GET /dashboard — with ?token= → 200
await check('GET /dashboard — with ?token= → 200', async () => {
  const res = await fetch(`${base}/dashboard?token=${encodeURIComponent(token)}`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
});

// GET /public/ui/api.js — dashboard module graph alias → 200
await check('GET /public/ui/api.js — dashboard module graph alias → 200', async () => {
  const res = await fetch(`${base}/public/ui/api.js`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/javascript')) throw new Error(`expected JavaScript content-type, got ${contentType}`);
  const body = await res.text();
  if (!body.includes('DASHBOARD_DATA_URL')) throw new Error('dashboard API module body was not served');
});

// GET /api/settings — no token → 401
await check('GET /api/settings — no token → 401', async () => {
  const res = await fetch(`${base}/api/settings`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

// GET /api/settings — with bearer → 200
await check('GET /api/settings — with bearer → 200', async () => {
  const res = await fetch(`${base}/api/settings`, { headers: bearer });
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.json();
  if (!body.ok) throw new Error('settings body.ok was not true');
});

// GET /mcp diagnostic — OAuth, and never leaks a secret/token
await check('GET /mcp diagnostic — OAuth, no secret leak', async () => {
  const res = await fetch(`${base}/mcp`);
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.json();
  const text = JSON.stringify(body);
  if (!body.ok || body.chatgptAuth !== 'OAuth' || !body.correctChatGPTUrl.endsWith('/mcp') || !body.oauthProtectedResource.includes('/.well-known/oauth-protected-resource')) {
    throw new Error('diagnostic did not advertise the OAuth flow');
  }
  if (text.includes(chatgptSecret) || text.includes(token)) {
    throw new Error('diagnostic leaked a secret value');
  }
});

// POST /mcp — no bearer → 401 with a stable recovery code
await check('POST /mcp — no bearer → 401', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: jsonType,
    body: mcpToolsList
  });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  const body = await res.json();
  if (body.errorCode !== 'approval_token_required') {
    throw new Error(`expected approval_token_required, got ${body.errorCode}`);
  }
});

// POST /mcp — rejected bearer → 401 with a distinct recovery code
await check('POST /mcp — rejected bearer → 401', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...jsonType, authorization: 'Bearer wrong-token' },
    body: mcpToolsList
  });
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
  const body = await res.json();
  if (body.errorCode !== 'approval_token_rejected') {
    throw new Error(`expected approval_token_rejected, got ${body.errorCode}`);
  }
});

// POST /mcp — with bearer → 200 (tools/list)
await check('POST /mcp — with bearer → 200 (tools/list)', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...jsonType, ...bearer },
    body: mcpToolsList
  });
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.result?.tools)) throw new Error('expected tools array in response');
});

// POST /mcp/<secret> — legacy no-auth path removed → 401 or 404
await check('POST /mcp/<secret> — removed → 401 or 404', async () => {
  const res = await fetch(`${base}/mcp/${chatgptSecret}`, {
    method: 'POST',
    headers: jsonType,
    body: mcpToolsList
  });
  if (res.status !== 401 && res.status !== 404) {
    throw new Error(`legacy secret path should no longer authenticate; got ${res.status}`);
  }
});

// POST /mcp/wrong-secret — no bearer → 401 or 404
await check('POST /mcp/wrong-secret — no bearer → 401 or 404', async () => {
  const res = await fetch(`${base}/mcp/wrong-secret-that-does-not-match`, {
    method: 'POST',
    headers: jsonType,
    body: mcpToolsList
  });
  if (res.status !== 401 && res.status !== 404) {
    throw new Error(`expected 401 or 404, got ${res.status}`);
  }
});

// Regression: a multi-byte UTF-8 character split across two body chunks must
// decode intact (readRawBody used to decode per-chunk, yielding U+FFFD halves).
await check('multibyte body split across chunks decodes intact', async () => {
  const uri = 'https://example.com/cb-\u{1F389}漢字é';
  const payload = Buffer.from(JSON.stringify({ redirect_uris: [uri] }), 'utf8');
  // Split inside the 4-byte emoji sequence so each half is invalid UTF-8 alone.
  const splitAt = payload.indexOf(Buffer.from('\u{1F389}', 'utf8')) + 2;
  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/register',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': payload.length }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write(payload.subarray(0, splitAt));
    setTimeout(() => req.end(payload.subarray(splitAt)), 50);
  });
  if (result.status !== 201) throw new Error(`expected 201, got ${result.status}: ${result.data}`);
  const body = JSON.parse(result.data);
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris[0] !== uri) {
    throw new Error(`multibyte content corrupted in transit: ${body.redirect_uris?.[0]}`);
  }
});

// body limit — POST /mcp with 2.5 MB+ body → 413 or error (server configured with 1 MB limit)
await check('body limit — POST /mcp with 2.5 MB+ body → 4xx or 5xx or connection error', async () => {
  const oversized = 'x'.repeat(2.5 * 1024 * 1024);
  const payload = JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: { _pad: oversized } });
  let status;
  try {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...jsonType, ...bearer, connection: 'close' },
      body: payload
    });
    status = res.status;
  } catch {
    // Connection destroyed by server — that counts as the limit being enforced.
    return;
  }
  if (status < 400) throw new Error(`expected error status for oversized body, got ${status}`);
});

child.kill('SIGKILL');
await once(child, 'close');
console.log('HTTP auth smoke tests passed.');
