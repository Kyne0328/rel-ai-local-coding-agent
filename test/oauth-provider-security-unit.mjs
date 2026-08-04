import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oauth-provider-security-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = stateDir;

const issuer = 'https://issuer.example.test';
const otherIssuer = 'https://other.example.test';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';

function pkcePair() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

try {
  const oauth = await import('../src/oauthProvider.js');
  const client = oauth.registerClient({
    application_type: 'web',
    client_name: 'OAuth Provider Security Test',
    redirect_uris: [redirectUri],
    scope: 'mcp'
  }, issuer);
  assert.ok(client.client_id);
  assert.equal(client.issuer, issuer);

  const baseQuery = {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    resource: `${issuer}/mcp`,
    state: 'preserved-state'
  };

  const wrongIssuer = oauth.validateAuthorizationRequest({
    ...baseQuery,
    code_challenge: pkcePair().challenge,
    resource: `${otherIssuer}/mcp`
  }, { issuer: otherIssuer });
  assert.equal(wrongIssuer.error, 'invalid_client');
  assert.equal(wrongIssuer.recovery.reason, 'issuer_changed');

  const redirectMismatch = oauth.validateAuthorizationRequest({
    ...baseQuery,
    redirect_uri: 'https://chatgpt.com/not-registered',
    code_challenge: pkcePair().challenge
  }, { issuer });
  assert.equal(redirectMismatch.error, 'invalid_request');

  const missingPkce = oauth.validateAuthorizationRequest(baseQuery, { issuer });
  assert.equal(missingPkce.error, 'invalid_request');

  const firstPair = pkcePair();
  const firstRequest = oauth.validateAuthorizationRequest({
    ...baseQuery,
    code_challenge: firstPair.challenge,
    scope: 'mcp'
  }, { issuer });
  assert.equal(firstRequest.ok, true);
  assert.equal(firstRequest.request.scope, 'mcp');
  assert.equal(firstRequest.request.state, 'preserved-state');

  const firstCode = oauth.issueAuthorizationCode(firstRequest.request, issuer);
  const firstExchange = oauth.exchangeToken({
    grant_type: 'authorization_code',
    code: firstCode,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: firstPair.verifier
  }, issuer);
  assert.equal(firstExchange.status, 200);
  assert.ok(firstExchange.body.access_token);
  assert.ok(firstExchange.body.refresh_token);
  assert.equal(firstExchange.body.scope, 'mcp');

  const replay = oauth.exchangeToken({
    grant_type: 'authorization_code',
    code: firstCode,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: firstPair.verifier
  }, issuer);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'invalid_grant');

  const stepUpPair = pkcePair();
  const stepUpRequest = oauth.validateAuthorizationRequest({
    ...baseQuery,
    code_challenge: stepUpPair.challenge,
    scope: 'offline_access'
  }, { issuer });
  assert.equal(stepUpRequest.ok, true);
  assert.equal(stepUpRequest.request.scope, 'mcp offline_access');

  const stepUpCode = oauth.issueAuthorizationCode(stepUpRequest.request, issuer);
  const stepUpExchange = oauth.exchangeToken({
    grant_type: 'authorization_code',
    code: stepUpCode,
    redirect_uri: redirectUri,
    client_id: client.client_id,
    code_verifier: stepUpPair.verifier
  }, issuer);
  assert.equal(stepUpExchange.status, 200);
  assert.ok(stepUpExchange.body.access_token);
  assert.ok(stepUpExchange.body.refresh_token);
  assert.equal(stepUpExchange.body.scope, 'mcp offline_access');

  assert.ok(oauth.validateAccessToken(stepUpExchange.body.access_token, issuer));
  assert.equal(oauth.validateAccessToken(stepUpExchange.body.access_token, otherIssuer), null);

  const refreshed = oauth.exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: stepUpExchange.body.refresh_token,
    client_id: client.client_id,
    scope: 'mcp offline_access'
  }, issuer);
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.refresh_token);
  assert.notEqual(refreshed.body.refresh_token, stepUpExchange.body.refresh_token);

  const reusedRefresh = oauth.exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: stepUpExchange.body.refresh_token,
    client_id: client.client_id
  }, issuer);
  assert.equal(reusedRefresh.status, 400);
  assert.equal(reusedRefresh.body.error, 'invalid_grant');

  const redirect = new URL(oauth.buildRedirectUrl(redirectUri, {
    code: 'redacted-code',
    state: 'preserved-state',
    iss: issuer
  }));
  assert.equal(redirect.searchParams.get('state'), 'preserved-state');
  assert.equal(redirect.searchParams.get('iss'), issuer);

  const stored = JSON.parse(fs.readFileSync(path.join(stateDir, 'oauth-store.json'), 'utf8'));
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes(stepUpExchange.body.access_token), false);
  assert.equal(serialized.includes(stepUpExchange.body.refresh_token), false);
  assert.ok(Object.keys(stored.accessTokens).every(key => /^sha256:[a-f0-9]{64}$/.test(key)));
  assert.ok(Object.keys(stored.refreshTokens).every(key => /^sha256:[a-f0-9]{64}$/.test(key)));
} finally {
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('OAuth PKCE, issuer binding, redirect matching, replay prevention, scope accumulation, refresh rotation, and token binding passed.');
