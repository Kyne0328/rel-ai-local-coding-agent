import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OUTCOME_CLASSES, classifyAnalyticsOutcome } from '../src/analyticsOutcome.js';
import { flushLocalAnalytics, recordLocalToolOutcome, readLocalUsageSnapshot } from '../src/localAnalytics.js';
import { analyticsBounds, analyticsRangeScope, normalizeUsageSnapshot } from '../src/ui/features/usage/range-model.js';
import { renderUsage } from '../src/ui/features/usage/render.js';

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
  assert.equal(scope.reliabilityRate.toFixed(2), '66.67');
  assert.equal(scope.operationSuccessRate, 0, 'all recorded operations in this fixture failed even though two failures were reliable tool behavior');

  const legacy = normalizeUsageSnapshot({
    source: 'local',
    month: '2026-08',
    totals: { requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 0, resultBytes: 0, executionMs: 10, activeDays: 1 },
    tools: [], devices: [], workspaces: [], workspaceDimensions: [], workspaceTools: [],
    series: [{ hour: '2026-08-15T02', requests: 2, toolCalls: 2, successes: 1, failures: 1, requestBytes: 0, resultBytes: 0, executionMs: 10 }],
    toolSeries: [], workspaceSeries: [], workspaceToolSeries: []
  }, '2026-08');
  const legacyScope = analyticsRangeScope([legacy], bounds);
  assert.equal(legacyScope.operationSuccessRate, 50, 'legacy successes and failures remain available as raw operation success');
  assert.equal(legacyScope.reliabilityRate, null, 'legacy analytics must not be guessed into the new reliability denominator');
  assert.equal(legacyScope.reliabilityCalls, 0);

  const legacyContent = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  };
  renderUsage(legacyContent, { bounds, current: legacyScope, previous: analyticsRangeScope([], bounds) });
  assert.match(legacyContent.innerHTML, /Starts (?:with newly classified calls|measuring with new actions)/);
  assert.doesNotMatch(legacyContent.innerHTML, /Operation success/);

  const legacyStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-reliability-v1-'));
  try {
    const analyticsDir = path.join(legacyStateDir, 'analytics', 'local');
    fs.mkdirSync(analyticsDir, { recursive: true });
    const legacyAggregate = {
      requests: 10, toolCalls: 10, successes: 9, failures: 1, executionMs: 100,
      reliabilityCalls: 10, reliableCalls: 9, infrastructureFailures: 1,
      operationFailures: 0, recoverableFailures: 0, cancellations: 0
    };
    fs.writeFileSync(path.join(analyticsDir, '2026-08.json'), JSON.stringify({
      schemaVersion: 1,
      month: '2026-08',
      totals: legacyAggregate,
      tools: [], workspaces: [], workspaceTools: [],
      failureCategories: [{ category: 'runtime', failures: 1 }], workspaceFailureCategories: [],
      hours: [{
        hour: '2026-08-15T02', ...legacyAggregate,
        tools: [], workspaces: [], workspaceTools: [],
        failureCategories: [{ category: 'runtime', failures: 1 }], workspaceFailureCategories: []
      }]
    }));
    const migrated = readLocalUsageSnapshot({ stateDir: legacyStateDir }, '2026-08');
    assert.equal(migrated.totals.successes, 9);
    assert.equal(migrated.totals.failures, 1);
    assert.equal(migrated.totals.reliabilityCalls, 0, 'schema-v1 reliability counters are ambiguous and must be reset during migration');
    assert.equal(migrated.totals.infrastructureFailures, 0);

    recordLocalToolOutcome({ stateDir: legacyStateDir }, { tool: 'relai_read', workspace: 'repo', ok: true, durationMs: 5, at: '2026-08-15T02:30:00Z' });
    const afterNewCall = readLocalUsageSnapshot({ stateDir: legacyStateDir }, '2026-08');
    assert.equal(afterNewCall.totals.successes, 10, 'raw operation history is preserved across the migration');
    assert.equal(afterNewCall.totals.failures, 1);
    assert.equal(afterNewCall.totals.reliabilityCalls, 1, 'reliability starts with the first newly classified call');
    assert.equal(afterNewCall.totals.reliableCalls, 1);
    await flushLocalAnalytics({ stateDir: legacyStateDir });
    const migratedDocument = JSON.parse(fs.readFileSync(path.join(analyticsDir, '2026-08.json'), 'utf8'));
    assert.equal(migratedDocument.schemaVersion, 2);
    assert.equal(migratedDocument.totals.reliabilityCalls, 1);
  } finally {
    fs.rmSync(legacyStateDir, { recursive: true, force: true });
  }

  const content = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  };
  renderUsage(content, { bounds, current: scope, previous: analyticsRangeScope([], bounds) });
  assert.match(content.innerHTML, />Reliable (?:calls|actions)</);
  assert.doesNotMatch(content.innerHTML, />Operation success</);
  assert.match(content.innerHTML, />System errors</);
  assert.match(content.innerHTML, /Rel\.AI internal errors only/);
  assert.doesNotMatch(content.innerHTML, />Retryable errors</);
  assert.match(content.innerHTML, /usage-side-by-side/);
  const failureHeading = content.innerHTML.includes('What went wrong') ? 'What went wrong' : 'Failure categories';
  const projectHeading = content.innerHTML.includes('Project activity') ? 'Project activity' : 'Workspace activity';
  assert.ok(content.innerHTML.indexOf(failureHeading) < content.innerHTML.indexOf(projectHeading), 'failure categories should sit beside project activity in the compact final row');

  await flushLocalAnalytics(config);
  const persisted = fs.readFileSync(path.join(stateDir, 'analytics', 'local', '2026-08.json'), 'utf8');
  for (const secret of ['spawn EINVAL', 'Operation cancelled.', 'found 2 matches']) {
    assert.equal(persisted.includes(secret), false, `reliability classification must not persist raw error text: ${secret}`);
  }
} finally {
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Analytics reliability classification tests passed.');
