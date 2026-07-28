import assert from 'node:assert/strict';

import { buildExtraAudit } from "../src/tools/session.js";

assert.deepEqual(
  buildExtraAudit('relai_edit', { plannerPath: 'replace', plannerReason: 'exact text supplied' }, { path: 'src/example.js' }),
  { plannerPath: 'replace', plannerReason: 'exact text supplied', filePath: 'src/example.js' }
);

assert.deepEqual(
  buildExtraAudit('relai_run_checks', {
    validationLevel: 'release',
    validationLevelReason: 'requested',
    aliasNormalizations: 0,
    policy: { sessionActive: false }
  }, {}),
  {
    validationLevel: 'release',
    validationLevelReason: 'requested',
    aliasNormalizations: 0,
    policySessionActive: false
  }
);

assert.deepEqual(
  buildExtraAudit('relai_read', { items: [{ cacheHit: false }, { cacheHit: true }] }, {}),
  { cacheHit: true }
);

assert.deepEqual(
  buildExtraAudit('relai_exec', {
    commandSummary: 'npm test --token [REDACTED]',
    cwd: '.',
    exitCode: 1,
    durationMs: 42,
    stdoutBytes: 100,
    stderrBytes: 20,
    stdoutTruncated: false,
    stderrTruncated: true,
    timedOut: false,
    mutationTracking: 'git',
    environmentKeys: ['CI'],
    changedFiles: ['package-lock.json']
  }, {}),
  {
    commandSummary: 'npm test --token [REDACTED]',
    cwd: '.',
    exitCode: 1,
    durationMs: 42,
    stdoutBytes: 100,
    stderrBytes: 20,
    stdoutTruncated: false,
    stderrTruncated: true,
    timedOut: false,
    mutationTracking: 'git',
    environmentKeys: ['CI'],
    changedFiles: ['package-lock.json']
  }
);

assert.deepEqual(
  buildExtraAudit('relai_repo_snapshot', { effectiveMaxEntries: 0, budgetMultiplied: false }, {}),
  { effectiveSnapshotMaxFiles: 0, budgetMultiplied: false }
);

assert.deepEqual(buildExtraAudit('relai_status', {}, {}), {});
assert.deepEqual(buildExtraAudit('relai_edit', { plannerPath: '', plannerReason: '' }, {}), {});
assert.deepEqual(buildExtraAudit('removed_tool', {}, {}), {});

console.log('Tool session audit enrichment tests passed for active tools.');
