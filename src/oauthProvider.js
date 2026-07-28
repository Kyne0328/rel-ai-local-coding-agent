

// OAuth 2.1 authorization server for the MCP 2026-07-28 hard-cutover release.
// Client registrations, authorization codes, access tokens, and refresh tokens are
// bound to one canonical issuer. An issuer change intentionally invalidates prior
// registrations so the client performs Dynamic Client Registration again.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const SCOPE = 'mcp';
const OFFLINE_SCOPE = 'offline_access';
const SUPPORTED_SCOPES = Object.freeze([SCOPE, OFFLINE_SCOPE]);
const STORE_MAPS = ['clients', 'codes', 'accessTokens', 'refreshTokens'];
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10;
const LOCK_TIMEOUT_MS = 5_000;
const lockSleeper = new Int32Array(new SharedArrayBuffer(4));

function stateDir() {
  return process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp');
}

function storePath() {
  return path.join(stateDir(), 'oauth-store.json');
}

function lockPath() {
  return path.join(stateDir(), 'oauth-store.lock');
}

function emptyStore() {
  return {
    version: 4,
    clients: Object.create(null),
    codes: Object.create(null),
    accessTokens: Object.create(null),
    refreshTokens: Object.create(null),
    approvalRequiredAt: null,
    lastApprovedAt: null
  };
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nullProtoMap(value) {
  return Object.assign(Object.create(null), objectOrEmpty(value));
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    const store = { ...emptyStore(), ...objectOrEmpty(parsed), version: 4 };
    for (const key of STORE_MAPS) store[key] = nullProtoMap(store[key]);
    for (const key of ['codes', 'accessTokens', 'refreshTokens']) store[key] = migrateSecretMap(store[key]);
    return store;
  } catch {
    return emptyStore();
  }
}

function secretKey(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function migrateSecretMap(value) {
  const migrated = Object.create(null);
  for (const [key, entry] of Object.entries(value || {})) {
    migrated[/^sha256:[a-f0-9]{64}$/.test(key) ? key : secretKey(key)] = entry;
  }
  return migrated;
}

function writeStore(store) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const target = storePath();
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function withStoreLock(callback) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const file = lockPath();
  const started = Date.now();
  let descriptor = null;
  while (descriptor == null) {
    try {
      descriptor = fs.openSync(file, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(file);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(file, { force: true });
          continue;
        }
      } catch {}
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error('OAuth state is busy. Retry the request.', { cause: error });
      Atomics.wait(lockSleeper, 0, 0, LOCK_WAIT_MS);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(file, { force: true }); } catch {}
  }
}

function canonicalIssuer(value) {
  const url = new URL(String(value || ''));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('OAuth issuer must use HTTP or HTTPS.');
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error('OAuth issuer must use HTTPS except for loopback development addresses.');
  }
  url.hash = '';
  url.search = '';
  while (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString().replace(/\/$/, '');
}

function resourceForIssuer(issuer) {
  return `${canonicalIssuer(issuer)}/mcp`;
}

function liveEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (!Number.isFinite(Number(entry.expiresAt)) || Number(entry.expiresAt) <= Date.now()) return null;
  return entry;
}

function pruneStore(store) {
  const now = Date.now();
  for (const key of ['codes', 'accessTokens', 'refreshTokens']) {
    for (const [id, entry] of Object.entries(store[key] || {})) {
      if (!entry || Number(entry.expiresAt || 0) <= now) delete store[key][id];
    }
  }
  const referenced = new Set();
  for (const key of ['codes', 'accessTokens', 'refreshTokens']) {
    for (const entry of Object.values(store[key] || {})) if (entry?.clientId) referenced.add(entry.clientId);
  }
  for (const [clientId, client] of Object.entries(store.clients || {})) {
    const createdAt = Number(client?.created_at || 0);
    if (!referenced.has(clientId) && (!createdAt || now - createdAt > REFRESH_TOKEN_TTL_MS)) delete store.clients[clientId];
  }
  return store;
}

function randomId(prefix, bytes = 32) {
  return `${prefix}${crypto.randomBytes(bytes).toString('base64url')}`;
}

function base64UrlSha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('base64url');
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a == null ? '' : a));
  const right = Buffer.from(String(b == null ? '' : b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeScope(value, options = {}) {
  const requested = String(value || '').split(/\s+/).map(item => item.trim()).filter(Boolean);
  const scopes = new Set(options.defaults || []);
  for (const scope of requested) {
    if (!SUPPORTED_SCOPES.includes(scope)) throw oauthProtocolError('invalid_scope', `Unsupported scope: ${scope}`);
    scopes.add(scope);
  }
  scopes.add(SCOPE);
  return [...SUPPORTED_SCOPES].filter(scope => scopes.has(scope)).join(' ');
}

function scopeSet(value) {
  return new Set(String(value || '').split(/\s+/).filter(Boolean));
}

function unionScope(...values) {
  const combined = new Set();
  for (const value of values) for (const scope of scopeSet(value)) combined.add(scope);
  return [...SUPPORTED_SCOPES].filter(scope => combined.has(scope)).join(' ');
}

function oauthProtocolError(error, description) {
  const value = new Error(description);
  value.oauthError = error;
  return value;
}

// ---- Discovery -------------------------------------------------------------

function protectedResourceMetadata(baseUrl) {
  const issuer = canonicalIssuer(baseUrl);
  return {
    resource: resourceForIssuer(issuer),
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: SUPPORTED_SCOPES,
    resource_documentation: `${issuer}/dashboard`
  };
}

function authorizationServerMetadata(baseUrl) {
  const issuer = canonicalIssuer(baseUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SUPPORTED_SCOPES,
    application_types_supported: ['native', 'web'],
    authorization_response_iss_parameter_supported: true
  };
}

function wwwAuthenticateHeader(baseUrl, error, scope = '') {
  const issuer = canonicalIssuer(baseUrl);
  const parts = [`Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`];
  if (error) parts.push(`error="${error}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return parts.join(', ');
}

// ---- Dynamic Client Registration ------------------------------------------

function registerClient(body = {}, baseUrl) {
  const issuer = canonicalIssuer(baseUrl);
  const applicationType = String(body.application_type || '').trim();
  if (!['native', 'web'].includes(applicationType)) {
    return { error: 'invalid_client_metadata', error_description: 'application_type must be native or web.' };
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).filter(Boolean) : [];
  if (redirectUris.length === 0) return { error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required.' };
  for (const uri of redirectUris) {
    let parsed;
    try { parsed = new URL(uri); } catch { return { error: 'invalid_redirect_uri', error_description: `Invalid redirect_uri: ${uri}` }; }
    if (applicationType === 'web' && parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
      return { error: 'invalid_redirect_uri', error_description: 'Web redirect URIs must use HTTPS except loopback development addresses.' };
    }
    if (applicationType === 'native' && !['https:', 'http:'].includes(parsed.protocol)) {
      return { error: 'invalid_redirect_uri', error_description: 'Native redirect URIs must use HTTP or HTTPS in this release.' };
    }
  }
  return withStoreLock(() => {
    const store = pruneStore(readStore());
    const clientId = randomId('relai_client_', 24);
    const createdAt = Date.now();
    const requestedScope = normalizeScope(body.scope, { defaults: [SCOPE] });
    const client = {
      client_id: clientId,
      issuer,
      application_type: applicationType,
      redirect_uris: redirectUris,
      client_name: typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : '',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      registered_scope: requestedScope,
      granted_scope: '',
      created_at: createdAt
    };
    store.clients[clientId] = client;
    writeStore(store);
    return {
      client_id: clientId,
      client_id_issued_at: Math.floor(createdAt / 1000),
      application_type: applicationType,
      redirect_uris: redirectUris,
      grant_types: client.grant_types,
      response_types: client.response_types,
      token_endpoint_auth_method: 'none',
      scope: requestedScope,
      issuer
    };
  });
}

function isLoopbackHost(hostname) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

// ---- Authorization ---------------------------------------------------------

function oauthError(error, description, redirectError = false, extras = {}) {
  return { ok: false, redirectError, error, error_description: description, ...extras };
}

function validateAuthorizationRequest(query = {}, options = {}) {
  const issuer = canonicalIssuer(options.issuer);
  const store = pruneStore(readStore());
  const clientId = String(query.client_id || '');
  const client = clientId && Object.hasOwn(store.clients, clientId) ? store.clients[clientId] : null;
  if (!client || client.issuer !== issuer) {
    return oauthError('invalid_client', 'Unknown client_id for this issuer. Register the client again.');
  }
  const redirectUri = String(query.redirect_uri || '');
  if (!redirectUri || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
    return oauthError('invalid_request', 'redirect_uri does not match a registered value.');
  }
  if (String(query.response_type || '') !== 'code') {
    return oauthError('unsupported_response_type', 'Only response_type=code is supported.', true, { redirectUri, state: query.state, issuer });
  }
  const codeChallenge = String(query.code_challenge || '');
  if (!codeChallenge || String(query.code_challenge_method || '') !== 'S256') {
    return oauthError('invalid_request', 'PKCE with code_challenge_method=S256 is required.', true, { redirectUri, state: query.state, issuer });
  }
  const resource = String(query.resource || resourceForIssuer(issuer));
  if (resource !== resourceForIssuer(issuer)) {
    return oauthError('invalid_target', 'resource must identify this MCP endpoint.', true, { redirectUri, state: query.state, issuer });
  }
  let requestedScope;
  try { requestedScope = normalizeScope(query.scope, { defaults: scopeSet(client.registered_scope) }); }
  catch (error) { return oauthError(error.oauthError || 'invalid_scope', error.message, true, { redirectUri, state: query.state, issuer }); }
  const accumulatedScope = unionScope(client.granted_scope, requestedScope);
  return {
    ok: true,
    request: {
      issuer,
      clientId,
      clientName: client.client_name || 'ChatGPT connector',
      redirectUri,
      state: query.state != null ? String(query.state) : '',
      codeChallenge,
      resource,
      scope: accumulatedScope,
      applicationType: client.application_type
    }
  };
}

function issueAuthorizationCode(request, baseUrl) {
  const issuer = canonicalIssuer(baseUrl || request.issuer);
  return withStoreLock(() => {
    const store = pruneStore(readStore());
    const client = store.clients[request.clientId];
    if (!client || client.issuer !== issuer) throw new Error('OAuth client registration is not valid for the current issuer.');
    client.granted_scope = unionScope(client.granted_scope, request.scope);
    store.approvalRequiredAt = null;
    store.lastApprovedAt = Date.now();
    const code = randomId('relai_code_', 32);
    store.codes[secretKey(code)] = {
      issuer,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      resource: request.resource,
      scope: client.granted_scope,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS
    };
    writeStore(store);
    return code;
  });
}

function buildRedirectUrl(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params || {})) if (value != null && value !== '') url.searchParams.set(key, value);
  return url.toString();
}

// ---- Token Endpoint --------------------------------------------------------

function issueTokens(store, { issuer, clientId, scope, resource, issueRefresh = true }) {
  const now = Date.now();
  const accessToken = randomId('relai_at_', 32);
  store.accessTokens[secretKey(accessToken)] = {
    issuer,
    clientId,
    scope,
    resource,
    issuedAt: now,
    expiresAt: now + ACCESS_TOKEN_TTL_MS
  };
  const result = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope,
    resource
  };
  if (issueRefresh && scopeSet(scope).has(OFFLINE_SCOPE)) {
    const refreshToken = randomId('relai_rt_', 32);
    store.refreshTokens[secretKey(refreshToken)] = {
      issuer,
      clientId,
      scope,
      resource,
      issuedAt: now,
      expiresAt: now + REFRESH_TOKEN_TTL_MS
    };
    result.refresh_token = refreshToken;
  }
  return result;
}

function exchangeAuthorizationCode(store, body, issuer) {
  const code = String(body.code || '');
  const codeKey = secretKey(code);
  const entry = code && Object.hasOwn(store.codes, codeKey) ? store.codes[codeKey] : null;
  if (!entry || typeof entry !== 'object') return tokenError('invalid_grant', 'Authorization code is invalid or expired.');
  delete store.codes[codeKey];
  if (!liveEntry(entry) || entry.issuer !== issuer) {
    writeStore(store);
    return tokenError('invalid_grant', 'Authorization code is invalid for this issuer or expired.');
  }
  const client = store.clients[entry.clientId];
  if (!client || client.issuer !== issuer || String(body.client_id || '') !== entry.clientId) {
    writeStore(store);
    return tokenError('invalid_grant', 'client_id does not match the issuer-bound authorization code.');
  }
  if (String(body.redirect_uri || '') !== entry.redirectUri) {
    writeStore(store);
    return tokenError('invalid_grant', 'redirect_uri does not match the authorization request.');
  }
  const verifier = String(body.code_verifier || '');
  if (!verifier || base64UrlSha256(verifier) !== entry.codeChallenge) {
    writeStore(store);
    return tokenError('invalid_grant', 'PKCE verification failed.');
  }
  const tokens = issueTokens(store, {
    issuer,
    clientId: entry.clientId,
    scope: entry.scope,
    resource: entry.resource,
    issueRefresh: true
  });
  writeStore(store);
  return { status: 200, body: tokens };
}

function exchangeRefreshToken(store, body, issuer) {
  const refreshToken = String(body.refresh_token || '');
  const refreshTokenKey = secretKey(refreshToken);
  const entry = refreshToken ? liveEntry(store.refreshTokens[refreshTokenKey]) : null;
  if (!entry || entry.issuer !== issuer) return tokenError('invalid_grant', 'Refresh token is invalid for this issuer or expired.');
  const client = store.clients[entry.clientId];
  if (!client || client.issuer !== issuer || String(body.client_id || '') !== entry.clientId) {
    return tokenError('invalid_grant', 'client_id does not match the issuer-bound refresh token.');
  }
  let scope = entry.scope;
  if (body.scope != null && String(body.scope).trim()) {
    let requested;
    try { requested = normalizeScope(body.scope, { defaults: [] }); }
    catch (error) { return tokenError(error.oauthError || 'invalid_scope', error.message); }
    const granted = scopeSet(entry.scope);
    if ([...scopeSet(requested)].some(item => !granted.has(item))) return tokenError('invalid_scope', 'Refresh requests cannot expand the original grant. Start a new authorization request for step-up scopes.');
    scope = requested;
  }
  delete store.refreshTokens[refreshTokenKey];
  const tokens = issueTokens(store, {
    issuer,
    clientId: entry.clientId,
    scope,
    resource: entry.resource,
    issueRefresh: true
  });
  writeStore(store);
  return { status: 200, body: tokens };
}

function exchangeToken(body = {}, baseUrl) {
  const issuer = canonicalIssuer(baseUrl);
  return withStoreLock(() => {
    const store = pruneStore(readStore());
    const grantType = String(body.grant_type || '');
    if (grantType === 'authorization_code') return exchangeAuthorizationCode(store, body, issuer);
    if (grantType === 'refresh_token') return exchangeRefreshToken(store, body, issuer);
    return tokenError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`);
  });
}

function tokenError(error, errorDescription) {
  return { status: 400, body: { error, error_description: errorDescription } };
}

// ---- Resource Server -------------------------------------------------------

function validateAccessToken(token, baseUrl) {
  if (!token || !baseUrl) return null;
  const issuer = canonicalIssuer(baseUrl);
  const entry = liveEntry(readStore().accessTokens[secretKey(token)]);
  if (!entry || entry.issuer !== issuer || entry.resource !== resourceForIssuer(issuer)) return null;
  return entry;
}

// ---- Authorization State --------------------------------------------------

function authorizationStatus() {
  const store = pruneStore(readStore());
  return {
    required: Number(store.approvalRequiredAt || 0) > 0,
    approvalRequiredAt: Number(store.approvalRequiredAt || 0) || null,
    lastApprovedAt: Number(store.lastApprovedAt || 0) || null,
    activeAccessTokens: Object.keys(store.accessTokens || {}).length,
    activeRefreshTokens: Object.keys(store.refreshTokens || {}).length,
    registeredClients: Object.keys(store.clients || {}).length
  };
}

function revokeAuthorizations() {
  return withStoreLock(() => {
    const store = pruneStore(readStore());
    const revoked = {
      authorizationCodes: Object.keys(store.codes || {}).length,
      accessTokens: Object.keys(store.accessTokens || {}).length,
      refreshTokens: Object.keys(store.refreshTokens || {}).length,
      registeredClients: Object.keys(store.clients || {}).length
    };
    store.clients = Object.create(null);
    store.codes = Object.create(null);
    store.accessTokens = Object.create(null);
    store.refreshTokens = Object.create(null);
    store.approvalRequiredAt = Date.now();
    writeStore(store);
    return revoked;
  });
}

// ---- Approval UI -----------------------------------------------------------

function renderLoginPage(request, baseUrl, options = {}) {
  const hidden = {
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    resource: request.resource,
    scope: request.scope
  };
  const hiddenInputs = Object.entries(hidden).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('\n      ');
  const errorHtml = options.error ? `<div class="oauth-error">${escapeHtml(options.error)}</div>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize Rel.AI MCP</title>
<link rel="stylesheet" href="/public/oauth.css"></head>
<body class="oauth-page"><form class="oauth-card" method="POST" action="${escapeHtml(canonicalIssuer(baseUrl))}/authorize"><h1>Authorize ChatGPT</h1><p>Connect this issuer-bound ChatGPT client to your local Rel.AI MCP workspaces.</p>${errorHtml}<label for="dashboard_token">Approval token</label><input id="dashboard_token" name="dashboard_token" type="password" autocomplete="off" autofocus required>${hiddenInputs}<button type="submit">Approve connection</button><div class="oauth-client">Client: ${escapeHtml(request.clientName || request.clientId)}<br>Scopes: ${escapeHtml(request.scope)}</div></form></body></html>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function verifyLogin(submittedToken, serverToken) {
  if (!serverToken) return true;
  return timingSafeEqual(submittedToken, serverToken);
}

export { protectedResourceMetadata, authorizationServerMetadata, wwwAuthenticateHeader, registerClient, validateAuthorizationRequest, issueAuthorizationCode, buildRedirectUrl, exchangeToken, validateAccessToken, renderLoginPage, verifyLogin, authorizationStatus, revokeAuthorizations, canonicalIssuer, resourceForIssuer, normalizeScope, SCOPE, OFFLINE_SCOPE, SUPPORTED_SCOPES, secretKey };