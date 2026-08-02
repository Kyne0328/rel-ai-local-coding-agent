import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCloudRelayStateStore } from '../electron/cloud-relay-state.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-cloud-state-'));
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: value => {
    const text = Buffer.from(value).toString('utf8');
    if (!text.startsWith('encrypted:')) throw new Error('invalid ciphertext');
    return text.slice('encrypted:'.length);
  }
};
const store = createCloudRelayStateStore({
  app: { getPath: name => name === 'userData' ? root : root },
  safeStorage
});

assert.deepEqual(store.load(), {
  deviceId: '', publicKeyJwk: null, privateKeyJwk: null, deviceToken: ''
});

const saved = store.save({
  deviceId: 'device_test',
  publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'public-key' },
  privateKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'public-key', d: 'private-key' },
  deviceToken: 'relai_device_secret'
});
assert.equal(saved.deviceId, 'device_test');
assert.equal(saved.deviceToken, 'relai_device_secret');
assert.equal(saved.privateKeyJwk.d, 'private-key');
const raw = fs.readFileSync(store.path, 'utf8');
assert.doesNotMatch(raw, /private-key|relai_device_secret/);
assert.match(raw, /privateKeyJwkEncrypted/);
assert.equal(store.clear(), true);
assert.equal(fs.existsSync(store.path), false);

const unavailable = createCloudRelayStateStore({
  app: { getPath: () => root },
  safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }
});
assert.throws(() => unavailable.save({ privateKeyJwk: { kty: 'OKP' } }), /encryption is unavailable/);

fs.rmSync(root, { recursive: true, force: true });
console.log('Cloud relay state unit tests passed.');
