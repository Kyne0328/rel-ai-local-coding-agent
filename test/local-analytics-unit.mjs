import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { flushLocalAnalytics, recordLocalToolOutcome, readLocalUsageSnapshot, readLocalUsageSnapshotAsync } from '../src/localAnalytics.js';
import { failureCategoryFromCode } from '../src/analyticsFailureCategory.js';

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-local-analytics-'));
const config = { stateDir };
try {
  assert.equal(recordLocalToolOutcome(config, { tool: 'relai_inspect', workspace: 'repo', ok: true, durationMs: 100, at: '2026-08-08T10:15:00Z', prompt: 'SECRET_PROMPT', path: 'C:/SECRET_PATH', resultBody: 'SECRET_RESULT' }), true);
  assert.equal(recordLocalToolOutcome(config, { tool: 'relai_edit', workspace: 'repo', ok: false, durationMs: 300, at: '2026-08-08T11:15:00Z', errorCode: 'SENSITIVE_PATH_RESTRICTED', error: 'SECRET_ERROR_MESSAGE', command: 'SECRET_COMMAND' }), true);
  assert.equal(recordLocalToolOutcome(config, { tool: 'relai_inspect', workspace: 'other', ok: true, durationMs: 50, at: '2026-08-08T11:45:00Z' }), true);

  const snapshot = readLocalUsageSnapshot(config, '2026-08');
  assert.equal(snapshot.source, 'local');
  assert.deepEqual(snapshot.totals, {
    requests: 3, toolCalls: 3, successes: 2, failures: 1,
    reliabilityCalls: 3, reliableCalls: 3, infrastructureFailures: 0,
    operationFailures: 1, recoverableFailures: 0, cancellations: 0,
    executionMs: 450, requestBytes: 0, resultBytes: 0, activeDays: 1
  });
  assert.equal(snapshot.series.length, 2);
  assert.deepEqual(snapshot.series.map(row => [row.hour, row.toolCalls]), [['2026-08-08T10', 1], ['2026-08-08T11', 2]]);
  assert.equal(snapshot.tools.find(row => row.tool === 'relai_inspect')?.toolCalls, 2);
  assert.equal(snapshot.tools.find(row => row.tool === 'relai_edit')?.failures, 1);
  assert.equal(snapshot.workspaces.find(row => row.workspace === 'repo')?.toolCalls, 2);
  assert.equal(snapshot.workspaceDimensions.find(row => row.workspace === 'repo')?.displayName, 'This device');
  assert.equal(snapshot.workspaceTools.find(row => row.workspace === 'repo' && row.tool === 'relai_edit')?.failures, 1);
  assert.equal(snapshot.workspaceSeries.filter(row => row.workspace === 'repo').reduce((sum, row) => sum + row.toolCalls, 0), 2);
  assert.equal(failureCategoryFromCode('SENSITIVE_PATH_RESTRICTED'), 'policy');
  assert.deepEqual(snapshot.failureCategories, [{ category: 'policy', failures: 1 }]);
  assert.deepEqual(snapshot.workspaceFailureCategories, [{ deviceId: 'local-device', workspace: 'repo', workspaceKey: 'local-device::repo', category: 'policy', failures: 1 }]);
  assert.deepEqual(snapshot.failureCategorySeries, [{ hour: '2026-08-08T11', category: 'policy', failures: 1 }]);
  assert.deepEqual(snapshot.workspaceFailureCategorySeries, [{ hour: '2026-08-08T11', deviceId: 'local-device', workspace: 'repo', workspaceKey: 'local-device::repo', category: 'policy', failures: 1 }]);

  await flushLocalAnalytics(config);
  const analyticsFile = path.join(stateDir, 'analytics', 'local', '2026-08.json');
  const persisted = fs.readFileSync(analyticsFile, 'utf8');
  for (const secret of ['SECRET_PROMPT', 'SECRET_PATH', 'SECRET_RESULT', 'SECRET_COMMAND', 'SECRET_ERROR_MESSAGE', 'SENSITIVE_PATH_RESTRICTED']) assert.equal(persisted.includes(secret), false, `local analytics must not persist ${secret}`);

  const external = JSON.parse(persisted);
  external.totals.requests = 9;
  external.totals.toolCalls = 9;
  external.totals.successes = 8;
  fs.writeFileSync(analyticsFile, `${JSON.stringify(external)}\n`);
  assert.equal(readLocalUsageSnapshot(config, '2026-08').totals.toolCalls, 3, 'the runtime aggregate path may retain its process-local write cache');
  const freshSnapshot = await readLocalUsageSnapshotAsync(config, '2026-08');
  assert.equal(freshSnapshot.totals.toolCalls, 9, 'desktop analytics reads must bypass another process cache and observe persisted state');
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Local aggregate analytics storage passed.');
