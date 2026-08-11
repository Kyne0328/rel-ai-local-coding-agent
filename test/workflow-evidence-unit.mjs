import assert from 'node:assert/strict';

import {
  buildWorkflowEvidenceReceipt,
  checkEvidenceReusable,
  repeatFailureCount
} from '../src/workflow/evidence.js';

const auditEntry = { ts: '2026-08-08T00:00:00.000Z', taskMutationGeneration: 3, taskWorkspaceGeneration: 8 };
const receipt = buildWorkflowEvidenceReceipt({
  tool: 'relai_exec',
  args: { command: 'npm test', cwd: 'front-end', env: { TOKEN: 'secret' } },
  result: { ok: true, exitCode: 0, stdout: 'private output', stderr: '', commandSummary: 'npm test' },
  auditEntry,
  repositoryFingerprint: 'fingerprint-a',
  commandId: 'npm:front-end:test'
});
assert.equal(receipt.kind, 'check');
assert.equal(receipt.commandId, 'npm:front-end:test');
assert.equal(receipt.command, 'npm test');
assert.equal(receipt.cwd, 'front-end');
assert.equal(receipt.outcome, 'passed');
assert.equal(receipt.mutationGeneration, 3);
assert.equal(receipt.workspaceGeneration, 8);
assert.equal(JSON.stringify(receipt).includes('private output'), false);
assert.equal(JSON.stringify(receipt).includes('secret'), false);
assert.equal(checkEvidenceReusable(receipt, { commandId: 'npm:front-end:test', command: 'npm test', cwd: 'front-end', repositoryFingerprint: 'fingerprint-a' }), true);
assert.equal(checkEvidenceReusable(receipt, { commandId: 'npm:front-end:test', command: 'npm test', cwd: 'front-end', repositoryFingerprint: 'fingerprint-b' }), false);

const failures = [
  buildWorkflowEvidenceReceipt({ tool: 'relai_exec', args: { command: 'npm test', cwd: 'front-end' }, result: { ok: false, exitCode: 1, errorCode: 'EXIT_1' }, auditEntry, repositoryFingerprint: 'x', commandId: 'npm:front-end:test' }),
  buildWorkflowEvidenceReceipt({ tool: 'relai_exec', args: { command: 'npm test', cwd: 'front-end' }, result: { ok: false, exitCode: 1, errorCode: 'EXIT_1' }, auditEntry, repositoryFingerprint: 'x', commandId: 'npm:front-end:test' })
];
assert.equal(repeatFailureCount(failures, 3), 2);
assert.equal(repeatFailureCount(failures, 4), 0, 'mutation generation resets retry epoch');

const reviewReceipt = buildWorkflowEvidenceReceipt({
  tool: 'relai_changes',
  args: { action: 'diff' },
  result: { ok: true, reviewHash: 'abc123', reviewScope: 'task' },
  auditEntry,
  repositoryFingerprint: 'fingerprint-a'
});
assert.equal(reviewReceipt.kind, 'review');
assert.equal(reviewReceipt.metadata.reviewHash, 'abc123');
assert.equal(reviewReceipt.metadata.reviewScope, 'task');
console.log('Safe workflow evidence receipt and reuse tests passed.');