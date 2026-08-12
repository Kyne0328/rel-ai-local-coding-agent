import assert from 'node:assert/strict';
import { sanitizeText, sanitizeDiagnosticValue, buildDiagnosticReport } from '../src/diagnostics.js';

const secret = 'super-secret-value';
const sanitized = sanitizeText([
  `Authorization: Bearer ${secret}`,
  `https://example.test/dashboard?token=${secret}&bootstrap=${secret}&code=${secret}`,
  `api_key: ${secret}`,
  `{"token":"${secret}","password":"${secret}"}`
].join('\n'));
assert.doesNotMatch(sanitized, new RegExp(secret));
assert.match(sanitized, /\[redacted\]/);

const objectValue = sanitizeDiagnosticValue({
  token: secret,
  nested: { clientSecret: secret, safe: 'visible' },
  list: [{ authorization: secret }]
});
assert.equal(objectValue.token, '[redacted]');
assert.equal(objectValue.nested.clientSecret, '[redacted]');
assert.equal(objectValue.nested.safe, 'visible');
assert.equal(objectValue.list[0].authorization, '[redacted]');

const report = buildDiagnosticReport({
  workspace: 'example',
  health: { findings: [{ severity: 'error', code: 'workspace_unavailable', workspace: 'example', path: 'C:/missing', message: `token=${secret}` }] },
  aliasCheck: { workspaces: [{ alias: 'example', staleKeys: ['npm:test:old'] }] },
  cautionData: { windowHours: 24, workspaces: [{ alias: 'example', count: 1, recent: [{ tool: 'relai_edit', ts: '2026-07-25T00:00:00.000Z', reason: `Bearer ${secret}` }] }] },
  connection: { tunnelId: 'tunnel_12345678', token: 'set' },
  connectionState: { publicEndpoint: { status: 'available' }, error: { code: 'local_port_in_use', message: `password=${secret}` } },
  runtimeLogs: {
    available: true,
    persistent: true,
    entries: [
      { ts: '2026-07-25T00:03:00.000Z', level: 'info', source: 'desktop', message: 'third' },
      { ts: '2026-07-25T00:01:00.000Z', level: 'error', source: 'openai-tunnel', code: 'public_endpoint_failed', message: `{"token":"${secret}"}` },
      { ts: '2026-07-25T00:02:00.000Z', level: 'warning', source: 'local-service', message: 'second' }
    ]
  },
  auditLogs: {
    entries: [
      { ts: '2026-07-25T00:04:00.000Z', ok: false, tool: 'relai_edit', workspace: 'example', error: 'fourth failure' },
      { ts: '2026-07-25T00:02:00.000Z', ok: true, tool: 'relai_read', workspace: 'example' },
      { ts: '2026-07-25T00:03:00.000Z', ok: false, tool: 'relai_validate', workspace: 'example', error: `client_secret=${secret}` }
    ]
  },
  activeCalls: 2
});

assert.equal(report.ok, true);
assert.ok(report.summary.blocking >= 1);
assert.ok(report.findings.some(item => item.code === 'workspace_unavailable'));
assert.ok(report.findings.every(item => item.action?.href));
assert.equal(report.findings.some(item => item.code === 'public_endpoint_failed'), false, 'a connected Secure MCP Tunnel must not be reported unavailable');
assert.equal(report.maintenance.history.blocked, true);
assert.equal(report.maintenance.runtimeLogs.available, true);
assert.equal(report.maintenance.all.available, true);
assert.equal(report.maintenance.all.blocked, true);
assert.equal(report.maintenance.all.confirmation, 'RESET');
assert.equal(report.logs.runtime.persistent, true);
assert.deepEqual(report.logs.runtime.entries.map(item => item.ts), ['2026-07-25T00:01:00.000Z','2026-07-25T00:02:00.000Z','2026-07-25T00:03:00.000Z']);
assert.equal(report.logs.failedActivity.length, 2);
assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
assert.match(report.reportText, /Rel\.AI MCP diagnostic report/);
assert.doesNotMatch(report.reportText, new RegExp(secret));

const disconnected = buildDiagnosticReport({
  connection: { tunnelId: '', token: 'set' },
  connectionState: { publicEndpoint: { status: 'disabled' }, error: null },
  runtimeLogs: { available: false, entries: [] },
  activeCalls: 0
});
assert.ok(disconnected.findings.some(item => item.code === 'public_endpoint_failed'));
assert.equal(disconnected.findings.some(item => item.code === 'configuration_invalid'), false);

const missingBearer = buildDiagnosticReport({
  connection: { tunnelId: 'tunnel_12345678', token: 'missing' },
  connectionState: { publicEndpoint: { status: 'available' }, error: null },
  runtimeLogs: { available: false, entries: [] }
});
assert.ok(missingBearer.findings.some(item => item.code === 'configuration_invalid'));
assert.equal(JSON.stringify(missingBearer).includes('approval_token'), false);

console.log('Secure tunnel diagnostics and sanitization tests passed.');
