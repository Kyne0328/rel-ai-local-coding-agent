import assert from 'node:assert/strict';
import {
  BOUNDARY_LEVELS,
  RISK_LEVELS,
  WORKFLOW_INTENTS,
  WORKFLOW_STAGES,
  deterministicActionId,
  normalizeWorkflowSnapshot
} from '../src/workflow/contracts.js';

assert.deepEqual(WORKFLOW_STAGES, ['understand', 'investigate', 'design', 'implement', 'verify', 'review', 'repair', 'complete', 'blocked']);
assert.deepEqual(WORKFLOW_INTENTS, ['auto', 'investigation', 'bugfix', 'feature', 'refactor', 'migration', 'documentation', 'review', 'release']);
assert.deepEqual(RISK_LEVELS, ['low', 'medium', 'high', 'critical']);
assert.deepEqual(BOUNDARY_LEVELS, ['file', 'package', 'cross_package', 'repository', 'release']);

const action = { tool: 'relai_validate', action: 'checks', args: { cwd: 'front-end', check: 'npm test' } };
assert.equal(deterministicActionId(action), deterministicActionId(structuredClone(action)));
assert.match(deterministicActionId(action), /^relai_validate:checks:/);

const normalized = normalizeWorkflowSnapshot({
  version: 99,
  stage: 'made-up',
  intent: 'nonsense',
  risk: { level: 'impossible', reasons: ['x'] },
  boundary: { level: 'unknown', changedFiles: Array.from({ length: 250 }, (_, index) => `src/${index}.js`) },
  recommendedActions: Array.from({ length: 9 }, (_, index) => ({ tool: 'relai_read', action: 'read', priority: index + 1, reason: `Reason ${index}` })),
  avoidActions: Array.from({ length: 20 }, (_, index) => ({ action: `avoid-${index}`, reason: 'bounded' })),
  completion: { hardReady: 'yes', blockers: ['missing validation'] }
});
assert.equal(normalized.version, 1);
assert.equal(normalized.stage, 'understand');
assert.equal(normalized.intent, 'auto');
assert.equal(normalized.risk.level, 'low');
assert.equal(normalized.boundary.level, 'file');
assert.equal(normalized.recommendedActions.length, 5);
assert.ok(normalized.boundary.changedFiles.length <= 200);
assert.equal(normalized.completion.hardReady, false);
assert.ok(Buffer.byteLength(JSON.stringify(normalized)) <= 8192);

console.log('Workflow contract normalization and bounds tests passed.');