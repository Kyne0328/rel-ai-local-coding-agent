import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../contracts/cloud/mcp-manifest.json', import.meta.url), 'utf8'));
assert.equal(manifest.toolSurfaceVersion, 36);

const processTool = manifest.tools.find(tool => tool.name === 'relai_process');
assert.ok(processTool, 'relai_process must be present in the generated public contract');
assert.match(processTool.description, /prefer executable \+ argv/i);
assert.match(processTool.description, /one-shot tests, builds, and checks/i);

const properties = processTool.inputSchema?.properties || {};
assert.match(properties.command?.description || '', /shell syntax/i);
assert.match(properties.executable?.description || '', /shell:false/i);
assert.match(properties.argv?.description || '', /without shell parsing/i);
assert.match(properties.input?.description || '', /without closing the persistent stdin stream/i);

const startBranch = (processTool.inputSchema?.oneOf || []).find(branch => branch?.properties?.action?.const === 'start');
assert.ok(startBranch, 'relai_process start schema branch must be present');
assert.deepEqual(startBranch.required, ['action', 'kind', 'purpose', 'work_id']);
assert.equal(startBranch.oneOf?.length, 2);
assert.deepEqual(startBranch.oneOf[0].required, ['command']);
assert.deepEqual(startBranch.oneOf[1].required, ['executable']);

const startAction = processTool.execution?.actions?.find(action => action.action === 'start');
assert.ok(startAction, 'relai_process start execution metadata must be present');
for (const field of ['command', 'executable', 'argv', 'input', 'reuseExisting']) {
  assert.ok(startAction.fields.includes(field), `relai_process start must expose ${field}`);
}
assert.equal(startAction.taskSupport, 'forbidden');
assert.equal(startAction.executionClass, 'persistent_process');

console.log('Managed-process direct startup discovery guidance passed.');
