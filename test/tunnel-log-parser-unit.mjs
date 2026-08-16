import assert from 'node:assert/strict';

import { createTunnelLogParser, normalizeTunnelLogRecord } from '../electron/tunnel-log-parser.js';

const entries = [];
const parser = createTunnelLogParser({
  onEntry: entry => entries.push(entry),
  now: () => '2026-08-16T05:00:00.000Z'
});

parser.write('{"time":"2026-08-16T12:39:08+08:00","level":"WARN","msg":"poll failed; back');
parser.write('ing off","component":"controlplane","error":"unexpected EOF","retry_in_ms":10000}');
parser.write('{"level":"INFO","msg":"provided","component":"mcpclient"}\nplain fallback line\n');
parser.flush();

assert.equal(entries.length, 3, 'fragmented, concatenated, and plain records must each produce one event');
assert.equal(entries[0].code, 'tunnel_connection_interrupted');
assert.equal(entries[0].level, 'warning');
assert.equal(entries[0].component, 'controlplane');
assert.equal(entries[0].details.retryInMs, 10000);
assert.equal(entries[0].details.lastError, 'unexpected EOF');
assert.equal(entries[1].level, 'debug', 'dependency-injection startup noise must be demoted');
assert.equal(entries[2].message, 'plain fallback line');

const rejected = normalizeTunnelLogRecord(JSON.stringify({
  time: '2026-08-16T13:17:00.255+08:00',
  level: 'ERROR',
  msg: 'request failed',
  component: 'controlplane',
  status_code: 401,
  error: 'Authorization: Bearer secret-token sk-runtime-secret-123456'
}));
assert.equal(rejected.code, 'tunnel_authentication_failed');
assert.equal(rejected.message, 'OpenAI rejected the tunnel runtime API key.');
assert.equal(rejected.details.httpStatus, 401);
assert.doesNotMatch(JSON.stringify(rejected), /secret-token|sk-runtime-secret/);

const denied = normalizeTunnelLogRecord('{"level":"ERROR","msg":"forbidden","component":"controlplane","status_code":403}');
assert.equal(denied.code, 'tunnel_access_denied');
const missing = normalizeTunnelLogRecord('{"level":"ERROR","msg":"tunnel lookup failed","component":"controlplane","status_code":404}');
assert.equal(missing.code, 'tunnel_not_found');

console.log('Tunnel log parser normalizes fragmented structured output safely.');
