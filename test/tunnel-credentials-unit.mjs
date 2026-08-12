import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTunnelCredentialStore, normalizeApiKey } from '../electron/tunnel-credentials.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-tunnel-credentials-'));
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: value => Buffer.from(value).toString('utf8').replace(/^encrypted:/, '')
};

try {
  const store = createTunnelCredentialStore({ stateDir, safeStorage });
  assert.deepEqual(store.status(), { apiKeyConfigured: false });
  assert.equal(store.getApiKey(), '');
  const key = 'sk-runtime-example-123456789';
  assert.deepEqual(store.setApiKey(key), { apiKeyConfigured: true });
  assert.equal(store.getApiKey(), key);
  assert.deepEqual(store.status(), { apiKeyConfigured: true });
  assert.doesNotMatch(fs.readFileSync(store.statePath(), 'utf8'), new RegExp(key));
  assert.throws(() => normalizeApiKey('bad key'), /invalid/i);
  assert.deepEqual(store.clear(), { apiKeyConfigured: false });
  assert.equal(store.getApiKey(), '');
  console.log('tunnel-credentials-unit: ok');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}
