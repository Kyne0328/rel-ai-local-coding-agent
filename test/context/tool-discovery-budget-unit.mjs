import assert from 'node:assert/strict';

import { budget, measure } from '../../scripts/measure-tool-surface.mjs';
import { getToolSurfaceManifest } from '../../src/tools/schema.js';

const current = measure();
assert.ok(current.discoverySchemaBytes <= budget.discoverySchemaBytes, `tool discovery must stay within the ${budget.discoverySchemaBytes}-byte model-facing budget`);
assert.ok(current.globalInstructionBytes < budget.globalInstructionBytes, 'global instructions must stay smaller than the historical baseline');

const surface = getToolSurfaceManifest();
for (const tool of surface.tools) {
  assert.ok(Array.isArray(tool.outputFields), `${tool.name} must expose on-demand output metadata in the tool-surface resource`);
  assert.ok(tool.outputFields.includes('ok'), `${tool.name} output metadata must include ok`);
}

console.log('Tool discovery remains within the model-facing prompt budget and detailed output metadata stays on demand.');
