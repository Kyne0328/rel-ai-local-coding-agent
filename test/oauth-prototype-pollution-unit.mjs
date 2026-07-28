import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oauth-proto-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;
import * as oauth from "../src/oauthProvider.js";
const issuer = 'https://relai.example.test';
const poisonKeys = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'];

try {
  fs.writeFileSync(path.join(stateDir, 'oauth-store.json'), JSON.stringify({ version: 3, clients: {}, codes: {}, accessTokens: {}, refreshTokens: {} }));
  for (const key of poisonKeys) {
    assert.equal(oauth.validateAccessToken(key, issuer), null);
    const refresh = oauth.exchangeToken({ grant_type: 'refresh_token', refresh_token: key, client_id: key }, issuer);
    assert.equal(refresh.status, 400);
    assert.equal(refresh.body.error, 'invalid_grant');
    const code = oauth.exchangeToken({ grant_type: 'authorization_code', code: key, client_id: key, redirect_uri: 'https://example.test/cb', code_verifier: 'v' }, issuer);
    assert.equal(code.status, 400);
    assert.equal(code.body.error, 'invalid_grant');
    const authorization = oauth.validateAuthorizationRequest({
      client_id: key,
      redirect_uri: 'https://example.test/cb',
      response_type: 'code',
      code_challenge: 'abc',
      code_challenge_method: 'S256'
    }, { issuer });
    assert.equal(authorization.ok, false);
    assert.equal(authorization.error, 'invalid_client');
  }

  const client = oauth.registerClient({ application_type: 'web', redirect_uris: ['https://example.test/cb'], client_name: 'regression' }, issuer);
  assert.ok(client.client_id);
  assert.equal(client.issuer, issuer);
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log(`OAuth prototype-pollution guards hold across ${poisonKeys.length} inherited keys.`);
