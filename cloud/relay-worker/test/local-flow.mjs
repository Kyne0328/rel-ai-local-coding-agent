import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const port = 8791;
const baseUrl = `http://127.0.0.1:${port}`;
const migration = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'rel-ai-cloud', '--local'], {
  cwd: root,
  env: { ...process.env, NO_COLOR: '1' },
  encoding: 'utf8',
  windowsHide: true
});
assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);

const processHandle = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});

let output = '';
processHandle.stdout.on('data', chunk => { output += String(chunk); });
processHandle.stderr.on('data', chunk => { output += String(chunk); });

try {
  await waitForHealth();

  const protectedResource = await getJson('/.well-known/oauth-protected-resource', 200);
  assert.match(protectedResource.resource, /^https:\/\/.*\/mcp$/);
  assert.deepEqual(protectedResource.scopes_supported, ['mcp', 'offline_access']);
  assert.deepEqual(protectedResource.authorization_servers, ['https://rel-ai-cloud.kynskie13.workers.dev']);

  const authorizationMetadata = await getJson('/.well-known/oauth-authorization-server', 200);
  assert.equal(authorizationMetadata.issuer, 'https://rel-ai-cloud.kynskie13.workers.dev');
  assert.equal(authorizationMetadata.registration_endpoint, 'https://rel-ai-cloud.kynskie13.workers.dev/register');
  assert.deepEqual(authorizationMetadata.code_challenge_methods_supported, ['S256']);
  assert.ok(authorizationMetadata.grant_types_supported.includes('refresh_token'));
  assert.ok(authorizationMetadata.scopes_supported.includes('offline_access'));

  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const challenge = await postJson('/v1/devices/register/challenge', {
    public_key_jwk: publicKeyJwk
  }, 201);
  assert.match(challenge.device_id, /^device_[a-f0-9]{32}$/);

  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    keyPair.privateKey,
    new TextEncoder().encode(challenge.challenge)
  );
  const registered = await postJson('/v1/devices/register/complete', {
    challenge_id: challenge.challenge_id,
    signature: Buffer.from(signature).toString('base64url')
  }, 201);
  assert.equal(registered.device_id, challenge.device_id);
  assert.match(registered.device_token, /^relai_device_[A-Za-z0-9_-]+$/);

  const pairing = await postJson('/v1/devices/pairing-code', {}, 201, registered.device_token);
  assert.match(pairing.pairing_code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

  const redirectUri = 'http://127.0.0.1:9876/oauth/callback';
  const client = await postJson('/register', {
    redirect_uris: [redirectUri],
    client_name: 'Rel.AI local OAuth test',
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  }, 201, '', false);
  assert.match(client.client_id, /^relai_client_[A-Za-z0-9_-]+$/);
  assert.equal(client.token_endpoint_auth_method, 'none');

  const codeVerifier = 'local-flow-verifier-abcdefghijklmnopqrstuvwxyz-0123456789';
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const authorizeUrl = new URL(`${baseUrl}/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client.client_id);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', 'mcp offline_access');
  authorizeUrl.searchParams.set('state', 'state-local-flow');
  authorizeUrl.searchParams.set('resource', protectedResource.resource);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  const authorizationPage = await fetch(authorizeUrl);
  assert.equal(authorizationPage.status, 200);
  assert.match(authorizationPage.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const authorizationHtml = await authorizationPage.text();
  assert.match(authorizationHtml, /Connect Rel\.AI/);
  const requestId = authorizationHtml.match(/name="request_id" value="([^"]+)"/)?.[1];
  assert.match(requestId || '', /^authreq_[A-Za-z0-9_-]+$/);

  const authorizationResult = await postForm('/authorize', {
    request_id: requestId,
    pairing_code: pairing.pairing_code,
    action: 'approve'
  }, 302, { redirect: 'manual' });
  const callback = new URL(authorizationResult.headers.get('location'));
  assert.equal(callback.origin + callback.pathname, redirectUri);
  assert.equal(callback.searchParams.get('state'), 'state-local-flow');
  const authorizationCode = callback.searchParams.get('code');
  assert.match(authorizationCode || '', /^relai_code_[A-Za-z0-9_-]+$/);

  const tokenResponse = await postForm('/token', {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: codeVerifier,
    resource: protectedResource.resource
  }, 200);
  const tokens = await tokenResponse.json();
  assert.match(tokens.access_token, /^relai_access_[A-Za-z0-9_-]+$/);
  assert.match(tokens.refresh_token, /^relai_refresh_[A-Za-z0-9_-]+$/);
  assert.equal(tokens.scope, 'mcp offline_access');
  assert.equal(tokens.token_type, 'Bearer');

  const duplicateCodeResponse = await postForm('/token', {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: codeVerifier,
    resource: protectedResource.resource
  }, 400);
  assert.equal((await duplicateCodeResponse.json()).error, 'invalid_grant');

  const authorizedMcp = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json'
    },
    body: '{}'
  });
  assert.equal(authorizedMcp.status, 503, 'a valid OAuth token must reach the offline device relay');
  assert.equal((await authorizedMcp.json()).error.code, 'DEVICE_OFFLINE');

  const refreshedResponse = await postForm('/token', {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
    resource: protectedResource.resource
  }, 200);
  const refreshed = await refreshedResponse.json();
  assert.match(refreshed.access_token, /^relai_access_[A-Za-z0-9_-]+$/);
  assert.match(refreshed.refresh_token, /^relai_refresh_[A-Za-z0-9_-]+$/);
  assert.notEqual(refreshed.refresh_token, tokens.refresh_token);

  const reusedRefreshResponse = await postForm('/token', {
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: client.client_id,
    resource: protectedResource.resource
  }, 400);
  assert.equal((await reusedRefreshResponse.json()).error, 'invalid_grant');

  await postForm('/revoke', {
    token: refreshed.access_token,
    token_type_hint: 'access_token',
    client_id: client.client_id
  }, 200);
  const revokedMcp = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${refreshed.access_token}`, 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(revokedMcp.status, 401);
  assert.match(revokedMcp.headers.get('www-authenticate') || '', /resource_metadata="https:\/\/rel-ai-cloud\.kynskie13\.workers\.dev\/\.well-known\/oauth-protected-resource"/);

  const secondAuthorize = await fetch(authorizeUrl);
  const secondHtml = await secondAuthorize.text();
  const secondRequestId = secondHtml.match(/name="request_id" value="([^"]+)"/)?.[1];
  const reusedPairing = await postForm('/authorize', {
    request_id: secondRequestId,
    pairing_code: pairing.pairing_code,
    action: 'approve'
  }, 400);
  assert.match(await reusedPairing.text(), /invalid, expired, or already used/);

  const legacyClaim = await fetch(`${baseUrl}/v1/pairings/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairing_code: pairing.pairing_code })
  });
  assert.equal(legacyClaim.status, 404, 'direct pairing-token issuance must remain removed');

  const ticket = await postJson('/v1/devices/connection-ticket', {}, 201, registered.device_token);
  assert.match(ticket.connection_ticket, /^relai_ticket_[A-Za-z0-9_-]+$/);
  assert.equal(ticket.websocket_protocol, `relai-device.${ticket.connection_ticket}`);

  const unauthorizedMcp = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(unauthorizedMcp.status, 401);
  const challengeHeader = unauthorizedMcp.headers.get('www-authenticate') || '';
  assert.match(challengeHeader, /^Bearer /);
  assert.match(challengeHeader, /scope="mcp offline_access"/);
  assert.match(challengeHeader, /resource_metadata=/);

  console.log('Local Cloudflare OAuth flow passed: discovery, DCR, PKCE, pairing, refresh rotation, revocation, and MCP enforcement.');
} finally {
  await stopProcess();
}

async function getJson(pathname, expectedStatus) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const value = await response.json();
  assert.equal(response.status, expectedStatus, `${pathname}: ${JSON.stringify(value)}\n${output}`);
  return value;
}

async function postJson(pathname, body, expectedStatus, bearer = '', expectOk = true) {
  const headers = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, `${pathname}: ${JSON.stringify(value)}\n${output}`);
  if (expectOk) assert.equal(value.ok, true, `${pathname}: ${JSON.stringify(value)}`);
  return value;
}

async function postForm(pathname, values, expectedStatus, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
    redirect: options.redirect || 'follow'
  });
  assert.equal(response.status, expectedStatus, `${pathname}: ${await response.clone().text()}\n${output}`);
  return response;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode != null) throw new Error(`Wrangler exited before becoming ready.\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Wrangler did not become ready.\n${output}`);
}

async function stopProcess() {
  if (processHandle.exitCode != null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], {
      encoding: 'utf8',
      windowsHide: true
    });
  } else {
    processHandle.kill('SIGTERM');
  }
  await Promise.race([
    new Promise(resolve => processHandle.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000))
  ]);
  if (processHandle.exitCode == null && process.platform !== 'win32') processHandle.kill('SIGKILL');
}
