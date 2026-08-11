import assert from 'node:assert/strict';
import { buildWorkflowEvidenceReceipt, repeatFailureCount } from '../src/workflow/evidence.js';
import { decideWorkflow } from '../src/workflow/decision.js';

const audit = generation => ({ ts: '2026-08-08T00:00:00.000Z', taskMutationGeneration: generation, taskWorkspaceGeneration: generation });
const failed = generation => buildWorkflowEvidenceReceipt({
  tool: 'relai_validate',
  args: { action: 'checks', command: 'npm test', cwd: 'front-end', target: 'front-end' },
  result: { ok: false, exitCode: 1, errorCode: 'EXIT_1', stderr: 'secret failure output' },
  auditEntry: audit(generation),
  repositoryFingerprint: 'fp',
  commandId: 'npm:front-end:test'
});
const receipts = [failed(3), failed(3)];
assert.equal(receipts[0].failureSignature, receipts[1].failureSignature);
assert.equal(JSON.stringify(receipts).includes('secret failure output'), false);
assert.equal(repeatFailureCount(receipts, 3), 2);
assert.equal(repeatFailureCount(receipts, 4), 0, 'a mutation generation must reset the retry epoch');
const repair = decideWorkflow({
  intent: 'bugfix',
  boundary: { level: 'package', changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] },
  risk: { level: 'medium', reasons: [] },
  completion: { hardReady: false, blockers: ['validation'] },
  evidence: { fresh: 2, stale: 0, reusable: 0 },
  repeatCount: repeatFailureCount(receipts, 3)
});
assert.equal(repair.stage, 'repair');
assert.equal(repair.recommendedActions[0]?.tool, 'relai_inspect');
assert.ok(repair.avoidActions.some(item => /repeat/i.test(item.action)));
const rerun = decideWorkflow({
  intent: 'bugfix',
  boundary: { level: 'package', changedFiles: ['front-end/src/app.js'], affectedTests: ['front-end/test/app.test.js'] },
  risk: { level: 'medium', reasons: [] },
  completion: { hardReady: false, blockers: ['validation'] },
  evidence: { fresh: 0, stale: 2, reusable: 0 },
  repeatCount: repeatFailureCount(receipts, 4)
});
assert.equal(rerun.stage, 'verify');
assert.equal(rerun.recommendedActions[0]?.tool, 'relai_validate');
console.log('Repeated-failure retry strategy tests passed.');