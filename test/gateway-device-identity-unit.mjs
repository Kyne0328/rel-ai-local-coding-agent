import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { configureGatewaySafeStorage, createGatewayDeviceIdentityStore } from '../electron/gateway-device-identity.js';

function createSafeStorage() {
  const calls = [];
  return {
    calls,
    isEncryptionAvailable: () => true,
    encryptString(value) {
      calls.push({ type: 'encrypt', value });
      return Buffer.from(`enc:${value}`, 'utf8');
    },
    decryptString(buffer) {
      calls.push({ type: 'decrypt' });
      const text = Buffer.from(buffer).toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('ciphertext rejected');
      return text.slice(4);
    }
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gateway-identity-'));
try {
  let plainTextEnabled = false;
  const basicStorage = {
    isEncryptionAvailable: () => plainTextEnabled,
    encryptString: value => Buffer.from(value),
    decryptString: buffer => Buffer.from(buffer).toString('utf8'),
    setUsePlainTextEncryption(value) { plainTextEnabled = value === true; }
  };
  assert.equal(configureGatewaySafeStorage({ safeStorage: basicStorage, platform: 'linux', passwordStore: 'basic' }), true);
  assert.equal(basicStorage.isEncryptionAvailable(), true);
  plainTextEnabled = false;
  assert.equal(configureGatewaySafeStorage({ safeStorage: basicStorage, platform: 'linux', passwordStore: 'gnome-libsecret' }), false);
  assert.equal(configureGatewaySafeStorage({ safeStorage: basicStorage, platform: 'win32', passwordStore: 'basic' }), false);
  assert.equal(plainTextEnabled, false, 'plaintext fallback must require both Linux and an explicit basic password-store switch');

  const safeStorage = createSafeStorage();
  const store = createGatewayDeviceIdentityStore({ stateDir: root, safeStorage });
  const first = await store.open();
  assert.equal(first.version, 1);
  assert.match(first.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(Object.keys(first.publicJwk).sort(), ['crv', 'ext', 'key_ops', 'kty', 'x', 'y'].sort());
  assert.equal(first.publicJwk.kty, 'EC');
  assert.equal(first.publicJwk.crv, 'P-256');
  assert.equal(first.paired, false);
  assert.equal(first.principalId, '');

  const statePath = path.join(root, 'gateway-device.json');
  const disk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(Object.keys(disk).sort(), ['deviceId', 'encryptedPrincipalState', 'encryptedPrivateKey', 'publicJwk', 'version'].sort());
  assert.equal(disk.version, 1);
  assert.equal(disk.deviceId, first.deviceId);
  assert.equal(typeof disk.encryptedPrivateKey, 'string');
  assert.notEqual(disk.encryptedPrivateKey, '');
  assert.equal(disk.encryptedPrincipalState, '');
  const serializedDisk = JSON.stringify(disk);
  assert.doesNotMatch(serializedDisk, /"d"\s*:/);
  assert.doesNotMatch(serializedDisk, /recovery/i);

  const reopened = createGatewayDeviceIdentityStore({ stateDir: root, safeStorage });
  const second = await reopened.open();
  assert.equal(second.deviceId, first.deviceId);
  assert.deepEqual(second.publicJwk, first.publicJwk);

  await reopened.setPrincipalState({ principalId: 'principal_1234567890abcdef', recoverySecret: 'recovery-secret-keep-private' });
  const paired = reopened.snapshot();
  assert.equal(paired.paired, true);
  assert.equal(paired.principalId, 'principal_1234567890abcdef');
  assert.doesNotMatch(JSON.stringify(paired), /recovery-secret-keep-private/);
  assert.doesNotMatch(JSON.stringify(paired), /encryptedPrivateKey|privateJwk/i);

  const pairedDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.notEqual(pairedDisk.encryptedPrincipalState, '');
  assert.doesNotMatch(JSON.stringify(pairedDisk), /principal_1234567890abcdef|recovery-secret-keep-private/);
  const secrets = reopened.principalState();
  assert.deepEqual(secrets, { principalId: 'principal_1234567890abcdef', recoverySecret: 'recovery-secret-keep-private' });

  const challenge = {
    principalId: 'principal_1234567890abcdef',
    deviceId: first.deviceId,
    nonce: 'nonce_1234567890',
    expiresAt: Date.now() + 30_000
  };
  const signature = await reopened.signChallenge(challenge);
  assert.match(signature, /^[A-Za-z0-9_-]+$/);
  const publicKey = await crypto.subtle.importKey('jwk', first.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signed = `relai-device-v1\0${challenge.principalId}\0${challenge.deviceId}\0${challenge.nonce}\0${challenge.expiresAt}`;
  const rawSignature = Buffer.from(signature.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(signature.length / 4) * 4, '='), 'base64');
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, rawSignature, new TextEncoder().encode(signed)), true);

  const beforeCorruption = fs.readFileSync(statePath, 'utf8');
  const corrupt = JSON.parse(beforeCorruption);
  corrupt.encryptedPrivateKey = Buffer.from('not-valid-ciphertext').toString('base64');
  fs.writeFileSync(statePath, `${JSON.stringify(corrupt, null, 2)}\n`, 'utf8');
  const corruptedBytes = fs.readFileSync(statePath, 'utf8');
  await assert.rejects(
    createGatewayDeviceIdentityStore({ stateDir: root, safeStorage }).open(),
    /gateway device identity state is corrupted/i
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), corruptedBytes, 'corruption must not silently rotate identity');

  const unavailableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-gateway-identity-unavailable-'));
  try {
    const unavailable = createGatewayDeviceIdentityStore({
      stateDir: unavailableRoot,
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('unavailable'); },
        decryptString: () => { throw new Error('unavailable'); }
      }
    });
    await assert.rejects(unavailable.open(), /secure storage is unavailable/i);
    assert.equal(fs.existsSync(path.join(unavailableRoot, 'gateway-device.json')), false);
  } finally {
    fs.rmSync(unavailableRoot, { recursive: true, force: true });
  }

  assert.ok(safeStorage.calls.some(call => call.type === 'encrypt' && call.value.includes('"d"')));
  assert.ok(safeStorage.calls.some(call => call.type === 'encrypt' && call.value.includes('recovery-secret-keep-private')));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Gateway device identity unit tests passed.');
