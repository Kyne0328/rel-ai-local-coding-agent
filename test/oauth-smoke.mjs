import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39891;
const base = `http://127.0.0.1:${port}`;
const approvalToken = 'oauth-smoke-approval-token';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oauth-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
    REL_AI_MCP_TOKEN: approvalToken,
    REL_AI_MCP_STATE_DIR: stateDir
  }
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`OAuth server did not become healthy. ${stderr}`);
}

function form(value) {
  return new URLSearchParams(Object.entries(value).filter(([, item]) => item != null).map(([key, item]) => [key, String(item)])).toString();
}

async function postForm(pathname, value, manual = false) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(value),
    redirect: manual ? 'manual' : 'follow'
  });
}

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

async function register(scope = 'mcp') {
  const response = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ application_type: 'web', client_name: 'ChatGPT OAuth Test', redirect_uris: [redirectUri], scope })
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function authorize(client, pair, scope, state) {
  const values = {
    response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: pair.challenge, code_challenge_method: 'S256',
    resource: `${base}/mcp`, scope, state
  };
  const page = await fetch(`${base}/authorize?${new URLSearchParams(values)}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Approve connection/);
  const approved = await postForm('/authorize', { ...values, dashboard_token: approvalToken }, true);
  assert.equal(approved.status, 302);
  const location = new URL(approved.headers.get('location'));
  assert.equal(location.searchParams.get('state'), state);
  assert.equal(location.searchParams.get('iss'), base);
  assert.ok(location.searchParams.get('code'));
  return location.searchParams.get('code');
}

async function exchange(client, code, verifier) {
  const response = await postForm('/token', {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: client.client_id, code_verifier: verifier
  });
  return { response, body: await response.json() };
}

try {
  await waitForHealth();
  const challenge = await fetch(`${base}/mcp`, { method: 'POST' });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get('www-authenticate') || '', /oauth-protected-resource\/mcp/);

  const protectedResource = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`).then(response => response.json());
  assert.equal(protectedResource.resource, `${base}/mcp`);
  assert.deepEqual(protectedResource.authorization_servers, [base]);
  const metadata = await fetch(`${base}/.well-known/oauth-authorization-server`).then(response => response.json());
  assert.equal(metadata.issuer, base);
  assert.ok(metadata.application_types_supported.includes('web'));
  assert.ok(metadata.grant_types_supported.includes('refresh_token'));
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);

  const missingApplicationType = await fetch(`${base}/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirectUri] })
  });
  assert.equal(missingApplicationType.status, 400);

  const client = await register('mcp');
  assert.equal(client.application_type, 'web');
  assert.equal(client.issuer, base);

  const firstPair = pkcePair();
  const firstCode = await authorize(client, firstPair, 'mcp', 'first');
  const first = await exchange(client, firstCode, firstPair.verifier);
  assert.equal(first.response.status, 200);
  assert.ok(first.body.access_token);
  assert.equal(first.body.refresh_token, undefined);
  assert.equal(first.body.scope, 'mcp');

  const stepUpPair = pkcePair();
  const stepUpCode = await authorize(client, stepUpPair, 'mcp offline_access', 'step-up');
  const stepUp = await exchange(client, stepUpCode, stepUpPair.verifier);
  assert.equal(stepUp.response.status, 200);
  assert.ok(stepUp.body.refresh_token);
  assert.equal(stepUp.body.scope, 'mcp offline_access');

  const tools = await postMcp(base, { id: 1, method: 'tools/list', token: stepUp.body.access_token, clientName: 'oauth-smoke' });
  assert.equal(tools.response.status, 200);
  assert.equal(tools.body.result.tools.length, 34);

  const refreshedResponse = await postForm('/token', {
    grant_type: 'refresh_token', refresh_token: stepUp.body.refresh_token, client_id: client.client_id, scope: 'mcp offline_access'
  });
  assert.equal(refreshedResponse.status, 200);
  const refreshed = await refreshedResponse.json();
  assert.ok(refreshed.access_token);
  assert.ok(refreshed.refresh_token);
  assert.notEqual(refreshed.refresh_token, stepUp.body.refresh_token);

  const reused = await postForm('/token', {
    grant_type: 'refresh_token', refresh_token: stepUp.body.refresh_token, client_id: client.client_id
  });
  assert.equal(reused.status, 400);

  const storedOAuth = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  assert.equal(storedOAuth.version, 4);
  const storedText = JSON.stringify(storedOAuth);
  assert.equal(storedText.includes(stepUp.body.access_token), false);
  assert.equal(storedText.includes(stepUp.body.refresh_token), false);
  assert.ok(Object.keys(storedOAuth.accessTokens).every(key => /^sha256:[a-f0-9]{64}$/.test(key)));
  assert.ok(Object.keys(storedOAuth.refreshTokens).every(key => /^sha256:[a-f0-9]{64}$/.test(key)));

  const wrongIssuerProvider = (await import('../src/oauthProvider.js')).default;
  const wrongIssuer = wrongIssuerProvider.validateAuthorizationRequest({
    response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: 'abc', code_challenge_method: 'S256'
  }, { issuer: 'https://different.example.test' });
  assert.equal(wrongIssuer.error, 'invalid_client');

  const revoked = wrongIssuerProvider.revokeAuthorizations();
  assert.ok(revoked.registeredClients >= 1);
  assert.equal(wrongIssuerProvider.authorizationStatus().registeredClients, 0);
  const oldClient = await fetch(`${base}/authorize?${new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: 'abc', code_challenge_method: 'S256'
  })}`);
  assert.equal(oldClient.status, 400);
  assert.throws(() => wrongIssuerProvider.canonicalIssuer('http://public.example.test'), /must use HTTPS/);
  assert.equal(wrongIssuerProvider.canonicalIssuer('http://127.0.0.1:3333/'), 'http://127.0.0.1:3333');
} finally {
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('OAuth 2026 issuer binding, PKCE, step-up scopes, and refresh rotation passed.');
