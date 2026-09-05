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
assert.equal(Object.hasOwn(sanitized, 'workflow'), false, 'obsolete advisory workflow state must not reach the dashboard projection');
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
assert.doesNotMatch(ui, /workflow\.stage|workflow\.recommendedAction/);

console.log('Dashboard strips obsolete workflow guidance while preserving resumable inactivity state.');