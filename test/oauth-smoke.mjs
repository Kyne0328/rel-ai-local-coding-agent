import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpMcpSession, readMcpResponse } from './helpers/http-mcp.mjs';
import { activeToolCount } from './helpers/tool-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39891;
const base = `http://127.0.0.1:${port}`;
const approvalToken = 'oauth-smoke-approval-token';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oauth-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;
const legacyClientId = 'legacy-chatgpt-client';
const legacyRefreshToken = 'legacy-refresh-token';
fs.writeFileSync(path.join(stateDir, 'oauth-store.json'), `${JSON.stringify({
  version: 4,
  clients: {
    [legacyClientId]: {
      client_name: 'ChatGPT',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      created_at: Date.now() - 60_000
    }
  },
  codes: {},
  accessTokens: {},
  refreshTokens: {
    [legacyRefreshToken]: {
      clientId: legacyClientId,
      scope: 'mcp',
      issuedAt: Date.now() - 60_000,
      expiresAt: Date.now() + 86_400_000
    }
  },
  approvalRequiredAt: null,
  lastApprovedAt: Date.now() - 60_000
}, null, 2)}\n`);
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
  const pageHtml = await page.text();
  assert.match(pageHtml, /Approve connection/);
  assert.match(pageHtml, /href="\/public\/oauth\.css"/);
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

let mcpSession = null;
try {
  await waitForHealth();

  const expectedOauthCss = fs.readFileSync(path.join(root, 'public', 'oauth.css'), 'utf8');
  const oauthCss = await fetch(`${base}/public/oauth.css`);
  assert.equal(oauthCss.status, 200);
  assert.match(oauthCss.headers.get('content-type') || '', /^text\/css(?:;\s*charset=utf-8)?$/i);
  const servedOauthCss = await oauthCss.text();
  assert.equal(servedOauthCss, expectedOauthCss);
  assert.doesNotMatch(servedOauthCss, /[A-Za-z]:\\|file:\/\/|\/home\/|\/Users\//);

  const missingOauthCss = await fetch(`${base}/public/oauth-missing.css`);
  assert.equal(missingOauthCss.status, 404);
  assert.equal(await missingOauthCss.text(), 'Not found');

  const invalidAuthorize = await fetch(`${base}/authorize`);
  assert.equal(invalidAuthorize.status, 400);
  assert.match(await invalidAuthorize.text(), /href="\/public\/oauth\.css"/);

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

  const legacyRefresh = await postForm('/token', {
    grant_type: 'refresh_token',
    refresh_token: legacyRefreshToken,
    client_id: legacyClientId
  });
  assert.equal(legacyRefresh.status, 400);
  assert.equal((await legacyRefresh.json()).error, 'invalid_grant');
  const resetLegacyStore = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  assert.equal(resetLegacyStore.version, 6);
  assert.deepEqual(Object.keys(resetLegacyStore.clients), [legacyClientId]);
  assert.equal(resetLegacyStore.clients[legacyClientId].legacy_registration, true);
  assert.equal(resetLegacyStore.clients[legacyClientId].issuer, '');
  assert.deepEqual(Object.keys(resetLegacyStore.refreshTokens), []);
  assert.ok(Number(resetLegacyStore.approvalRequiredAt) > 0);

  const legacyPair = pkcePair();
  const legacyCode = await authorize({ client_id: legacyClientId }, legacyPair, 'mcp offline_access', 'legacy-reconnect');
  const legacyExchange = await exchange({ client_id: legacyClientId }, legacyCode, legacyPair.verifier);
  assert.equal(legacyExchange.response.status, 200);
  assert.ok(legacyExchange.body.access_token);
  assert.ok(legacyExchange.body.refresh_token);
  const reboundLegacyStore = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  assert.equal(reboundLegacyStore.clients[legacyClientId].issuer, base);
  assert.equal(reboundLegacyStore.clients[legacyClientId].legacy_registration, undefined);

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

  mcpSession = await createHttpMcpSession(base, { token: stepUp.body.access_token, clientName: 'oauth-smoke' });
  const tools = await mcpSession.request('tools/list');
  assert.equal(tools.response.status, 200);
  assert.equal(tools.body.result.tools.length, activeToolCount);

  const chatGptInitializeResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${stepUp.body.access_token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 40,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'ChatGPT', version: '1.0.0' }
      }
    })
  });
  const chatGptInitialize = await readMcpResponse(chatGptInitializeResponse);
  assert.equal(chatGptInitializeResponse.status, 200, JSON.stringify(chatGptInitialize));
  assert.equal(chatGptInitialize.result?.protocolVersion, '2025-11-25');
  assert.equal(chatGptInitialize.result?.serverInfo?.name, 'rel-ai-mcp');
  assert.equal(chatGptInitializeResponse.headers.get('mcp-session-id'), null);

  const chatGptInitializedResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${stepUp.body.access_token}`,
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
  });
  assert.equal(chatGptInitializedResponse.status, 202);
  assert.equal(await chatGptInitializedResponse.text(), '');

  const chatGptToolsResponse = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${stepUp.body.access_token}`,
      'mcp-protocol-version': '2025-11-25'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 41, method: 'tools/list', params: {} })
  });
  const chatGptTools = await readMcpResponse(chatGptToolsResponse);
  assert.equal(chatGptToolsResponse.status, 200, JSON.stringify(chatGptTools));
  assert.equal(chatGptTools.result?.tools?.length, activeToolCount);

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
  assert.equal(storedOAuth.version, 6);
  const storedText = JSON.stringify(storedOAuth);
  assert.equal(storedText.includes(stepUp.body.access_token), false);
  assert.equal(storedText.includes(stepUp.body.refresh_token), false);
  assert.ok(Object.keys(storedOAuth.accessTokens).every(key => /^sha256:[a-f0-9]{64}$/.test(key)));
  assert.ok(Object.keys(storedOAuth.refreshTokens).every(key => /^sha256:[a-f0-9]{64}$/.test(key)));

  const wrongIssuerProvider = await import('../src/oauthProvider.js');  const wrongIssuer = wrongIssuerProvider.validateAuthorizationRequest({
    response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: 'abc', code_challenge_method: 'S256'
  }, { issuer: 'https://different.example.test' });
  assert.equal(wrongIssuer.error, 'invalid_client');
  assert.equal(wrongIssuer.recovery?.reason, 'issuer_changed');
  assert.equal(wrongIssuer.recovery?.preservesUnrelatedClients, true);

  const unrelatedClient = await register('mcp');
  const revoked = wrongIssuerProvider.revokeAuthorizations();
  assert.ok(revoked.registeredClientsPreserved >= 1);
  assert.ok(wrongIssuerProvider.authorizationStatus().registeredClients >= 1);
  const missingClientStore = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  delete missingClientStore.clients[client.client_id];
  fs.writeFileSync(path.join(stateDir, 'oauth-store.json'), `${JSON.stringify(missingClientStore, null, 2)}\n`);
  const recoveryPair = pkcePair();
  const recoveryValues = {
    response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    code_challenge: recoveryPair.challenge, code_challenge_method: 'S256',
    resource: `${base}/mcp`, scope: 'mcp offline_access', state: 'missing-client-recovery'
  };
  const recoveryPage = await fetch(`${base}/authorize?${new URLSearchParams(recoveryValues)}`);
  assert.equal(recoveryPage.status, 200);
  assert.deepEqual(
    Object.keys(JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8')).clients).sort(),
    [legacyClientId, unrelatedClient.client_id].sort()
  );
  const recoveredApproval = await postForm('/authorize', { ...recoveryValues, dashboard_token: approvalToken }, true);
  assert.equal(recoveredApproval.status, 302);
  const recoveredStore = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  assert.deepEqual(Object.keys(recoveredStore.clients).sort(), [client.client_id, legacyClientId, unrelatedClient.client_id].sort());
  assert.equal(recoveredStore.clients[client.client_id].issuer, base);
  assert.equal(recoveredStore.clients[unrelatedClient.client_id].issuer, base);
  assert.throws(() => wrongIssuerProvider.canonicalIssuer('http://public.example.test'), /must use HTTPS/);
  assert.equal(wrongIssuerProvider.canonicalIssuer('http://127.0.0.1:3333/'), 'http://127.0.0.1:3333');
} finally {
  if (mcpSession) await mcpSession.close().catch(() => {});
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('OAuth issuer binding, PKCE, step-up scopes, refresh rotation, and initialized MCP access passed.');
