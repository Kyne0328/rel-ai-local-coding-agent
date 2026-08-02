import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRelayResponse, relayRequestEnvelope } from '../src/protocol.js';

test('relay request strips authorization and unrelated headers', () => {
  const request = new Request('https://relay.example/mcp', {
    method: 'POST',
    headers: {
      authorization: 'Bearer never-forward-this',
      'content-type': 'application/json',
      'mcp-protocol-version': '2026-07-28',
      'x-untrusted': 'ignored'
    }
  });
  const envelope = relayRequestEnvelope('req_1', request, 'e30=');
  assert.equal(envelope.path, '/mcp');
  assert.equal(envelope.headers.authorization, undefined);
  assert.equal(envelope.headers['x-untrusted'], undefined);
  assert.equal(envelope.headers['content-type'], 'application/json');
});

test('relay response only accepts safe response headers', () => {
  const response = normalizeRelayResponse({
    type: 'response',
    request_id: 'req_1',
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': 'blocked=true',
      'x-arbitrary': 'ignored'
    },
    body_base64: 'e30='
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('set-cookie'), null);
});
