import assert from 'node:assert/strict';

import { compactSessionSummary, compactWorkflowContext } from '../../src/context/session-compactor.js';

const session = compactSessionSummary({
  title: 'Fix connector timeout',
  objective: 'Fix connector timeout without changing unrelated behavior.',
  status: 'waiting',
  changedFiles: ['src/connector.js'],
  validationStatus: 'passed',
  summary: 'Kept the connector alive after idle recovery.',
  currentStage: 'Verification',
  currentActivity: 'Ran focused connector tests.',
  lastTool: 'relai_validate',
  lastOutcome: 'succeeded',
  workflowEvidence: [{ kind: 'check', outcome: 'passed', sourceTool: 'relai_validate', commandId: 'test:connector', paths: ['src/connector.js'], command: 'secret-bearing command must not enter recovery' }],
  events: [{ stdout: 'raw log output must not enter summary' }],
  workflow: {
    completion: { hardReady: true, blockers: [], recommendations: [] },
    recommendedActions: []
  }
});
assert.equal(session.goal, 'Fix connector timeout without changing unrelated behavior.');
assert.deepEqual(session.changes, ['src/connector.js']);
assert.equal(session.validation, 'passed');
assert.equal(session.status, 'waiting');
assert.equal(session.summary, 'Kept the connector alive after idle recovery.');
assert.equal(session.current.stage, 'Verification');
assert.equal(session.recentEvidence[0].check, 'test:connector');
assert.doesNotMatch(JSON.stringify(session), /raw log output/);
assert.doesNotMatch(JSON.stringify(session), /secret-bearing command/);

const internal = {
  version: 1,
  stage: 'verify',
  intent: 'bugfix',
  confidence: 'high',
  boundary: { level: 'package', packageIds: ['npm:root'], changedFiles: ['src/a.js'], impactedPaths: [], affectedTests: [] },
  risk: { level: 'low', reasons: ['no task-owned mutation'] },
  evidence: { fresh: 8, stale: 0, reusable: 4, lastMutationGeneration: 1, lastValidatedMutationGeneration: 1 },
  recommendedActions: [{ id: 'internal-id', priority: 1, tool: 'relai_validate', action: 'checks', reason: 'Run focused tests.', blocking: false, estimatedCost: 'small', args: { check: 'npm test' } }],
  avoidActions: [],
  completion: { hardReady: false, blockers: ['validation'], recommendations: [] },
  repeatCount: 0
};
const compactWorkflow = compactWorkflowContext(internal);
assert.equal(Object.hasOwn(compactWorkflow, 'confidence'), false);
assert.equal(Object.hasOwn(compactWorkflow, 'evidence'), false);
assert.equal(Object.hasOwn(compactWorkflow.recommendedActions[0], 'id'), false);
assert.equal(Object.hasOwn(compactWorkflow.recommendedActions[0], 'priority'), false);
assert.equal(Object.hasOwn(compactWorkflow.recommendedActions[0], 'estimatedCost'), false);
assert.equal(Object.hasOwn(compactWorkflow, 'risk'), false, 'default low-risk boilerplate must be omitted');
assert.deepEqual(compactWorkflow.completion.blockers, ['validation']);
assert.ok(Buffer.byteLength(JSON.stringify(compactWorkflow)) < Buffer.byteLength(JSON.stringify(internal)));

console.log('Session and workflow compaction retain decisions while dropping raw and repeated metadata.');
