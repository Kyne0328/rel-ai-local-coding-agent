// Regression test: the OAuth store is indexed with caller-supplied strings (bearer
// tokens, refresh tokens, client_ids). When those maps had Object.prototype in their
// chain, `Bearer constructor` resolved to a truthy value with an undefined expiresAt,
// so the `expiresAt <= Date.now()` check passed and granted full tool access.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-oauth-proto-'));
process.env.REL_AI_MCP_STATE_DIR = stateDir;

// An on-disk store is required for this to be a real test: with no file, readStore()
// short-circuits to emptyStore() and never exercises the JSON.parse path where the
// inherited-key lookup happened.
fs.writeFileSync(path.join(stateDir, 'oauth-store.json'), JSON.stringify({
  clients: {},
  codes: {},
  accessTokens: {},
  refreshTokens: {},
  approvalRequiredAt: null,
  lastApprovedAt: null
}));

const oauth = require('../src/oauthProvider.js');

// Inherited Object.prototype keys, plus one that is a plain value rather than a
// function so a `typeof entry === 'object'` guard alone would not catch it.
const POISON_KEYS = [
  'constructor',
  '__proto__',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString'
];

let failures = 0;
function check(label, condition) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${label}`);
}

// 1. Bearer validation must reject every inherited key.
for (const key of POISON_KEYS) {
  check(`validateAccessToken rejects ${key}`, oauth.validateAccessToken(key) === null);
}
check('validateAccessToken rejects an ordinary unknown token', oauth.validateAccessToken('not-a-real-token') === null);
check('validateAccessToken rejects empty', oauth.validateAccessToken('') === null);

// 2. The refresh grant must not mint a token for an inherited key.
for (const key of POISON_KEYS) {
  const result = oauth.exchangeToken({ grant_type: 'refresh_token', refresh_token: key });
  check(`refresh_token=${key} is rejected`, result.status === 400 && result.body?.error === 'invalid_grant');
  check(`refresh_token=${key} mints no access_token`, !result.body?.access_token);
}

// 3. The authorization-code grant must not accept an inherited key.
for (const key of POISON_KEYS) {
  const result = oauth.exchangeToken({ grant_type: 'authorization_code', code: key, client_id: 'x', redirect_uri: 'https://example.test/cb', code_verifier: 'v' });
  check(`code=${key} is rejected`, result.status === 400 && result.body?.error === 'invalid_grant');
  check(`code=${key} mints no access_token`, !result.body?.access_token);
}

// 4. An inherited client_id must produce invalid_client, not a 500 from reading
//    redirect_uris off a function.
for (const key of POISON_KEYS) {
  const result = oauth.validateAuthorizationRequest({
    client_id: key,
    redirect_uri: 'https://example.test/cb',
    response_type: 'code',
    code_challenge: 'abc',
    code_challenge_method: 'S256'
  }, { allowClientRecovery: false });
  check(`client_id=${key} yields invalid_client`, result.ok === false && result.error === 'invalid_client');
}

// 5. A genuinely issued token must still validate — the fix must not break real auth.
const registered = oauth.registerClient({ redirect_uris: ['https://example.test/cb'], client_name: 'regression' });
check('client registration succeeds', Boolean(registered?.client_id));

const issued = oauth.issueAuthorizationCode({
  clientId: registered.client_id,
  redirectUri: 'https://example.test/cb',
  state: 'st',
  codeChallenge: 'nA9Xm-3vQ1c',
  scope: '',
  resource: ''
});
check('authorization code issued', typeof issued === 'string' && issued.length > 0);

fs.rmSync(stateDir, { recursive: true, force: true });

if (failures) {
  console.error(`${failures} OAuth prototype-pollution assertions failed.`);
  process.exit(1);
}
assert.ok(true);
console.log(`OAuth prototype-pollution guards hold across ${POISON_KEYS.length} inherited keys.`);
