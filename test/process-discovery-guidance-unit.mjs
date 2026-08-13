import assert from 'node:assert/strict';

import { getPublicToolSchemas, getToolSurfaceManifest } from '../src/tools/schema.js';

const processTool = getPublicToolSchemas().find(tool => tool.name === 'relai_process');
assert.ok(processTool, 'relai_process must be present in the public MCP contract');
assert.match(processTool.description, /prefer executable \+ argv/i);
assert.match(processTool.description, /relai_exec or relai_validate for one-shot work/i);

const properties = processTool.inputSchema?.properties || {};
for (const field of ['command', 'executable', 'argv', 'input']) {
  assert.ok(properties[field], `relai_process public input schema must expose ${field}`);
}
assert.equal(processTool.inputSchema?.oneOf, undefined, 'relai_process must expose a flat connector input schema');

const processManifest = getToolSurfaceManifest().tools.find(tool => tool.name === 'relai_process');
assert.ok(processManifest, 'relai_process execution metadata must be present');
const startAction = processManifest.actions?.find(action => action.action === 'start');
assert.ok(startAction, 'relai_process start execution metadata must be present');
assert.deepEqual(startAction.required, ['kind', 'purpose', 'work_id']);
for (const field of ['command', 'executable', 'argv', 'input', 'reuseExisting']) {
  assert.ok(startAction.fields.includes(field), `relai_process start must expose ${field}`);
}
assert.equal(startAction.taskSupport, 'forbidden');
assert.equal(startAction.executionClass, 'persistent_process');

console.log('Managed-process direct startup discovery guidance passed.');
