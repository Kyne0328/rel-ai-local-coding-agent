import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExtraAudit } = require('../src/tools/session.js');

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
  buildExtraAudit('relai_write', {}, { path: 'src/write.js' }),
  { filePath: 'src/write.js' }
);

assert.deepEqual(
  buildExtraAudit('relai_replace', {}, { path: 'src/replace.js' }),
  { filePath: 'src/replace.js' }
);

assert.deepEqual(
  buildExtraAudit('relai_read', { items: [{ cacheHit: false }, { cacheHit: true }] }, {}),
  { cacheHit: true }
);

assert.deepEqual(
  buildExtraAudit('relai_repo_snapshot', { effectiveMaxEntries: 0, budgetMultiplied: false }, {}),
  { effectiveMaxIndexFiles: 0, budgetMultiplied: false }
);

assert.deepEqual(buildExtraAudit('relai_status', {}, {}), {});
assert.deepEqual(buildExtraAudit('relai_edit', { plannerPath: '', plannerReason: '' }, {}), {});
assert.deepEqual(buildExtraAudit('removed_tool', {}, {}), {});

console.log('Tool session audit enrichment tests passed for active tools.');
