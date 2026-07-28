import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {
  buildSafeActivityProjection,
  sanitizeCompletionSummary,
  sanitizeDisplayText,
  sanitizeTaskRecord
} = await import('../src/taskObservability.js');
const { createToolActivityTracker } = await import('../src/toolActivity.js');
const {
  getTaskHistoryDir,
  readTaskHistorySession,
  recordTaskActivityEvent
} = await import('../src/taskHistoryStore.js');
const { mergeDashboardActivity } = await import('../src/http/dashboardData.js');

const syntheticSecrets = [
  'Authorization: Bearer relai_test_bearer_123456',
  'authorization: Basic dXNlcjpwYXNz',
  'password=hunter2-synthetic',
  'CLIENT_SECRET="client-secret-synthetic"',
  'api_key=api-key-synthetic',
  'ACCESS_TOKEN=access-token-synthetic',
  'refresh_token=refresh-token-synthetic',
  'Cookie: session=session-secret-synthetic',
  'Set-Cookie: auth=cookie-secret-synthetic; HttpOnly',
  'https://user:pass@example.test/path?token=query-secret&safe=value',
  'approval_code=approval-secret-synthetic'
];
for (const value of syntheticSecrets) {
  const sanitized = sanitizeCompletionSummary(`Completed work. ${value}`);
  assert.doesNotMatch(sanitized, /(?:hunter2|synthetic|query-secret|dXNlcjpwYXNz|relai_test_bearer)/i, value);
  assert.match(sanitized, /redacted/i, value);
}
assert.equal(
  sanitizeCompletionSummary('Updated the tokenizer and documented the authorization flow.'),
  'Updated the tokenizer and documented the authorization flow.'
);
assert.equal(sanitizeDisplayText('safe=value and version=0.23.0', 200), 'safe=value and version=0.23.0');
assert.throws(() => sanitizeCompletionSummary({ summary: 'not a primitive' }), /string/);
assert.throws(() => sanitizeCompletionSummary('   '), /required/);
const long = sanitizeCompletionSummary(`${'a'.repeat(2500)} password=secret-at-tail`, 2000);
assert.equal(long.length, 2000);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-observability-security-'));
const config = { stateDir: sandbox, auditLogPath: path.join(sandbox, 'audit.jsonl') };
fs.writeFileSync(config.auditLogPath, '', 'utf8');
const tracker = createToolActivityTracker({ idleMs: 60_000 });
tracker.onToolActivity(event => recordTaskActivityEvent(config, event));
const originalSecret = 'production-path-secret-123456';
try {
  const start = tracker.beginConnectorToolCall({
    tool: 'relai_start_task',
    operation: 'Starting security regression task',
    workspace: 'repo',
    createTask: true
  });
  const taskId = start.taskId;
  start({ ok: true });

  const complete = tracker.beginConnectorToolCall({
    tool: 'relai_complete_task',
    operation: 'Reporting task completion',
    workspace: 'repo',
    taskId
  });
  complete.requestCompletion({
    summary: `Implemented safely. Authorization: Bearer ${originalSecret}\npassword=${originalSecret}`,
    validationStatus: 'passed'
  });
  complete({ ok: true });

  const session = readTaskHistorySession(config, taskId);
  assert.equal(session.status, 'completed');
  const dashboard = mergeDashboardActivity({ entries: [] }, [session], 500);
  const safeCopy = buildSafeActivityProjection(dashboard.entries.at(-1) || {});
  const inspected = JSON.stringify({ tracker: tracker.getToolActivity(), session, dashboard, safeCopy });
  assert.equal(inspected.includes(originalSecret), false, inspected);
  assert.match(inspected, /redacted/i);

  const rawHistory = fs.readdirSync(getTaskHistoryDir(config))
    .filter(name => name.endsWith('.json'))
    .map(name => fs.readFileSync(path.join(getTaskHistoryDir(config), name), 'utf8'))
    .join('\n');
  assert.equal(rawHistory.includes(originalSecret), false, rawHistory);

  const historicalTaskId = 'historical-unsafe-task';
  const historicalFile = path.join(
    getTaskHistoryDir(config),
    `${crypto.createHash('sha256').update(historicalTaskId).digest('hex')}.json`
  );
  fs.writeFileSync(historicalFile, JSON.stringify({
    id: historicalTaskId,
    taskId: historicalTaskId,
    status: 'inactive',
    summary: `token=${originalSecret}`,
    resultSummary: `Authorization: Bearer ${originalSecret}`,
    endedAt: new Date().toISOString(),
    events: [{ eventId: 'legacy-event', summary: `password=${originalSecret}` }]
  }));
  const historical = readTaskHistorySession(config, historicalTaskId);
  assert.equal(historical.status, 'cancelled');
  assert.equal(JSON.stringify(historical).includes(originalSecret), false);
  assert.equal(JSON.stringify(sanitizeTaskRecord(historical)).includes(originalSecret), false);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Completion-summary privacy is enforced across tracker, persistence, dashboard, SSE projection, and copy-safe JSON.');
