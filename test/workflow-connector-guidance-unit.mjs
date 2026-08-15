import assert from 'node:assert/strict';
import { serializeConnectorResult } from '../src/tools/connector.js';
import { outputSchemaFor } from '../src/tools/outputSchemas.js';
import { normalizeWorkflowSnapshot } from '../src/workflow/contracts.js';
import { OPERATION_IDS as OP } from '../src/tools/operationIds.js';

const workflow = normalizeWorkflowSnapshot({
  stage: 'verify',
  intent: 'bugfix',
  confidence: 'high',
  boundary: { level: 'package', packageIds: ['npm:front-end'], changedFiles: ['front-end/src/app.js'], impactedPaths: [], affectedTests: ['front-end/test/app.test.js'] },
  risk: { level: 'medium', reasons: ['behavior-changing source edit'] },
  evidence: { fresh: 1, stale: 0, reusable: 0, lastMutationGeneration: 2, lastValidatedMutationGeneration: 1 },
  recommendedActions: Array.from({ length: 9 }, (_, index) => ({ tool: 'relai_validate', action: 'checks', priority: index + 1, reason: `Run focused check ${index}`, args: { check: `check-${index}` } })),
  avoidActions: [],
  completion: { hardReady: false, blockers: ['validation'] }
});
assert.ok(Buffer.byteLength(JSON.stringify(workflow)) <= 8192);
assert.ok(workflow.recommendedActions.length <= 5);
const result = serializeConnectorResult({
  publicName: 'relai_read',
  action: 'file',
  operationName: OP.READ,
  value: { ok: true, workspace: 'repo', items: [], workflow },
  workId: 'task-1'
});
assert.deepEqual(result.workflow, workflow);
assert.equal(result.work_id, 'task-1');
const readSchema = outputSchemaFor(OP.READ);
assert.ok(readSchema.properties.workflow, 'closed success schema must admit workflow');
assert.equal(readSchema.oneOf[0].additionalProperties, false);
assert.equal(Object.hasOwn(readSchema.properties, 'unrelatedUnknownField'), false);
const checksSchema = outputSchemaFor(OP.VALIDATE_CHECKS);
assert.equal(checksSchema.properties.executedUnits.type, 'number');
assert.equal(checksSchema.properties.reusedUnits.type, 'number');
assert.equal(checksSchema.properties.reusedChecks.type, 'array');
console.log('Connector workflow guidance and closed-schema tests passed.');