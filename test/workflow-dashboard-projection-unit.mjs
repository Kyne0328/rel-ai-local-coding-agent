import assert from 'node:assert/strict';
import fs from 'node:fs';

import { sanitizeTaskRecordForProjection } from '../src/taskObservability.js';
import { workSessionStateView } from '../src/ui/task-identity.js';

const sanitized = sanitizeTaskRecordForProjection({
  id: 'task-1',
  status: 'inactive',
  workflowEvidence: [{ metadata: { stdout: 'must-not-leak' }, command: 'npm test' }],
  workflow: {
    stage: 'verify',
    risk: { level: 'medium', reasons: ['private detail'] },
    boundary: { level: 'package', changedFiles: ['secret/private.js'] },
    evidence: { fresh: 2, stale: 1, reusable: 1 },
    repeatCount: 3,
    recommendedActions: [{ tool: 'relai_validate', action: 'checks', reason: 'Run affected frontend test', args: { command: 'secret command' } }]
  }
});
assert.deepEqual(sanitized.workflow, {
  stage: 'verify',
  risk: 'medium',
  boundary: 'package',
  recommendedAction: 'Run affected frontend test',
  evidenceFresh: 2,
  evidenceStale: 1,
  repeatCount: 3
});
assert.equal(Object.hasOwn(sanitized, 'workflowEvidence'), false, 'dashboard-safe task records must never include raw evidence receipts');
assert.equal(JSON.stringify(sanitized).includes('secret command'), false);
assert.equal(JSON.stringify(sanitized).includes('secret/private.js'), false);

const inactive = workSessionStateView({ status: 'inactive' });
assert.equal(inactive.status, 'inactive');
assert.equal(inactive.label, 'Inactive');
assert.equal(inactive.terminal, false);
assert.equal(inactive.active, false);
const inactiveValidationFailure = workSessionStateView({ status: 'inactive', resumeStatus: 'validation_failed' });
assert.equal(inactiveValidationFailure.status, 'inactive');
assert.equal(inactiveValidationFailure.label, 'Validation failed', 'inactive history should surface its last meaningful state instead of flattening every session to Inactive');
assert.equal(inactiveValidationFailure.terminal, false);
assert.equal(workSessionStateView({ status: 'inactive', validation: 'failed' }).label, 'Validation failed', 'existing inactive history with failed validation must recover useful context');

const ui = fs.readFileSync('src/ui/features/sessions/index.js', 'utf8');
assert.match(ui, /workflow\.stage/);
assert.match(ui, /workflow\.recommendedAction/);
assert.match(ui, /medium.*high.*critical|medium.*critical.*high|high.*medium.*critical/i);
assert.match(ui, /resumable/i);

console.log('Dashboard workflow summary and resumable inactivity projection tests passed.');