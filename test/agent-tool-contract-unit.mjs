import assert from 'node:assert/strict';

import {
  TOOL_SURFACE_VERSION,
  getCatalogAction,
  getCatalogToolDefinition,
  resolveToolOperation
} from '../src/tools/actionCatalog.js';
import { getExecutableToolDefinition } from '../src/tools/runtimeRegistry.js';
import { validateToolOutput } from '../src/tools/outputValidation.js';

assert.equal(TOOL_SURFACE_VERSION, 41);

const definition = getCatalogToolDefinition('relai_agent');
assert.ok(definition, 'relai_agent must be publicly discoverable');
assert.deepEqual(definition.inputSchema.properties.action.enum, [
  'create', 'attach', 'status', 'complete', 'fail', 'cancel'
]);

const create = getCatalogAction('relai_agent', { action: 'create' });
assert.equal(create.operationName, 'relai_agent_create');
assert.equal(create.required.includes('work_id'), true, 'parent-side creation requires the parent work_id');
assert.equal(create.required.includes('workspace'), true);
assert.equal(create.required.includes('objective'), true);

const attach = getCatalogAction('relai_agent', { action: 'attach' });
assert.equal(attach.required.includes('work_id'), true, 'attachment requires a distinct child work_id');
assert.equal(attach.required.includes('agent_id'), true);
assert.equal(attach.fields.includes('workspace'), false, 'child workspace is derived from its bound work_id');

const status = getCatalogAction('relai_agent', { action: 'status' });
assert.equal(status.required.includes('waitMs'), false);
assert.equal(status.fields.includes('waitMs'), true, 'status exposes an optional bounded wait');
assert.deepEqual(definition.inputSchema.properties.waitMs, { type: 'number', minimum: 0, maximum: 60000, multipleOf: 1 });

for (const action of ['status', 'complete', 'fail', 'cancel']) {
  const entry = getCatalogAction('relai_agent', { action });
  assert.equal(entry.required.includes('work_id'), false, `${action} must not require the parent work_id`);
  assert.equal(entry.required.includes('agent_id'), true);
}
assert.equal(getCatalogAction('relai_agent', { action: 'complete' }).required.includes('child_work_id'), true);
assert.equal(getCatalogAction('relai_agent', { action: 'fail' }).required.includes('child_work_id'), true);

const agentId = `agent_${'a'.repeat(43)}`;
const executableAttach = getExecutableToolDefinition('relai_agent', {}, { action: 'attach', agent_id: agentId, work_id: 'work_child' });
assert.equal(typeof executableAttach?.handler, 'function');
const executableStatus = getExecutableToolDefinition('relai_agent', {}, { action: 'status', agent_id: agentId, waitMs: 250 });
assert.equal(typeof executableStatus?.handler, 'function');
assert.equal(executableStatus?.behavior.executionClass, 'bounded_synchronous');
const executableComplete = getExecutableToolDefinition('relai_agent', {}, {
  action: 'complete', agent_id: agentId, child_work_id: 'work_child', result: { summary: 'done' }
});
assert.equal(typeof executableComplete?.handler, 'function');

const complete = resolveToolOperation('relai_agent', {
  action: 'complete',
  agent_id: `agent_${'b'.repeat(43)}`,
  child_work_id: 'work_child',
  result: { summary: 'Structured result.' }
});
assert.equal(complete.operationName, 'relai_agent_complete');
assert.equal(complete.operationArgs.child_work_id, 'work_child');
assert.deepEqual(complete.operationArgs.result, { summary: 'Structured result.' });

const createOutput = create.outputSchema;
assert.equal(createOutput.additionalProperties, undefined);
assert.ok(createOutput.properties.agent_id);
assert.ok(createOutput.properties.parent_work_id);
assert.ok(createOutput.properties.child_work_id);
assert.ok(createOutput.properties.objective);
assert.ok(createOutput.properties.agentResult);

await validateToolOutput({}, 'relai_agent', {
  action: 'create', workspace: 'repo', objective: 'Review the change.', work_id: 'work_parent'
}, {
  ok: true,
  agent_id: `agent_${'c'.repeat(43)}`,
  parent_work_id: 'work_parent',
  child_work_id: null,
  workspace: 'repo',
  role: 'reviewer',
  reasoning: 'high',
  connectorName: 'Rel.AI MCP',
  objective: 'Review the change.',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  attachedAt: null,
  completedAt: null,
  agentResult: null,
  error: null
});

console.log('relai_agent discovery, parent/child task binding, routing, handler, and output-schema contracts passed.');
