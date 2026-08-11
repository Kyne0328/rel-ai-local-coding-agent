import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, webcrypto } from 'node:crypto';

const STATE_VERSION = 1;
const STATE_FILE = 'gateway-device.json';
const encoder = new TextEncoder();

function createGatewayDeviceIdentityStore({
  stateDir = process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), '.rel-ai-mcp'),
  safeStorage,
  cryptoImpl = webcrypto,
  uuid = randomUUID
} = {}) {
  requireSafeStorage(safeStorage);
  if (!cryptoImpl?.subtle) throw new TypeError('cryptoImpl with Web Crypto subtle API is required.');
  if (typeof uuid !== 'function') throw new TypeError('uuid is required.');

  const filePath = path.join(path.resolve(String(stateDir)), STATE_FILE);
  let loaded = null;

  async function open() {
    if (loaded) return snapshot();
    ensureEncryptionAvailable(safeStorage);
    if (fs.existsSync(filePath)) {
      loaded = await readState(filePath, safeStorage, cryptoImpl);
      return snapshot();
    }
    loaded = await createState(safeStorage, cryptoImpl, uuid);
    writeState(filePath, loaded.disk);
    return snapshot();
  }

  function snapshot() {
    requireLoaded(loaded);
    return Object.freeze({
      version: STATE_VERSION,
      deviceId: loaded.disk.deviceId,
      publicJwk: Object.freeze({ ...loaded.disk.publicJwk }),
      paired: Boolean(loaded.principalState?.principalId),
      principalId: String(loaded.principalState?.principalId || '')
    });
  }

  function principalState() {
    requireLoaded(loaded);
    return loaded.principalState
      ? { ...loaded.principalState }
      : { principalId: '', recoverySecret: '' };
  }

  async function setPrincipalState(value = {}) {
    requireLoaded(loaded);
    const principalId = boundedSecret(value.principalId, 'principalId', 200);
    const recoverySecret = boundedSecret(value.recoverySecret, 'recoverySecret', 4096);
    const principalState = { principalId, recoverySecret };
    const encryptedPrincipalState = encryptJson(safeStorage, principalState);
    const disk = { ...loaded.disk, encryptedPrincipalState };
    writeState(filePath, disk);
    loaded = { ...loaded, disk, principalState };
    return snapshot();
  }

  async function clearPrincipalState() {
    requireLoaded(loaded);
    const disk = { ...loaded.disk, encryptedPrincipalState: '' };
    writeState(filePath, disk);
    loaded = { ...loaded, disk, principalState: null };
    return snapshot();
  }

  async function signChallenge(challenge = {}) {
    requireLoaded(loaded);
    const principalId = boundedSecret(challenge.principalId, 'principalId', 200);
    const deviceId = String(challenge.deviceId || '');
    const nonce = boundedSecret(challenge.nonce, 'nonce', 4096);
    const expiresAt = Number(challenge.expiresAt);
    if (deviceId !== loaded.disk.deviceId) throw new Error('Gateway challenge device does not match this identity.');
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) throw new Error('Gateway challenge expiry is invalid.');
    const key = await cryptoImpl.subtle.importKey(
      'jwk',
      loaded.privateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    const signed = `relai-device-v1\0${principalId}\0${deviceId}\0${nonce}\0${Math.floor(expiresAt)}`;
    const signature = await cryptoImpl.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      encoder.encode(signed)
    );
    return base64url(new Uint8Array(signature));
  }

  return Object.freeze({
    open,
    snapshot,
    principalState,
    setPrincipalState,
    clearPrincipalState,
    signChallenge,
    statePath: () => filePath
  });
}

function configureGatewaySafeStorage({ safeStorage, platform = process.platform, passwordStore = '' } = {}) {
  requireSafeStorage(safeStorage);
  if (platform !== 'linux' || String(passwordStore).trim().toLowerCase() !== 'basic') return false;
  if (typeof safeStorage.setUsePlainTextEncryption !== 'function') {
    throw new Error('Electron safeStorage does not support the explicitly requested basic password store.');
  }
  safeStorage.setUsePlainTextEncryption(true);
  return true;
}

async function createState(safeStorage, cryptoImpl, uuid) {
  const deviceId = String(uuid()).toLowerCase();
  if (!isUuidV4(deviceId)) throw new Error('Gateway device UUID generation failed.');
  const pair = await cryptoImpl.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = sanitizePublicJwk(await cryptoImpl.subtle.exportKey('jwk', pair.publicKey));
  const privateJwk = await cryptoImpl.subtle.exportKey('jwk', pair.privateKey);
  validatePrivateJwk(privateJwk, publicJwk);
  const disk = {
    version: STATE_VERSION,
    deviceId,
    publicJwk,
    encryptedPrivateKey: encryptJson(safeStorage, privateJwk),
    encryptedPrincipalState: ''
  };
  return { disk, privateJwk, principalState: null };
}

async function readState(filePath, safeStorage, cryptoImpl) {
  try {
    const disk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    validateDiskState(disk);
    const privateJwk = decryptJson(safeStorage, disk.encryptedPrivateKey);
    validatePrivateJwk(privateJwk, disk.publicJwk);
    await validateKeyPair(cryptoImpl, privateJwk, disk.publicJwk);
    const principalState = disk.encryptedPrincipalState
      ? validatePrincipalState(decryptJson(safeStorage, disk.encryptedPrincipalState))
      : null;
    return { disk, privateJwk, principalState };
  } catch (error) {
    throw new Error('Gateway device identity state is corrupted or cannot be decrypted.', { cause: error });
  }
}

function writeState(filePath, disk) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(disk, null, 2)}\n`;
  try {
    fs.writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(temporary, 0o600); } catch {}
    fs.renameSync(temporary, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function validateDiskState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Identity document is invalid.');
  const keys = Object.keys(value).sort();
  const expected = ['deviceId', 'encryptedPrincipalState', 'encryptedPrivateKey', 'publicJwk', 'version'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('Identity document fields are invalid.');
  if (value.version !== STATE_VERSION || !isUuidV4(value.deviceId)) throw new Error('Identity document version or device ID is invalid.');
  if (typeof value.encryptedPrivateKey !== 'string' || !value.encryptedPrivateKey) throw new Error('Encrypted private key is missing.');
  if (typeof value.encryptedPrincipalState !== 'string') throw new Error('Encrypted principal state is invalid.');
  value.publicJwk = sanitizePublicJwk(value.publicJwk);
}

function validatePrincipalState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Principal state is invalid.');
  return {
    principalId: boundedSecret(value.principalId, 'principalId', 200),
    recoverySecret: boundedSecret(value.recoverySecret, 'recoverySecret', 4096)
  };
}

function sanitizePublicJwk(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Public key is invalid.');
  const publicJwk = {
    kty: String(value.kty || ''),
    crv: String(value.crv || ''),
    x: String(value.x || ''),
    y: String(value.y || ''),
    ext: value.ext !== false,
    key_ops: ['verify']
  };
  if (publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256' || !publicJwk.x || !publicJwk.y) {
    throw new Error('Public key is invalid.');
  }
  return publicJwk;
}

function validatePrivateJwk(value, publicJwk) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Private key is invalid.');
  if (
    value.kty !== 'EC' ||
    value.crv !== 'P-256' ||
    typeof value.d !== 'string' || !value.d ||
    value.x !== publicJwk.x ||
    value.y !== publicJwk.y
  ) throw new Error('Private key does not match the public identity.');
}

async function validateKeyPair(cryptoImpl, privateJwk, publicJwk) {
  const privateKey = await cryptoImpl.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const publicKey = await cryptoImpl.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const probe = encoder.encode('relai-gateway-device-identity-v1');
  const signature = await cryptoImpl.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, probe);
  const valid = await cryptoImpl.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, probe);
  if (!valid) throw new Error('Private key does not match the public identity.');
}

function encryptJson(safeStorage, value) {
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  if (!Buffer.isBuffer(encrypted) && !(encrypted instanceof Uint8Array)) throw new Error('Secure storage encryption failed.');
  return Buffer.from(encrypted).toString('base64');
}

function decryptJson(safeStorage, value) {
  if (typeof value !== 'string' || !value) throw new Error('Encrypted value is missing.');
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length) throw new Error('Encrypted value is invalid.');
  return JSON.parse(safeStorage.decryptString(bytes));
}

function requireSafeStorage(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function' || typeof safeStorage.encryptString !== 'function' || typeof safeStorage.decryptString !== 'function') {
    throw new TypeError('Electron safeStorage is required.');
  }
}

function ensureEncryptionAvailable(safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable for the Rel.AI gateway identity.');
}

function requireLoaded(loaded) {
  if (!loaded) throw new Error('Gateway device identity has not been opened.');
}

function boundedSecret(value, name, maxLength) {
  const text = String(value || '').trim();
  const hasControlCharacter = [...text].some(character => {
    const code = character.codePointAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (!text || text.length > maxLength || hasControlCharacter) throw new Error(`${name} is invalid.`);
  return text;
}

function isUuidV4(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

export { STATE_VERSION as GATEWAY_DEVICE_STATE_VERSION, configureGatewaySafeStorage, createGatewayDeviceIdentityStore };
