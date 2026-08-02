import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomPairingCode,
  sha256Base64Url,
  tokenFromDeviceProtocol
} from '../src/security.js';

test('base64url encoding round-trips bytes', () => {
  const input = Uint8Array.from([0, 1, 2, 253, 254, 255]);
  assert.deepEqual(base64UrlToBytes(bytesToBase64Url(input)), input);
});

test('pairing codes omit ambiguous characters', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(randomPairingCode(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }
});

test('token hashing is deterministic without returning plaintext', async () => {
  const first = await sha256Base64Url('secret');
  const second = await sha256Base64Url('secret');
  assert.equal(first, second);
  assert.notEqual(first, 'secret');
});

test('device protocol extracts the one-time connection ticket', () => {
  assert.equal(tokenFromDeviceProtocol('relai-device.relai_ticket_abc123'), 'relai_ticket_abc123');
});
