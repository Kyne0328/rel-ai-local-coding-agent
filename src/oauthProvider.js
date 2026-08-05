

// OAuth 2.1 authorization server for the MCP 2026-07-28 stateless HTTP release.
// Client registrations, authorization codes, access tokens, and refresh tokens are
// bound to one canonical issuer. An issuer change intentionally invalidates prior
// registrations so the client performs Dynamic Client Registration again.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createLocalAdminPolicy, normalizeAuthorizationPolicy } from './mcp/authorizationPolicy.js';

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const SCOPE = 'mcp';
const OFFLINE_SCOPE = 'offline_access';
const SUPPORTED_SCOPES = Object.freeze([SCOPE, OFFLINE_SCOPE]);
const STORE_VERSION = 7;
const STORE_MAPS = ['clients', 'codes', 'accessTokens', 'refreshTokens', 'registrationAttempts'];
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 10;
const LOCK_TIMEOUT_MS = 5_000;
const lockSleeper = new Int32Array(new SharedArrayBuffer(4));

// These limits support repeated connector recreation while bounding durable public DCR cost.
const DCR_LIMITS = Object.freeze({
  perIssuerClients: 64,
  globalClients: 256,
  metadataBytes: 16 * 1024,
  storeBytes: 4 * 1024 * 1024,
  staleRegistrationMs: 90 * 24 * 60 * 60 * 1000,
  rateWindowMs: 10 * 60 * 1000,
  rateMax: 100
});

class OAuthStoreError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = 'OAuthStoreError';
    this.code = code;
    this.details = details;
    this.retryable = details.retryable === true;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...this.details
    };
  }
}

function stateDir() {
  return process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp');
}

function storePath() {
  return path.join(stateDir(), 'oauth-store.json');
}

function lockPath() {
  return path.join(stateDir(), 'oauth-store.lock');
}

function backupPath() {
  return `${storePath()}.bak`;
}

function recoveryMarkerPath() {
  return `${storePath()}.recovery-required.json`;
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    clients: Object.create(null),
    codes: Object.create(null),
    accessTokens: Object.create(null),
    refreshTokens: Object.create(null),
    registrationAttempts: Object.create(null),
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
  const target = storePath();
  let text;
  try {
    text = fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const recovery = readRecoveryMarker();
      if (recovery) {
        throw new OAuthStoreError(
          'OAUTH_STORE_RECOVERY_REQUIRED',
          'OAuth registration state remains quarantined and requires an explicit recovery action.',
          { ...recovery, path: target, retryable: false }
        );
      }
      return recoverInterruptedWrite(target) || emptyStore();
    }
    throw storeReadError(error, target);
  }
  return parseStoreText(text, target, { recover: true });
}

function parseStoreText(text, target, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const code = !String(text || '').trim().endsWith('}') ? 'OAUTH_STORE_TRUNCATED' : 'OAUTH_STORE_MALFORMED';
    if (options.recover !== false) return recoverMalformedStore(target, text, error, code);
    throw new OAuthStoreError(code, 'OAuth registration state is malformed.', { path: target, retryable: false }, { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OAuthStoreError('OAUTH_STORE_MALFORMED', 'OAuth registration state must be a JSON object.', { path: target, retryable: false });
  }
  const persistedVersion = Number(parsed.version);
  if (!Number.isInteger(persistedVersion) || persistedVersion < 1) {
    throw new OAuthStoreError('OAUTH_STORE_MIGRATION_FAILED', 'OAuth registration state has no supported schema version and cannot be migrated safely.', {
      path: target,
      schemaVersion: parsed.version,
      retryable: false
    });
  }
  if (persistedVersion > STORE_VERSION) {
    throw new OAuthStoreError('OAUTH_STORE_UNSUPPORTED_SCHEMA', `OAuth store schema ${persistedVersion} is newer than supported schema ${STORE_VERSION}.`, {
      path: target,
      schemaVersion: persistedVersion,
      supportedSchemaVersion: STORE_VERSION,
      retryable: false
    });
  }
  let store;
  try {
    store = { ...emptyStore(), ...objectOrEmpty(parsed), version: STORE_VERSION };
    for (const key of STORE_MAPS) store[key] = nullProtoMap(store[key]);
    for (const key of ['codes', 'accessTokens', 'refreshTokens']) store[key] = migrateSecretMap(store[key]);
    store.registrationAttempts = normalizeRegistrationAttempts(store.registrationAttempts);
    const repairedLegacyGrants = repairLegacyGrantRecords(store);
    if (requiresAuthorizationReset(parsed, store)) {
      const reset = resetAuthorizationStore(parsed, store);
      writeStore(reset);
      return reset;
    }
    if (repairedLegacyGrants) writeStore(store);
  } catch (error) {
    if (error instanceof OAuthStoreError) throw error;
    throw new OAuthStoreError('OAUTH_STORE_MIGRATION_FAILED', 'OAuth registration state could not be migrated safely.', {
      path: target,
      schemaVersion: persistedVersion,
      retryable: false
    }, { cause: error });
  }
  return store;
}

function storeReadError(error, target) {
  const denied = error?.code === 'EACCES' || error?.code === 'EPERM';
  return new OAuthStoreError(
    denied ? 'OAUTH_STORE_ACCESS_DENIED' : 'OAUTH_STORE_READ_FAILED',
    denied ? 'OAuth registration state cannot be read because access was denied.' : 'OAuth registration state could not be read.',
    { path: target, fsCode: String(error?.code || ''), retryable: !denied },
    { cause: error }
  );
}

function recoverMalformedStore(target, text, parseError, code) {
  const quarantine = `${target}.corrupt-${Date.now()}-${process.pid}.json`;
  try {
    fs.renameSync(target, quarantine);
  } catch (error) {
    throw new OAuthStoreError(code, 'OAuth registration state is malformed and could not be quarantined.', {
      path: target,
      fsCode: String(error?.code || ''),
      retryable: false
    }, { cause: parseError });
  }
  if (fs.existsSync(backupPath())) {
    try {
      const backupText = fs.readFileSync(backupPath(), 'utf8');
      const recovered = parseStoreText(backupText, backupPath(), { recover: false });
      fs.copyFileSync(backupPath(), target);
      clearRecoveryMarker();
      return recovered;
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] OAuth backup recovery failed:', error);
    }
  }
  const recovery = {
    detectedAt: new Date().toISOString(),
    reason: code,
    quarantinePath: quarantine,
    backupPath: backupPath()
  };
  writeRecoveryMarker(recovery);
  throw new OAuthStoreError(code, 'OAuth registration state was quarantined because it is malformed. Restore the backup or perform an explicit OAuth-store reset before re-registering clients.', {
    path: target,
    ...recovery,
    recoveryAction: 'resetOAuthStoreAfterCorruption',
    retryable: false
  }, { cause: parseError });
}

function readRecoveryMarker() {
  try {
    const value = JSON.parse(fs.readFileSync(recoveryMarkerPath(), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new OAuthStoreError('OAUTH_STORE_RECOVERY_MARKER_INVALID', 'OAuth store recovery metadata is unreadable.', {
      path: recoveryMarkerPath(),
      fsCode: String(error?.code || ''),
      retryable: false
    }, { cause: error });
  }
}

function writeRecoveryMarker(value) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const target = recoveryMarkerPath();
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw new OAuthStoreError('OAUTH_STORE_RECOVERY_MARKER_WRITE_FAILED', 'OAuth store recovery metadata could not be persisted.', {
      path: target,
      fsCode: String(error?.code || ''),
      retryable: false
    }, { cause: error });
  }
}

function clearRecoveryMarker() {
  try { fs.rmSync(recoveryMarkerPath(), { force: true }); } catch {}
}

function oauthStoreRecoveryStatus() {
  const recovery = readRecoveryMarker();
  return { required: Boolean(recovery), ...(recovery || {}) };
}

function resetOAuthStoreAfterCorruption(options = {}) {
  if (options.confirm !== true) {
    throw new OAuthStoreError('OAUTH_STORE_RESET_CONFIRMATION_REQUIRED', 'Explicit confirmation is required before resetting quarantined OAuth registration state.', {
      retryable: false
    });
  }
  return withStoreLock(() => {
    const recovery = readRecoveryMarker();
    if (!recovery) return { reset: false, reason: 'not_required' };
    writeStore(emptyStore());
    try { fs.rmSync(backupPath(), { force: true }); } catch {}
    clearRecoveryMarker();
    return {
      reset: true,
      reason: recovery.reason || 'corrupt_store',
      quarantinePath: recovery.quarantinePath || '',
      registeredClients: 0
    };
  });
}

function recoverInterruptedWrite(target) {
  const directory = path.dirname(target);
  let candidates;
  try {
    candidates = fs.readdirSync(directory)
      .filter(name => name.startsWith(`${path.basename(target)}.`) && name.endsWith('.tmp'))
      .map(name => path.join(directory, name))
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw storeReadError(error, target);
  }
  for (const candidate of candidates) {
    try {
      const recovered = parseStoreText(fs.readFileSync(candidate, 'utf8'), candidate, { recover: false });
      fs.renameSync(candidate, target);
      for (const other of candidates) if (other !== candidate) try { fs.rmSync(other, { force: true }); } catch {}
      return recovered;
    } catch {}
  }
  if (candidates.length) {
    throw new OAuthStoreError('OAUTH_STORE_INTERRUPTED_WRITE', 'OAuth registration state has only incomplete interrupted-write files.', {
      path: target,
      temporaryFileCount: candidates.length,
      retryable: false
    });
  }
  return null;
}

function normalizeRegistrationAttempts(value) {
  const attempts = Object.create(null);
  for (const [issuer, timestamps] of Object.entries(objectOrEmpty(value))) {
    attempts[issuer] = Array.isArray(timestamps) ? timestamps.map(Number).filter(Number.isFinite).slice(-DCR_LIMITS.rateMax) : [];
  }
  return attempts;
}

function repairLegacyGrantRecords(store) {
  let changed = false;
  for (const collectionName of ['codes', 'accessTokens', 'refreshTokens']) {
    for (const entry of Object.values(store[collectionName] || {})) {
      if (!entry || typeof entry !== 'object') continue;
      const client = store.clients?.[entry.clientId];
      if (!validStoredClient(client) || client.legacy_registration === true) continue;
      let expectedResource;
      try { expectedResource = resourceForIssuer(client.issuer); }
      catch { continue; }
      if (entry.resource !== expectedResource) continue;
      if (entry.issuer == null || entry.issuer === '') {
        entry.issuer = client.issuer;
        changed = true;
      }
      if (entry.authorizationPolicy == null) {
        entry.authorizationPolicy = createLocalAdminPolicy();
        changed = true;
      }
    }
  }
  return changed;
}

function requiresAuthorizationReset(parsed, store) {
  const hasAuthorizationState = STORE_MAPS.some(key => Object.keys(store[key] || {}).length > 0);
  if (!hasAuthorizationState) return false;
  if (Number(parsed.version || 0) < 5) return true;
  for (const client of Object.values(store.clients || {})) {
    if (!validStoredClient(client)) return true;
  }
  for (const entry of Object.values(store.codes || {})) {
    if (!validStoredGrant(entry, store, { authorizationCode: true })) return true;
  }
  for (const entry of Object.values(store.accessTokens || {})) {
    if (!validStoredGrant(entry, store)) return true;
  }
  for (const entry of Object.values(store.refreshTokens || {})) {
    if (!validStoredGrant(entry, store, { refreshToken: true })) return true;
  }
  return false;
}

function resetAuthorizationStore(parsed, store) {
  const reset = emptyStore();
  reset.registrationAttempts = normalizeRegistrationAttempts(store.registrationAttempts);
  reset.approvalRequiredAt = Date.now();
  reset.lastApprovedAt = Number(parsed.lastApprovedAt || 0) || null;
  for (const [clientId, client] of Object.entries(store.clients || {})) {
    const preserved = preservableStoredClient(clientId, client);
    if (preserved) reset.clients[clientId] = preserved;
  }
  return reset;
}

function preservableStoredClient(clientId, client) {
  if (validStoredClient(client)) return { ...client, granted_scope: '' };
  if (!client || typeof client !== 'object') return null;
  const redirectUris = Array.isArray(client.redirect_uris) ? client.redirect_uris.map(String).filter(Boolean) : [];
  if (redirectUris.length === 0 || redirectUris.some(uri => !validLegacyRedirectUri(uri))) return null;
  let registeredScope;
  try { registeredScope = normalizeScope(client.registered_scope || client.scope, { defaults: [SCOPE] }); }
  catch { registeredScope = SCOPE; }
  return {
    client_id: String(client.client_id || clientId),
    issuer: '',
    application_type: redirectUris.every(uri => new URL(uri).protocol === 'https:') ? 'web' : 'native',
    redirect_uris: redirectUris,
    client_name: typeof client.client_name === 'string' ? client.client_name.slice(0, 200) : '',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    registered_scope: registeredScope,
    granted_scope: '',
    created_at: Number(client.created_at || 0) || Date.now(),
    legacy_registration: true
  };
}

function validLegacyRedirectUri(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  } catch {
    return false;
  }
}

function validStoredClient(client) {
  if (!client || typeof client !== 'object') return false;
  if (!['native', 'web'].includes(client.application_type)) return false;
  if (!Array.isArray(client.redirect_uris) || client.redirect_uris.length === 0) return false;
  if (!Number.isFinite(Number(client.created_at))) return false;
  if (client.legacy_registration === true) {
    return client.issuer === ''
      && client.redirect_uris.every(validLegacyRedirectUri)
      && scopeSet(client.registered_scope).has(SCOPE);
  }
  try {
    if (canonicalIssuer(client.issuer) !== client.issuer) return false;
    if (!scopeSet(client.registered_scope).has(SCOPE)) return false;
    if ([...scopeSet(client.granted_scope)].some(scope => !SUPPORTED_SCOPES.includes(scope))) return false;
  } catch {
    return false;
  }
  return true;
}

function validStoredGrant(entry, store, options = {}) {
  if (!entry || typeof entry !== 'object') return false;
  const client = store.clients?.[entry.clientId];
  if (!validStoredClient(client) || client.legacy_registration === true || client.issuer !== entry.issuer) return false;
  if (!Number.isFinite(Number(entry.expiresAt))) return false;
  if (!scopeSet(entry.scope).has(SCOPE)) return false;
  if ([...scopeSet(entry.scope)].some(scope => !SUPPORTED_SCOPES.includes(scope))) return false;
  try {
    if (canonicalIssuer(entry.issuer) !== entry.issuer) return false;
    if (entry.resource !== resourceForIssuer(entry.issuer)) return false;
    normalizeAuthorizationPolicy(entry.authorizationPolicy);
  } catch {
    return false;
  }
  if (options.authorizationCode) {
    return typeof entry.redirectUri === 'string'
      && entry.redirectUri.length > 0
      && typeof entry.codeChallenge === 'string'
      && entry.codeChallenge.length > 0;
  }
  return true;
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
  const serialized = `${JSON.stringify({ ...store, version: STORE_VERSION }, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized);
  if (bytes > DCR_LIMITS.storeBytes) {
    throw new OAuthStoreError('OAUTH_STORE_SIZE_LIMIT', 'OAuth registration state exceeds the durable store size limit.', {
      sizeBytes: bytes,
      limitBytes: DCR_LIMITS.storeBytes,
      retryable: false
    });
  }
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const backupTemporary = `${backupPath()}.${process.pid}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (fs.existsSync(target)) {
      fs.copyFileSync(target, backupTemporary);
      fs.renameSync(backupTemporary, backupPath());
    }
    fs.renameSync(temporary, target);
  } catch (error) {
    if (descriptor != null) try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(temporary, { force: true }); } catch {}
    try { fs.rmSync(backupTemporary, { force: true }); } catch {}
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

function pruneStore(store, now = Date.now()) {
  for (const key of ['codes', 'accessTokens', 'refreshTokens']) {
    for (const [id, entry] of Object.entries(store[key] || {})) {
      if (!entry || Number(entry.expiresAt || 0) <= now) delete store[key][id];
    }
  }
  for (const [issuer, timestamps] of Object.entries(store.registrationAttempts || {})) {
    const recent = timestamps.map(Number).filter(value => Number.isFinite(value) && now - value < DCR_LIMITS.rateWindowMs);
    if (recent.length) store.registrationAttempts[issuer] = recent.slice(-DCR_LIMITS.rateMax);
    else delete store.registrationAttempts[issuer];
  }
  const activeClients = new Set();
  for (const key of ['codes', 'accessTokens', 'refreshTokens']) {
    for (const entry of Object.values(store[key] || {})) if (entry?.clientId) activeClients.add(entry.clientId);
  }
  const stale = Object.entries(store.clients || {})
    .filter(([clientId, client]) => !activeClients.has(clientId) && now - Number(client.last_used_at || client.created_at || now) >= DCR_LIMITS.staleRegistrationMs)
    .sort((left, right) => Number(left[1].last_used_at || left[1].created_at || 0) - Number(right[1].last_used_at || right[1].created_at || 0) || left[0].localeCompare(right[0]));
  for (const [clientId] of stale) delete store.clients[clientId];
  return store;
}

function evaluateRegistrationLimits(store, issuer, metadataBytes, now = Date.now()) {
  pruneStore(store, now);
  if (metadataBytes > DCR_LIMITS.metadataBytes) {
    return dcrError('Registration metadata exceeds the maximum accepted size.', 'metadata_size', DCR_LIMITS.metadataBytes);
  }
  const attempts = store.registrationAttempts[issuer] || [];
  if (attempts.length >= DCR_LIMITS.rateMax) {
    return dcrError('Registration rate limit exceeded for this issuer. Retry after the current window.', 'rate_limit', DCR_LIMITS.rateMax);
  }
  const clients = Object.values(store.clients || {});
  if (clients.filter(client => client?.issuer === issuer).length >= DCR_LIMITS.perIssuerClients) {
    return dcrError('The issuer has reached its retained client-registration limit.', 'per_issuer_client_limit', DCR_LIMITS.perIssuerClients);
  }
  if (clients.length >= DCR_LIMITS.globalClients) {
    return dcrError('The server has reached its retained client-registration limit.', 'global_client_limit', DCR_LIMITS.globalClients);
  }
  return null;
}

function dcrError(description, reason, limit) {
  return {
    error: 'invalid_client_metadata',
    error_description: description,
    httpStatus: reason === 'rate_limit' ? 429 : 400,
    resource_limit: { reason, limit }
  };
}

function recordRegistrationAttempt(store, issuer, now = Date.now()) {
  const attempts = Array.isArray(store.registrationAttempts[issuer]) ? store.registrationAttempts[issuer] : [];
  store.registrationAttempts[issuer] = [...attempts, now].filter(value => now - value < DCR_LIMITS.rateWindowMs).slice(-DCR_LIMITS.rateMax);
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
    application_types_supported: ['native', 'web']
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
  const metadataBytes = Buffer.byteLength(JSON.stringify(body || {}));
  if (metadataBytes > DCR_LIMITS.metadataBytes) return dcrError('Registration metadata exceeds the maximum accepted size.', 'metadata_size', DCR_LIMITS.metadataBytes);
  const applicationType = body.application_type == null
    ? 'web'
    : String(body.application_type).trim();
  if (!['native', 'web'].includes(applicationType)) {
    return { error: 'invalid_client_metadata', error_description: 'application_type must be native or web when provided.' };
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
  try {
    return withStoreLock(() => {
      const store = pruneStore(readStore());
      const createdAt = Date.now();
      const limitError = evaluateRegistrationLimits(store, issuer, metadataBytes, createdAt);
      if (limitError) return limitError;
      recordRegistrationAttempt(store, issuer, createdAt);
      const clientId = randomId('relai_client_', 24);
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
        created_at: createdAt,
        last_used_at: createdAt
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
  } catch (error) {
    if (error instanceof OAuthStoreError) {
      return {
        error: 'server_error',
        error_description: 'Client registration could not be persisted safely.',
        httpStatus: 503,
        store_error: error.toJSON()
      };
    }
    throw error;
  }
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
  let store;
  try {
    store = pruneStore(readStore());
  } catch (error) {
    if (error instanceof OAuthStoreError) {
      return oauthError('server_error', 'OAuth registration state is unavailable. Resolve the reported store error before retrying authorization.', false, { storeError: error.toJSON() });
    }
    throw error;
  }
  const clientId = String(query.client_id || '');
  let client = clientId && Object.hasOwn(store.clients, clientId) ? store.clients[clientId] : null;
  const recoveredRegistration = client ? null : recoverableMissingClient(query, issuer, store);
  if (recoveredRegistration) client = recoveredRegistration;
  if (!client || (client.legacy_registration !== true && client.issuer !== issuer)) {
    return oauthError('invalid_client', 'Unknown client_id for this issuer. Register the affected client again.', false, {
      recovery: {
        reason: client ? 'issuer_changed' : 'registration_missing',
        affectedClientId: clientId,
        currentIssuer: issuer,
        registeredIssuer: client?.issuer || '',
        canReregister: true,
        preservesUnrelatedClients: true
      }
    });
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
  if (client.legacy_registration === true) {
    client.issuer = issuer;
    delete client.legacy_registration;
    writeStore(store);
  }
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
      applicationType: client.application_type,
      ...(recoveredRegistration ? { recoveredRegistration } : {})
    }
  };
}

function recoverableMissingClient(query, issuer, store) {
  if (Number(store.approvalRequiredAt || 0) <= 0) return null;
  const clientId = String(query.client_id || '');
  if (!/^relai_client_[A-Za-z0-9_-]{16,80}$/.test(clientId)) return null;
  if (String(query.response_type || '') !== 'code') return null;
  if (!String(query.code_challenge || '') || String(query.code_challenge_method || '') !== 'S256') return null;
  if (String(query.resource || resourceForIssuer(issuer)) !== resourceForIssuer(issuer)) return null;
  const redirectUri = String(query.redirect_uri || '');
  let redirect;
  try { redirect = new URL(redirectUri); } catch { return null; }
  if (redirect.protocol !== 'https:' || redirect.hostname.toLowerCase() !== 'chatgpt.com') return null;
  if (!/^\/(?:connector\/oauth\/[A-Za-z0-9_-]+|connector_platform_oauth_redirect)$/.test(redirect.pathname)) return null;
  let registeredScope;
  try { registeredScope = normalizeScope(query.scope, { defaults: [SCOPE] }); }
  catch { return null; }
  return {
    client_id: clientId,
    issuer,
    application_type: 'web',
    redirect_uris: [redirectUri],
    client_name: 'ChatGPT',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    registered_scope: registeredScope,
    granted_scope: '',
    created_at: Date.now(),
    last_used_at: Date.now()
  };
}

function issueAuthorizationCode(request, baseUrl) {
  const issuer = canonicalIssuer(baseUrl || request.issuer);
  return withStoreLock(() => {
    const store = pruneStore(readStore());
    let client = store.clients[request.clientId];
    if (!client && request.recoveredRegistration && Number(store.approvalRequiredAt || 0) > 0) {
      const recovered = request.recoveredRegistration;
      if (recovered.client_id !== request.clientId || recovered.issuer !== issuer || !validStoredClient(recovered)) {
        throw new Error('Recovered OAuth client registration is invalid.');
      }
      store.clients[request.clientId] = recovered;
      client = recovered;
    }
    if (!client || client.issuer !== issuer) throw new Error('OAuth client registration is not valid for the current issuer.');
    client.granted_scope = unionScope(client.granted_scope, request.scope);
    client.last_used_at = Date.now();
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
      authorizationPolicy: normalizeAuthorizationPolicy(request.authorizationPolicy || createLocalAdminPolicy()),
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

function issueTokens(store, { issuer, clientId, scope, resource, authorizationPolicy, issueRefresh = true }) {
  const now = Date.now();
  const accessToken = randomId('relai_at_', 32);
  store.accessTokens[secretKey(accessToken)] = {
    issuer,
    clientId,
    scope,
    resource,
    authorizationPolicy: normalizeAuthorizationPolicy(authorizationPolicy),
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
  // ChatGPT requests scope=mcp and still expects a refresh token for persistent access.
  if (issueRefresh) {
    const refreshToken = randomId('relai_rt_', 32);
    store.refreshTokens[secretKey(refreshToken)] = {
      issuer,
      clientId,
      scope,
      resource,
      authorizationPolicy: normalizeAuthorizationPolicy(authorizationPolicy),
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
  client.last_used_at = Date.now();
  const tokens = issueTokens(store, {
    issuer,
    clientId: entry.clientId,
    scope: entry.scope,
    resource: entry.resource,
    authorizationPolicy: entry.authorizationPolicy,
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
  client.last_used_at = Date.now();
  const tokens = issueTokens(store, {
    issuer,
    clientId: entry.clientId,
    scope,
    resource: entry.resource,
    authorizationPolicy: entry.authorizationPolicy,
    issueRefresh: true
  });
  writeStore(store);
  return { status: 200, body: tokens };
}

function exchangeToken(body = {}, baseUrl) {
  const issuer = canonicalIssuer(baseUrl);
  try {
    return withStoreLock(() => {
      const store = pruneStore(readStore());
      const grantType = String(body.grant_type || '');
      if (grantType === 'authorization_code') return exchangeAuthorizationCode(store, body, issuer);
      if (grantType === 'refresh_token') return exchangeRefreshToken(store, body, issuer);
      return tokenError('unsupported_grant_type', `Unsupported grant_type: ${grantType}`);
    });
  } catch (error) {
    if (error instanceof OAuthStoreError) {
      return { status: 503, body: { error: 'temporarily_unavailable', error_description: 'OAuth registration state is unavailable.', store_error: error.toJSON() } };
    }
    throw error;
  }
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
      registeredClientsPreserved: Object.keys(store.clients || {}).length
    };
    for (const client of Object.values(store.clients || {})) client.granted_scope = '';
    store.codes = Object.create(null);
    store.accessTokens = Object.create(null);
    store.refreshTokens = Object.create(null);
    store.approvalRequiredAt = Date.now();
    writeStore(store);
    return revoked;
  });
}

// ---- Approval UI -----------------------------------------------------------

// The approval token is the whole gate. Approving a connection grants full local
// admin capability for every configured workspace; there is no per-repository or
// per-capability selection on the consent page.
function authorizationPolicyFromConsent() {
  return createLocalAdminPolicy();
}

function renderLoginPage(request, _baseUrl, options = {}) {
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
  const hiddenInputs = Object.entries(hidden)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('\n      ');
  const errorHtml = options.error ? `<div class="oauth-error">${escapeHtml(options.error)}</div>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Rel.AI MCP</title>
<link rel="stylesheet" href="/public/oauth.css">
</head>
<body class="oauth-page">
  <form class="oauth-card" method="POST" action="/authorize">
    <h1>Authorize ChatGPT</h1>
    <p>Connect ChatGPT to your local Rel.AI MCP workspaces. Enter the approval token from the Rel.AI desktop app.</p>
    <p class="oauth-client">In Rel.AI, open <strong>Settings &gt; Connection</strong>. Below the connection controls, find <strong>Approval token</strong>, select <strong>Show</strong>, then <strong>Copy token</strong> and paste it here. Replacing the token revokes existing ChatGPT access, but the MCP endpoint and ChatGPT app stay the same.</p>
    ${errorHtml}
    <label for="dashboard_token">Approval token</label>
    <input id="dashboard_token" name="dashboard_token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" autofocus required>
    ${hiddenInputs}
    <button type="submit">Approve connection</button>
    <div class="oauth-client">Requesting client: ${escapeHtml(request.clientName || request.clientId)}</div>
  </form>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function verifyLogin(submittedToken, serverToken) {
  if (!serverToken) return true;
  const submitted = String(submittedToken == null ? '' : submittedToken).trim();
  const expected = String(serverToken).trim();
  return timingSafeEqual(submitted, expected);
}

export { protectedResourceMetadata, authorizationServerMetadata, wwwAuthenticateHeader, registerClient, validateAuthorizationRequest, issueAuthorizationCode, buildRedirectUrl, exchangeToken, validateAccessToken, authorizationPolicyFromConsent, renderLoginPage, verifyLogin, authorizationStatus, revokeAuthorizations, canonicalIssuer, resourceForIssuer, normalizeScope, SCOPE, OFFLINE_SCOPE, SUPPORTED_SCOPES, secretKey, DCR_LIMITS, OAuthStoreError, emptyStore as createEmptyOAuthStore, readStore as readOAuthStore, writeStore as writeOAuthStore, pruneStore, evaluateRegistrationLimits, oauthStoreRecoveryStatus, resetOAuthStoreAfterCorruption };
