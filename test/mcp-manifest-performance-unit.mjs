import assert from 'node:assert/strict';

import { buildToolManifest } from '../src/mcp/toolManifest.js';

const first = buildToolManifest({});
assert.ok(Array.isArray(first.tools) && first.tools.length > 0,
  'the cached MCP manifest must contain the published tool surface');
assert.ok(first.hash && first.version,
  'the cached MCP manifest must expose stable identity metadata');

for (let iteration = 0; iteration < 1000; iteration += 1) {
  const repeated = buildToolManifest({});
  assert.equal(repeated, first,
    'repeated MCP discovery must reuse the cached manifest instead of rebuilding tool schemas');
}

console.log('MCP manifest reuse stays constant-time after the first build.');
