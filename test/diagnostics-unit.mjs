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
    revision: 7,
    entries: [
      { ts: '2026-07-25T00:03:00.000Z', level: 'info', source: 'desktop-observability', code: 'activity_listener_failed', taskId: 'task-runtime-7', eventId: 'event-runtime-7', workspace: 'example', tool: 'relai_read', operation: 'Read src/app.js', message: 'third' },
      { ts: '2026-07-25T00:01:00.000Z', level: 'error', source: 'openai-tunnel', code: 'public_endpoint_failed', message: `{"token":"${secret}"}` },
      { ts: '2026-07-25T00:02:00.000Z', level: 'warning', source: 'local-service', message: 'second' }
    ]
  },
  auditLogs: {
    entries: [
      { ts: '2026-07-25T00:04:00.000Z', eventId: 'event-edit-1', taskId: 'task-42', ok: false, tool: 'relai_edit', workspace: 'example', errorCode: 'PATCH_CONTEXT_MISMATCH', error: 'fourth failure' },
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
assert.equal(report.logs.runtime.revision, 7, 'diagnostic snapshots must preserve the runtime-log revision for live replay ordering');
assert.deepEqual(report.logs.runtime.entries.map(item => item.ts), ['2026-07-25T00:01:00.000Z','2026-07-25T00:02:00.000Z','2026-07-25T00:03:00.000Z']);
assert.equal(report.logs.runtime.entries.at(-1).code, 'activity_listener_failed', 'technical log codes must not collapse to a generic UI error code');
assert.equal(report.logs.runtime.entries.at(-1).taskId, 'task-runtime-7');
assert.equal(report.logs.runtime.entries.at(-1).eventId, 'event-runtime-7');
assert.equal(report.logs.runtime.entries.at(-1).tool, 'relai_read');
assert.equal(report.logs.failedActivity.length, 2);
assert.equal(report.logs.failedActivity.at(-1).taskId, 'task-42');
assert.equal(report.logs.failedActivity.at(-1).eventId, 'event-edit-1');
assert.equal(report.logs.failedActivity.at(-1).errorCode, 'PATCH_CONTEXT_MISMATCH');
assert.match(report.reportText, /code=activity_listener_failed/);
assert.match(report.reportText, /task=task-runtime-7 event=event-runtime-7 tool=relai_read operation=Read src\/app\.js/);
assert.match(report.reportText, /code=PATCH_CONTEXT_MISMATCH workspace=example task=task-42 event=event-edit-1/);
assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
assert.match(report.reportText, /Rel\.AI MCP diagnostic report/);
assert.doesNotMatch(report.reportText, new RegExp(secret));

const persistenceFailure = buildDiagnosticReport({
  connection: { tunnelId: 'tunnel_12345678', token: 'set' },
  connectionState: { publicEndpoint: { status: 'available' }, error: null },
  runtimeLogs: { available: true, entries: [] },
  auditLogs: {
    entries: [],
    persistence: {
      healthy: false,
      pending: 3,
      retryCount: 4,
      droppedEntries: 0,
      lastFailureAt: '2026-07-25T00:05:00.000Z',
      lastError: `EACCES password=${secret}`
    }
  }
});
const persistenceFinding = persistenceFailure.findings.find(item => item.code === 'local_history_persistence_failed');
assert.ok(persistenceFinding, 'persistent audit write failures must become a visible troubleshooting finding');
assert.match(persistenceFinding.title, /Activity history/);
assert.match(persistenceFinding.recommendation, /disk space|write permissions/i);
assert.doesNotMatch(JSON.stringify(persistenceFinding), new RegExp(secret), 'technical persistence errors must still be sanitized');

const disconnected = buildDiagnosticReport({
  connection: { tunnelId: '', token: 'set' },
  connectionState: { publicEndpoint: { status: 'disabled' }, error: null },
  runtimeLogs: { available: false, entries: [] },
  activeCalls: 0
});
const disconnectedTunnelFinding = disconnected.findings.find(item => item.code === 'public_endpoint_failed');
assert.ok(disconnectedTunnelFinding);
assert.equal(disconnectedTunnelFinding.action.kind, 'restart_connection');
assert.equal(disconnectedTunnelFinding.action.href, '#connection');
assert.equal(disconnected.findings.some(item => item.code === 'configuration_invalid'), false);

const missingBearer = buildDiagnosticReport({
  connection: { tunnelId: 'tunnel_12345678', token: 'missing' },
  connectionState: { publicEndpoint: { status: 'available' }, error: null },
  runtimeLogs: { available: false, entries: [] }
});
assert.ok(missingBearer.findings.some(item => item.code === 'configuration_invalid'));
assert.equal(JSON.stringify(missingBearer).includes('approval_token'), false);

console.log('Secure tunnel diagnostics and sanitization tests passed.');
