import assert from 'node:assert/strict';
import test from 'node:test';
import {
  constantTimeEqual,
  normalizeRedirectUris,
  normalizeScope,
  oauthUrls,
  validCodeVerifier
} from '../src/oauth.js';

test('OAuth URLs are bound to the configured public origin', () => {
  const urls = oauthUrls(
    new Request('http://127.0.0.1:8787/mcp'),
    { PUBLIC_BASE_URL: 'https://relay.example' }
  );
  assert.deepEqual(urls, {
    issuer: 'https://relay.example',
    resource: 'https://relay.example/mcp',
    protectedResourceMetadata: 'https://relay.example/.well-known/oauth-protected-resource',
    authorization: 'https://relay.example/authorize',
    token: 'https://relay.example/token',
    registration: 'https://relay.example/register',
    revocation: 'https://relay.example/revoke'
  });
});

test('OAuth public base URL rejects insecure non-loopback origins', () => {
  assert.throws(
    () => oauthUrls(new Request('https://relay.example/mcp'), { PUBLIC_BASE_URL: 'http://relay.example' }),
    /must use HTTPS/
  );
});

test('redirect URI validation permits HTTPS and loopback HTTP only', () => {
  assert.deepEqual(normalizeRedirectUris([
    'https://chatgpt.com/callback',
    'http://127.0.0.1:9876/callback',
    'https://chatgpt.com/callback'
  ]), [
    'https://chatgpt.com/callback',
    'http://127.0.0.1:9876/callback'
  ]);
  assert.throws(() => normalizeRedirectUris(['http://example.com/callback']), /must use HTTPS/);
  assert.throws(() => normalizeRedirectUris(['https://example.com/callback#fragment']), /must not contain/);
});

test('scope normalization requires mcp and preserves offline access', () => {
  assert.equal(normalizeScope('offline_access mcp mcp'), 'mcp offline_access');
  assert.equal(normalizeScope('mcp'), 'mcp');
  assert.throws(() => normalizeScope('offline_access'), /mcp scope is required/);
  assert.throws(() => normalizeScope('mcp admin'), /unsupported/);
});

test('PKCE verifier and constant-time comparison helpers enforce boundaries', () => {
  assert.equal(validCodeVerifier('a'.repeat(43)), true);
  assert.equal(validCodeVerifier('a'.repeat(42)), false);
  assert.equal(validCodeVerifier('a'.repeat(129)), false);
  assert.equal(validCodeVerifier('a'.repeat(42) + '!'), false);
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'different'), false);
});
