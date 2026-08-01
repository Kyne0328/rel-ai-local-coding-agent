import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-auth-issuer-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = stateDir;

try {
  const connection = await import('../src/connectionProfile.js');
  const { resolveBaseUrlDetails } = await import('../src/http/auth.js');
  connection.writeConnectionProfile({
    publicUrl: 'https://persisted.example.test/',
    tunnelUrl: 'https://managed.example.test/'
  });

  const active = resolveBaseUrlDetails({
    activeRuntimeUrl: 'https://ACTIVE.example.test:443///',
    publicUrl: 'https://explicit.example.test/'
  });
  assert.equal(active.baseUrl, 'https://active.example.test');
  assert.equal(active.source, 'active_runtime');
  assert.equal(active.diagnostics.length, 1);
  assert.equal(active.diagnostics[0].code, 'OAUTH_ISSUER_PROFILE_DISAGREEMENT');
  assert.equal(active.diagnostics[0].persistedIssuer, 'https://persisted.example.test');

  const proxyVisible = resolveBaseUrlDetails({ proxyVisibleOrigin: 'https://Proxy.example.test:443/' });
  assert.equal(proxyVisible.baseUrl, 'https://proxy.example.test');
  assert.equal(proxyVisible.source, 'active_runtime');

  const explicit = resolveBaseUrlDetails({ publicUrl: 'https://explicit.example.test:443/' });
  assert.equal(explicit.baseUrl, 'https://explicit.example.test');
  assert.equal(explicit.source, 'explicit_process');

  const managed = resolveBaseUrlDetails({});
  assert.equal(managed.baseUrl, 'https://managed.example.test');
  assert.equal(managed.source, 'managed_connection');

  fs.writeFileSync(connection.getConnectionProfilePath(), `${JSON.stringify({ publicUrl: 'https://persisted-only.example.test/' }, null, 2)}\n`);
  const persisted = resolveBaseUrlDetails({});
  assert.equal(persisted.baseUrl, 'https://persisted-only.example.test');
  assert.equal(persisted.source, 'persisted_profile');
  assert.deepEqual(persisted.diagnostics, []);

  fs.rmSync(connection.getConnectionProfilePath(), { force: true });
  const loopback = resolveBaseUrlDetails({ host: '127.0.0.1', port: 4567 });
  assert.equal(loopback.baseUrl, 'http://127.0.0.1:4567');
  assert.equal(loopback.source, 'loopback_fallback');
} finally {
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('OAuth runtime URL precedence, canonicalization, persisted fallback, and disagreement diagnostics passed.');
