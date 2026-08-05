import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const provider = await import('../src/oauthProvider.js');
const issuer = 'https://issuer.example.test';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const createdDirs = [];

function useState(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `relai-oauth-${name}-`));
  createdDirs.push(directory);
  process.env.REL_AI_MCP_STATE_DIR = directory;
  return directory;
}

function storeFile(directory) {
  return path.join(directory, 'oauth-store.json');
}

function validRegistrationBody(extra = {}) {
  return {
    application_type: 'web',
    client_name: 'Rel.AI OAuth Unit Test',
    redirect_uris: [redirectUri],
    scope: 'mcp',
    ...extra
  };
}

function syntheticClient(clientIssuer, now = Date.now()) {
  return { issuer: clientIssuer, created_at: now, last_used_at: now };
}

function runChildRegistration(directory, index) {
  const moduleUrl = pathToFileURL(path.join(root, 'src', 'oauthProvider.js')).href;
  const code = `import { registerClient } from ${JSON.stringify(moduleUrl)}; const result = registerClient(${JSON.stringify(validRegistrationBody({ client_name: `Concurrent ${index}` }))}, ${JSON.stringify(issuer)}); if (!result.client_id) { console.error(JSON.stringify(result)); process.exit(1); }`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: root,
      env: { ...process.env, REL_AI_MCP_STATE_DIR: directory },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', codeValue => codeValue === 0 ? resolve() : reject(new Error(stderr || `registration child ${index} exited ${codeValue}`)));
  });
}

try {
  let directory = useState('missing');
  assert.equal(provider.authorizationStatus().registeredClients, 0);
  const genuinelyUnknown = provider.validateAuthorizationRequest({
    response_type: 'code',
    client_id: 'genuinely-unknown-client',
    redirect_uri: redirectUri,
    code_challenge: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    code_challenge_method: 'S256',
    resource: `${issuer}/mcp`,
    scope: 'mcp'
  }, { issuer });
  assert.equal(genuinelyUnknown.error, 'invalid_client');
  assert.equal(genuinelyUnknown.storeError, undefined);

  directory = useState('truncated');
  fs.writeFileSync(storeFile(directory), '{"version":7');
  const truncated = provider.validateAuthorizationRequest({}, { issuer });
  assert.equal(truncated.error, 'server_error');
  assert.equal(truncated.storeError.code, 'OAUTH_STORE_TRUNCATED');
  assert.ok(fs.readdirSync(directory).some(name => name.includes('.corrupt-')));
  const persistentRecovery = provider.validateAuthorizationRequest({}, { issuer });
  assert.equal(persistentRecovery.error, 'server_error');
  assert.equal(persistentRecovery.storeError.code, 'OAUTH_STORE_RECOVERY_REQUIRED');
  assert.equal(provider.oauthStoreRecoveryStatus().required, true);
  assert.throws(
    () => provider.resetOAuthStoreAfterCorruption(),
    error => error?.code === 'OAUTH_STORE_RESET_CONFIRMATION_REQUIRED'
  );
  const explicitReset = provider.resetOAuthStoreAfterCorruption({ confirm: true });
  assert.equal(explicitReset.reset, true);
  assert.equal(provider.oauthStoreRecoveryStatus().required, false);
  const unknownAfterReset = provider.validateAuthorizationRequest({ client_id: 'still-unknown' }, { issuer });
  assert.equal(unknownAfterReset.error, 'invalid_client');

  directory = useState('malformed');
  fs.writeFileSync(storeFile(directory), '{"version":7,}');
  const malformed = provider.validateAuthorizationRequest({}, { issuer });
  assert.equal(malformed.error, 'server_error');
  assert.equal(malformed.storeError.code, 'OAUTH_STORE_MALFORMED');

  directory = useState('backup');
  const backupStore = provider.createEmptyOAuthStore();
  provider.writeOAuthStore(backupStore);
  fs.copyFileSync(storeFile(directory), `${storeFile(directory)}.bak`);
  fs.writeFileSync(storeFile(directory), '{');
  assert.equal(provider.readOAuthStore().version, 7);
  assert.equal(JSON.parse(fs.readFileSync(storeFile(directory), 'utf8')).version, 7);

  directory = useState('interrupted');
  const interrupted = provider.createEmptyOAuthStore();
  fs.writeFileSync(`${storeFile(directory)}.123.valid.tmp`, `${JSON.stringify(interrupted)}\n`);
  assert.equal(provider.readOAuthStore().version, 7);
  assert.ok(fs.existsSync(storeFile(directory)));

  directory = useState('migration');
  fs.writeFileSync(storeFile(directory), `${JSON.stringify({ version: 'invalid' })}\n`);
  assert.throws(() => provider.readOAuthStore(), error => error?.code === 'OAUTH_STORE_MIGRATION_FAILED');

  directory = useState('unsupported');
  fs.writeFileSync(storeFile(directory), `${JSON.stringify({ version: 999 })}\n`);
  assert.throws(() => provider.readOAuthStore(), error => error?.code === 'OAUTH_STORE_UNSUPPORTED_SCHEMA');

  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
    directory = useState('denied');
    provider.writeOAuthStore(provider.createEmptyOAuthStore());
    fs.chmodSync(storeFile(directory), 0o000);
    try {
      assert.throws(() => provider.readOAuthStore(), error => error?.code === 'OAUTH_STORE_ACCESS_DENIED');
    } finally {
      fs.chmodSync(storeFile(directory), 0o600);
    }
  }

  directory = useState('v22-grants');
  const legacyClientId = 'relai_client_v22_compatibility_test';
  const legacyNow = Date.now();
  const legacyStore = provider.createEmptyOAuthStore();
  legacyStore.clients[legacyClientId] = {
    client_id: legacyClientId,
    issuer,
    application_type: 'web',
    redirect_uris: [redirectUri],
    client_name: 'ChatGPT',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    registered_scope: 'mcp',
    granted_scope: 'mcp',
    created_at: legacyNow,
    last_used_at: legacyNow
  };
  legacyStore.accessTokens['v22-access-token'] = {
    clientId: legacyClientId,
    scope: 'mcp',
    resource: `${issuer}/mcp`,
    issuedAt: legacyNow,
    expiresAt: legacyNow + 60_000
  };
  legacyStore.refreshTokens['v22-refresh-token'] = {
    clientId: legacyClientId,
    scope: 'mcp',
    resource: `${issuer}/mcp`,
    issuedAt: legacyNow,
    expiresAt: legacyNow + 60_000
  };
  fs.writeFileSync(storeFile(directory), `${JSON.stringify(legacyStore, null, 2)}\n`);
  const repairedLegacyStore = provider.readOAuthStore();
  const repairedAccess = Object.values(repairedLegacyStore.accessTokens)[0];
  const repairedRefresh = Object.values(repairedLegacyStore.refreshTokens)[0];
  assert.equal(repairedLegacyStore.approvalRequiredAt, null);
  assert.equal(repairedAccess.issuer, issuer);
  assert.equal(repairedRefresh.issuer, issuer);
  assert.equal(repairedAccess.authorizationPolicy.kind, 'local_admin');
  assert.equal(repairedRefresh.authorizationPolicy.kind, 'local_admin');
  assert.ok(provider.validateAccessToken('v22-access-token', issuer));

  directory = useState('application-type-default');
  const defaultApplicationType = provider.registerClient({
    client_name: 'ChatGPT without application_type',
    redirect_uris: [redirectUri],
    scope: 'mcp'
  }, issuer);
  assert.equal(defaultApplicationType.application_type, 'web');
  const invalidApplicationType = provider.registerClient(validRegistrationBody({ application_type: 'desktop' }), issuer);
  assert.equal(invalidApplicationType.error, 'invalid_client_metadata');
  assert.match(invalidApplicationType.error_description, /when provided/);

  directory = useState('metadata-limit');
  const metadataLimit = provider.registerClient(validRegistrationBody({ client_name: 'x'.repeat(provider.DCR_LIMITS.metadataBytes) }), issuer);
  assert.equal(metadataLimit.error, 'invalid_client_metadata');
  assert.equal(metadataLimit.resource_limit.reason, 'metadata_size');

  const now = Date.now();
  const perIssuerStore = provider.createEmptyOAuthStore();
  for (let index = 0; index < provider.DCR_LIMITS.perIssuerClients; index += 1) perIssuerStore.clients[`per-${index}`] = syntheticClient(issuer, now);
  const perIssuerError = provider.evaluateRegistrationLimits(perIssuerStore, issuer, 100, now);
  assert.equal(perIssuerError.resource_limit.reason, 'per_issuer_client_limit');

  const globalStore = provider.createEmptyOAuthStore();
  for (let index = 0; index < provider.DCR_LIMITS.globalClients; index += 1) globalStore.clients[`global-${index}`] = syntheticClient(`https://issuer-${index}.example.test`, now);
  const globalError = provider.evaluateRegistrationLimits(globalStore, 'https://new.example.test', 100, now);
  assert.equal(globalError.resource_limit.reason, 'global_client_limit');

  const rateStore = provider.createEmptyOAuthStore();
  rateStore.registrationAttempts[issuer] = Array.from({ length: provider.DCR_LIMITS.rateMax }, () => now);
  const rateError = provider.evaluateRegistrationLimits(rateStore, issuer, 100, now);
  assert.equal(rateError.resource_limit.reason, 'rate_limit');
  assert.equal(rateError.httpStatus, 429);

  const pruneStore = provider.createEmptyOAuthStore();
  const staleTime = now - provider.DCR_LIMITS.staleRegistrationMs - 1;
  pruneStore.clients.oldest = syntheticClient(issuer, staleTime);
  pruneStore.clients.stale = syntheticClient(issuer, staleTime + 1);
  pruneStore.clients.active = syntheticClient(issuer, staleTime);
  pruneStore.clients.fresh = syntheticClient(issuer, now);
  pruneStore.accessTokens.activeToken = { clientId: 'active', expiresAt: now + 60_000 };
  provider.pruneStore(pruneStore, now);
  assert.deepEqual(Object.keys(pruneStore.clients).sort(), ['active', 'fresh']);

  directory = useState('store-size');
  const oversizedStore = provider.createEmptyOAuthStore();
  oversizedStore.unrelatedSetting = 'x'.repeat(provider.DCR_LIMITS.storeBytes);
  assert.throws(() => provider.writeOAuthStore(oversizedStore), error => error?.code === 'OAUTH_STORE_SIZE_LIMIT');

  directory = useState('concurrent');
  await Promise.all(Array.from({ length: 8 }, (_, index) => runChildRegistration(directory, index)));
  const concurrentStore = provider.readOAuthStore();
  assert.equal(Object.keys(concurrentStore.clients).length, 8);
  assert.equal(JSON.parse(fs.readFileSync(storeFile(directory), 'utf8')).version, 7);

  directory = useState('reregistration');
  const first = provider.registerClient(validRegistrationBody({ client_name: 'First' }), issuer);
  const unrelated = provider.registerClient(validRegistrationBody({ client_name: 'Unrelated' }), issuer);
  const store = provider.readOAuthStore();
  delete store.clients[first.client_id];
  store.approvalRequiredAt = Date.now();
  provider.writeOAuthStore(store);
  const recovery = provider.validateAuthorizationRequest({
    response_type: 'code',
    client_id: first.client_id,
    redirect_uri: redirectUri,
    code_challenge: 'challenge',
    code_challenge_method: 'S256',
    resource: `${issuer}/mcp`,
    scope: 'mcp'
  }, { issuer });
  assert.equal(recovery.ok, true);
  assert.ok(recovery.request.recoveredRegistration);
  assert.ok(provider.readOAuthStore().clients[unrelated.client_id]);
} finally {
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  for (const directory of createdDirs) fs.rmSync(directory, { recursive: true, force: true });
}

console.log('OAuth store error classification, backup/interrupted-write recovery, DCR bounds, pruning, concurrency, and targeted re-registration passed.');
