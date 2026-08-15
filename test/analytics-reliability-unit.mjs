import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OUTCOME_CLASSES, classifyAnalyticsOutcome } from '../src/analyticsOutcome.js';
import { flushLocalAnalytics, recordLocalToolOutcome, readLocalUsageSnapshot } from '../src/localAnalytics.js';
import { analyticsBounds, analyticsRangeScope, normalizeUsageSnapshot } from '../src/ui/features/usage/range-model.js';

assert.equal(classifyAnalyticsOutcome({ ok: true }), OUTCOME_CLASSES.SUCCESS);
assert.equal(classifyAnalyticsOutcome({ ok: false, operationName: 'relai_validate', errorMessage: 'test exited 1' }), OUTCOME_CLASSES.OPERATION_FAILURE);
assert.equal(classifyAnalyticsOutcome({ ok: false, operationName: 'relai_edit', errorCode: 'EDIT_CONTEXT_MISMATCH' }), OUTCOME_CLASSES.RECOVERABLE_FAILURE);
assert.equal(classifyAnalyticsOutcome({ ok: false, errorMessage: 'Path is a directory: node_modules' }), OUTCOME_CLASSES.INFRASTRUCTURE_FAILURE);
assert.equal(classifyAnalyticsOutcome({ ok: false, errorMessage: 'ExceptionGroup: unhandled errors in a TaskGroup' }), OUTCOME_CLASSES.INFRASTRUCTURE_FAILURE);
assert.equal(classifyAnalyticsOutcome({ ok: false, errorMessage: 'Operation cancelled.' }), OUTCOME_CLASSES.CANCELLED);

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-reliability-'));
const config = { stateDir };
try {
  const at = '2026-08-15T02:00:00Z';
  recordLocalToolOutcome(config, { tool: 'relai_validate', operationName: 'relai_validate', workspace: 'repo', ok: false, errorMessage: 'test exited 1', durationMs: 10, at });
  recordLocalToolOutcome(config, { tool: 'relai_edit', operationName: 'relai_edit', workspace: 'repo', ok: false, errorCode: 'EDIT_CONTEXT_MISMATCH', errorMessage: 'found 2 matches', durationMs: 20, at });
  recordLocalToolOutcome(config, { tool: 'relai_exec', operationName: 'relai_exec', workspace: 'repo', ok: false, errorMessage: 'spawn EINVAL', durationMs: 30, at });
  recordLocalToolOutcome(config, { tool: 'relai_exec', operationName: 'relai_exec', workspace: 'repo', ok: false, errorMessage: 'Operation cancelled.', durationMs: 40, at });

  const snapshot = readLocalUsageSnapshot(config, '2026-08');
  assert.equal(snapshot.totals.failures, 4, 'raw operation failures remain visible');
  assert.equal(snapshot.totals.reliabilityCalls, 3, 'explicit cancellation is excluded from reliability denominator');
  assert.equal(snapshot.totals.reliableCalls, 2, 'validation and recoverable edit failures still count as reliable tool behavior');
  assert.equal(snapshot.totals.infrastructureFailures, 1);
  assert.equal(snapshot.totals.operationFailures, 1);
  assert.equal(snapshot.totals.recoverableFailures, 1);
  assert.equal(snapshot.totals.cancellations, 1);

  const model = normalizeUsageSnapshot(snapshot, '2026-08');
  const bounds = analyticsBounds('24h', { now: new Date('2026-08-15T03:00:00Z') });
  const scope = analyticsRangeScope([model], bounds);
  assert.equal(scope.successRate.toFixed(2), '66.67');

  const legacy = normalizeUsageSnapshot({
    source: 'local',
    month: '2026-08',
    totals: { requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 0, resultBytes: 0, executionMs: 10, activeDays: 1 },
    tools: [], devices: [], workspaces: [], workspaceDimensions: [], workspaceTools: [],
    series: [{ hour: '2026-08-15T02', requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 0, resultBytes: 0, executionMs: 10 }],
    toolSeries: [], workspaceSeries: [], workspaceToolSeries: []
  }, '2026-08');
  const legacyScope = analyticsRangeScope([legacy], bounds);
  assert.equal(legacyScope.successRate, 50, 'legacy analytics use the conservative historical success/failure fallback');

  await flushLocalAnalytics(config);
  const persisted = fs.readFileSync(path.join(stateDir, 'analytics', 'local', '2026-08.json'), 'utf8');
  for (const secret of ['spawn EINVAL', 'Operation cancelled.', 'found 2 matches']) {
    assert.equal(persisted.includes(secret), false, `reliability classification must not persist raw error text: ${secret}`);
  }
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Analytics reliability classification tests passed.');
