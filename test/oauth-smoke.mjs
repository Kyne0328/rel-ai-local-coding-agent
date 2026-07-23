// End-to-end OAuth 2.1 + PKCE smoke test for the ChatGPT MCP connector flow.
//
// Exercises: 401 challenge -> discovery -> dynamic client registration ->
// authorize (dashboard-token login) -> token (authorization_code + PKCE) ->
// authenticated POST /mcp -> refresh_token. Plus negative cases (wrong login,
// wrong PKCE verifier).

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 39891;
const base = `http://127.0.0.1:${port}`;
const token = 'oauth-smoke-dashboard-token';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';

// Isolated state dir so we never read a real connection.json (which could carry a
// public URL) and the oauth-store stays scoped to this test.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oauth-'));

const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir
  }
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

function cleanup() {
  if (!child.killed) child.kill('SIGKILL');
  fs.rmSync(stateDir, { recursive: true, force: true });
}

function fail(message) {
  cleanup();
  throw new Error(message);
}

async function waitForHealth() {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] oauth health wait:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fail(`server did not become healthy. stderr:\n${stderr}`);
}

function form(obj) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) if (value != null) params.set(key, String(value));
  return params.toString();
}

async function postForm(pathname, obj, { manual = false } = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(obj),
    redirect: manual ? 'manual' : 'follow'
  });
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function getAuthCode(client, challenge, state) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    state
  });
  // Login page renders.
  const page = await fetch(`${base}/authorize?${query.toString()}`);
  if (page.status !== 200) fail(`GET /authorize expected 200, got ${page.status}`);
  const html = await page.text();
  if (!/Authorize ChatGPT|dashboard token/i.test(html)) fail('login page did not render the consent form');

  // Submit the dashboard token.
  const submit = await postForm('/authorize', {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    state,
    dashboard_token: token
  }, { manual: true });
  if (submit.status !== 302) fail(`POST /authorize expected 302, got ${submit.status}`);
  const location = submit.headers.get('location') || '';
  const url = new URL(location);
  if (url.origin + url.pathname !== redirectUri) fail(`authorize redirect went to the wrong place: ${location}`);
  if (url.searchParams.get('state') !== state) fail('authorize redirect dropped/altered state');
  const code = url.searchParams.get('code');
  if (!code) fail('authorize redirect did not include an authorization code');
  return code;
}

await waitForHealth();

// 1. Unauthenticated POST /mcp -> 401 + WWW-Authenticate challenge.
const challenge401 = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
});
if (challenge401.status !== 401) fail(`unauthenticated POST /mcp expected 401, got ${challenge401.status}`);
const wwwAuth = challenge401.headers.get('www-authenticate') || '';
if (!/Bearer/i.test(wwwAuth) || !wwwAuth.includes('resource_metadata=')) {
  fail(`POST /mcp 401 did not return a Bearer resource_metadata challenge: ${wwwAuth}`);
}

// 2. Protected-resource metadata.
const prm = await fetch(`${base}/.well-known/oauth-protected-resource`).then((r) => r.json());
if (!prm.resource?.endsWith('/mcp') || !prm.authorization_servers?.includes(base)) {
  fail(`protected-resource metadata malformed: ${JSON.stringify(prm)}`);
}

// 3. Authorization-server metadata.
const asm = await fetch(`${base}/.well-known/oauth-authorization-server`).then((r) => r.json());
if (asm.issuer !== base
  || asm.authorization_endpoint !== `${base}/authorize`
  || asm.token_endpoint !== `${base}/token`
  || asm.registration_endpoint !== `${base}/register`
  || !asm.code_challenge_methods_supported?.includes('S256')
  || !asm.grant_types_supported?.includes('authorization_code')
  || !asm.grant_types_supported?.includes('refresh_token')) {
  fail(`authorization-server metadata malformed: ${JSON.stringify(asm)}`);
}

// 4. Dynamic client registration.
const reg = await fetch(`${base}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'ChatGPT Smoke', redirect_uris: [redirectUri] })
});
if (reg.status !== 201) fail(`POST /register expected 201, got ${reg.status}`);
const client = await reg.json();
if (!client.client_id || client.token_endpoint_auth_method !== 'none') fail(`registration response malformed: ${JSON.stringify(client)}`);

// Concurrent registrations must not lose updates or leave lock/temp files.
const concurrentRegistrations = await Promise.all(Array.from({ length: 12 }, (_, index) => fetch(`${base}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: `Concurrent ${index}`, redirect_uris: [redirectUri] })
}).then(async response => ({ status: response.status, body: await response.json() }))));
if (concurrentRegistrations.some(item => item.status !== 201 || !item.body.client_id)) {
  fail(`concurrent client registration failed: ${JSON.stringify(concurrentRegistrations)}`);
}
const oauthStorePath = path.join(stateDir, 'oauth-store.json');
const oauthStore = JSON.parse(fs.readFileSync(oauthStorePath, 'utf8'));
if (Object.keys(oauthStore.clients || {}).length < 13) fail('concurrent OAuth registrations lost persisted clients');
if (fs.existsSync(path.join(stateDir, 'oauth-store.lock'))) fail('OAuth store lock was not cleaned up');
if (fs.readdirSync(stateDir).some(name => name.startsWith('oauth-store.json.') && name.endsWith('.tmp'))) fail('OAuth temporary file was not cleaned up');

// Registration must reject a missing redirect_uri.
const badReg = await fetch(`${base}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'no redirect' })
});
if (badReg.status !== 400) fail(`POST /register with no redirect_uris expected 400, got ${badReg.status}`);

// 5. Existing connector recovery on a fresh computer. Simulate the same static
// endpoint moving to another installation by removing only the registered client.
const portableReg = await fetch(`${base}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'Portable ChatGPT Connector', redirect_uris: [redirectUri] })
});
if (portableReg.status !== 201) fail(`portable POST /register expected 201, got ${portableReg.status}`);
const portableClient = await portableReg.json();
const portableStore = JSON.parse(fs.readFileSync(oauthStorePath, 'utf8'));
delete portableStore.clients[portableClient.client_id];
fs.writeFileSync(oauthStorePath, `${JSON.stringify(portableStore, null, 2)}\n`);

const portablePkce = pkcePair();
const portableState = 'portable-state';
const portableQuery = new URLSearchParams({
  response_type: 'code',
  client_id: portableClient.client_id,
  redirect_uri: redirectUri,
  code_challenge: portablePkce.challenge,
  code_challenge_method: 'S256',
  scope: 'mcp',
  state: portableState
});
const recoveryPage = await fetch(`${base}/authorize?${portableQuery.toString()}`);
if (recoveryPage.status !== 200) fail(`portable recovery GET /authorize expected 200, got ${recoveryPage.status}`);
const recoveryHtml = await recoveryPage.text();
if (!/New computer detected|restores the same connector/i.test(recoveryHtml)) fail('portable recovery page did not explain connector restoration');

const rejectedRecovery = await postForm('/authorize', {
  response_type: 'code',
  client_id: portableClient.client_id,
  redirect_uri: redirectUri,
  code_challenge: portablePkce.challenge,
  code_challenge_method: 'S256',
  scope: 'mcp',
  state: portableState,
  dashboard_token: 'WRONG-TOKEN'
}, { manual: true });
if (rejectedRecovery.status !== 401) fail(`portable recovery with wrong token expected 401, got ${rejectedRecovery.status}`);
const storeAfterRejectedRecovery = JSON.parse(fs.readFileSync(oauthStorePath, 'utf8'));
if (storeAfterRejectedRecovery.clients?.[portableClient.client_id]) fail('wrong dashboard token persisted a recovered OAuth client');

const portableCode = await getAuthCode(portableClient, portablePkce.challenge, portableState);
const storeAfterRecovery = JSON.parse(fs.readFileSync(oauthStorePath, 'utf8'));
if (!storeAfterRecovery.clients?.[portableClient.client_id]?.recovered_at) fail('approved portable connector was not persisted as recovered');
const portableTokenRes = await postForm('/token', {
  grant_type: 'authorization_code',
  code: portableCode,
  redirect_uri: redirectUri,
  client_id: portableClient.client_id,
  code_verifier: portablePkce.verifier
});
if (portableTokenRes.status !== 200) fail(`portable recovered connector token exchange expected 200, got ${portableTokenRes.status}`);

const foreignClientQuery = new URLSearchParams({
  response_type: 'code',
  client_id: 'foreign-client-id',
  redirect_uri: redirectUri,
  code_challenge: portablePkce.challenge,
  code_challenge_method: 'S256'
});
const foreignClientPage = await fetch(`${base}/authorize?${foreignClientQuery.toString()}`);
if (foreignClientPage.status !== 400) fail(`non-Rel.AI client recovery expected 400, got ${foreignClientPage.status}`);

// 6. Negative: wrong dashboard token at /authorize must NOT issue a code.
{
  const { challenge } = pkcePair();
  const res = await postForm('/authorize', {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    state: 'xyz',
    dashboard_token: 'WRONG-TOKEN'
  }, { manual: true });
  if (res.status === 302) fail('authorize issued a redirect/code for a WRONG dashboard token');
  if (res.status !== 401) fail(`wrong-token authorize expected 401, got ${res.status}`);
}

// 6. Happy path: authorize -> token (authorization_code + PKCE) -> access token.
const { verifier, challenge } = pkcePair();
const code = await getAuthCode(client, challenge, 'state-123');

const tokenRes = await postForm('/token', {
  grant_type: 'authorization_code',
  code,
  redirect_uri: redirectUri,
  client_id: client.client_id,
  code_verifier: verifier
});
if (tokenRes.status !== 200) fail(`POST /token expected 200, got ${tokenRes.status}`);
const tokens = await tokenRes.json();
if (!tokens.access_token || tokens.token_type !== 'Bearer' || !tokens.refresh_token || tokens.expires_in <= 0) {
  fail(`token response malformed: ${JSON.stringify(tokens)}`);
}

// 7. Negative: a fresh code with the WRONG verifier must fail PKCE.
{
  const wrong = pkcePair();
  const freshCode = await getAuthCode(client, wrong.challenge, 'state-bad-pkce');
  const res = await postForm('/token', {
    grant_type: 'authorization_code',
    code: freshCode,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: 'not-the-right-verifier'
  });
  if (res.status !== 400) fail(`PKCE mismatch expected 400, got ${res.status}`);
  const body = await res.json();
  if (body.error !== 'invalid_grant') fail(`PKCE mismatch expected invalid_grant, got ${JSON.stringify(body)}`);
}

// 8. Negative: an authorization code is single-use.
{
  const reuse = await postForm('/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: verifier
  });
  if (reuse.status !== 400) fail(`reusing an authorization code expected 400, got ${reuse.status}`);
}

// 9. The OAuth access token authenticates POST /mcp.
const mcpRes = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
});
if (mcpRes.status !== 200) fail(`POST /mcp with OAuth token expected 200, got ${mcpRes.status}`);
const mcpBody = await mcpRes.json();
if (mcpBody.result?.tools?.length !== 19) {
  fail(`OAuth-authenticated tools/list did not return 19 tools: ${mcpBody.result?.tools?.length}`);
}
const oauthExecSchema = mcpBody.result.tools.find(tool => tool.name === 'relai_exec');
if (!oauthExecSchema?.inputSchema?.properties?.command) fail('OAuth tool surface stripped the relai_exec command field');
const oauthSearchSchema = mcpBody.result.tools.find(tool => tool.name === 'relai_search');
if (!oauthSearchSchema?.inputSchema?.properties?.contextAfter) fail('OAuth tool surface stripped contextual relai_search fields');

// 10. An invalid bearer is still rejected with a challenge.
const badBearer = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-token' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
});
if (badBearer.status !== 401) fail(`POST /mcp with a bogus bearer expected 401, got ${badBearer.status}`);

// 11. Refresh token mints a new access token.
const refreshRes = await postForm('/token', {
  grant_type: 'refresh_token',
  refresh_token: tokens.refresh_token,
  client_id: client.client_id
});
if (refreshRes.status !== 200) fail(`refresh_token grant expected 200, got ${refreshRes.status}`);
const refreshed = await refreshRes.json();
if (!refreshed.access_token || refreshed.access_token === tokens.access_token) {
  fail('refresh_token did not mint a new access token');
}

const refreshedMcp = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${refreshed.access_token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })
});
if (refreshedMcp.status !== 200) fail(`refreshed access token did not authenticate POST /mcp, got ${refreshedMcp.status}`);

cleanup();
await once(child, 'close');
console.log('OAuth smoke test passed: discovery, registration, PKCE authorization-code, token, refresh, and protected /mcp all verified.');
