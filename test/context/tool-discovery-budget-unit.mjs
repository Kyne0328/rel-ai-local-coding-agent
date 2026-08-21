import assert from 'node:assert/strict';

import { baseline, measure } from '../../scripts/measure-tool-surface.mjs';
import { getToolSurfaceManifest } from '../../src/tools/schema.js';

const current = measure();
assert.ok(current.discoverySchemaBytes < baseline.discoverySchemaBytes, 'consolidated tool discovery must stay smaller than the historical 30-tool baseline');
assert.ok(current.globalInstructionBytes < baseline.globalInstructionBytes, 'global instructions must stay smaller than the historical baseline');

const surface = getToolSurfaceManifest();
for (const tool of surface.tools) {
  assert.ok(Array.isArray(tool.outputFields), `${tool.name} must expose on-demand output metadata in the tool-surface resource`);
  assert.ok(tool.outputFields.includes('ok'), `${tool.name} output metadata must include ok`);
}

console.log('Tool discovery remains below the historical prompt budget and detailed output metadata stays on demand.');
