import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../contracts/cloud/mcp-manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.toolSurfaceVersion, 37);

const processTool = manifest.tools.find(tool => tool.name === 'relai_process');
assert.ok(processTool, 'relai_process must be present in the generated public contract');
assert.match(processTool.description, /prefer executable \+ argv/i);
assert.match(processTool.description, /one-shot tests, builds, and checks/i);

const properties = processTool.inputSchema?.properties || {};
assert.match(properties.command?.description || '', /shell syntax/i);
assert.match(properties.executable?.description || '', /shell:false/i);
assert.match(properties.argv?.description || '', /without shell parsing/i);
assert.match(properties.input?.description || '', /without closing the persistent stdin stream/i);

assert.equal(processTool.inputSchema?.oneOf, undefined, 'relai_process must expose a flat connector input schema');

const startAction = processTool.execution?.actions?.find(action => action.action === 'start');
assert.ok(startAction, 'relai_process start execution metadata must be present');
assert.deepEqual(startAction.required, ['kind', 'purpose', 'work_id']);
for (const field of ['command', 'executable', 'argv', 'input', 'reuseExisting']) {
  assert.ok(startAction.fields.includes(field), `relai_process start must expose ${field}`);
}
assert.equal(startAction.taskSupport, 'forbidden');
assert.equal(startAction.executionClass, 'persistent_process');

console.log('Managed-process direct startup discovery guidance passed.');
