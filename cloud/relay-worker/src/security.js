const encoder = new TextEncoder();

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function randomDeviceId() {
  return `device_${crypto.randomUUID().replaceAll('-', '')}`;
}

function randomPairingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const characters = Array.from(bytes, value => alphabet[value % alphabet.length]);
  return `${characters.slice(0, 4).join('')}-${characters.slice(4).join('')}`;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function verifyEd25519Jwk({ publicKeyJwk, signatureBase64Url, message }) {
  if (!publicKeyJwk || publicKeyJwk.kty !== 'OKP' || publicKeyJwk.crv !== 'Ed25519' || !publicKeyJwk.x) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      base64UrlToBytes(publicKeyJwk.x),
      { name: 'Ed25519' },
      false,
      ['verify']
    );
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      base64UrlToBytes(signatureBase64Url),
      encoder.encode(String(message))
    );
  } catch {
    return false;
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const input = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  const padded = input.padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bearerToken(request) {
  const value = request.headers.get('authorization') || '';
  return /^Bearer\s+/i.test(value) ? value.slice(7).trim() : '';
}

function deviceWebSocketProtocol(request) {
  const protocols = String(request.headers.get('sec-websocket-protocol') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const selected = protocols.find(value => /^relai-device\.[A-Za-z0-9_-]{32,256}$/.test(value));
  return selected || '';
}

function tokenFromDeviceProtocol(protocol) {
  return String(protocol || '').replace(/^relai-device\./, '');
}

export {
  bearerToken,
  base64UrlToBytes,
  bytesToBase64Url,
  deviceWebSocketProtocol,
  randomBase64Url,
  randomDeviceId,
  randomPairingCode,
  sha256Base64Url,
  tokenFromDeviceProtocol,
  verifyEd25519Jwk
};
