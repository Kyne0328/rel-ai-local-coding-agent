import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILE = 'cloud-relay-state.json';
const STATE_SCHEMA_VERSION = 1;

function createCloudRelayStateStore(options = {}) {
  const {
    app,
    safeStorage,
    fsModule = fs,
    pathModule = path,
    onLog = () => {}
  } = options;
  if (!app || typeof app.getPath !== 'function') throw new TypeError('Electron app is required.');
  if (!safeStorage || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
    throw new TypeError('Electron safeStorage is required.');
  }

  const statePath = pathModule.join(app.getPath('userData'), STATE_FILE);

  function load() {
    let parsed;
    try {
      parsed = JSON.parse(fsModule.readFileSync(statePath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') onLog('Rel.AI Cloud state could not be read.', { source: 'cloud-relay', level: 'warning' });
      return emptyState();
    }
    if (!parsed || parsed.schemaVersion !== STATE_SCHEMA_VERSION) return emptyState();
    try {
      return {
        deviceId: cleanText(parsed.deviceId, 160),
        publicKeyJwk: normalizePublicJwk(parsed.publicKeyJwk),
        privateKeyJwk: decryptJson(parsed.privateKeyJwkEncrypted),
        deviceToken: decryptText(parsed.deviceTokenEncrypted)
      };
    } catch {
      onLog('Rel.AI Cloud credentials could not be decrypted and must be registered again.', {
        source: 'cloud-relay',
        level: 'warning'
      });
      return emptyState();
    }
  }

  function save(value = {}) {
    assertEncryptionAvailable();
    const next = {
      schemaVersion: STATE_SCHEMA_VERSION,
      deviceId: cleanText(value.deviceId, 160),
      publicKeyJwk: normalizePublicJwk(value.publicKeyJwk),
      privateKeyJwkEncrypted: encryptJson(value.privateKeyJwk),
      deviceTokenEncrypted: value.deviceToken ? encryptText(value.deviceToken) : '',
      updatedAt: new Date().toISOString()
    };
    fsModule.mkdirSync(pathModule.dirname(statePath), { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.${process.pid}.tmp`;
    fsModule.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fsModule.renameSync(temporary, statePath);
    return load();
  }

  function clear() {
    try {
      fsModule.rmSync(statePath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  function encryptText(value) {
    assertEncryptionAvailable();
    return Buffer.from(safeStorage.encryptString(String(value || ''))).toString('base64');
  }

  function decryptText(value) {
    if (!value) return '';
    assertEncryptionAvailable();
    return safeStorage.decryptString(Buffer.from(String(value), 'base64'));
  }

  function encryptJson(value) {
    if (!value || typeof value !== 'object') throw new Error('A private device key is required.');
    return encryptText(JSON.stringify(value));
  }

  function decryptJson(value) {
    if (!value) return null;
    const parsed = JSON.parse(decryptText(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  }

  function assertEncryptionAvailable() {
    if (typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable() !== true) {
      throw new Error('Operating-system credential encryption is unavailable. Rel.AI Cloud registration was not saved.');
    }
  }

  return { load, save, clear, path: statePath };
}

function emptyState() {
  return { deviceId: '', publicKeyJwk: null, privateKeyJwk: null, deviceToken: '' };
}

function normalizePublicJwk(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519' || typeof value.x !== 'string') return null;
  return { kty: 'OKP', crv: 'Ed25519', x: value.x };
}

function cleanText(value, limit = 500) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, limit);
}

export { STATE_FILE, createCloudRelayStateStore };
