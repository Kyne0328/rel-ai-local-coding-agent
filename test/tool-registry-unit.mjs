import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  getToolDefinitions,
  getPublicToolDefinitions,
  getToolSchemas,
  getPublicToolSchemas,
  getPublicToolMetadata,
  getToolGroups,
  BRIDGE_TOOL_NAMES,
  PUBLIC_HTTP_TOOL_NAMES
} = require('../src/tools/schema.js');
const { HANDLERS } = require('../src/tools/handlers.js');

const definitions = getToolDefinitions();
const publicDefinitions = getPublicToolDefinitions();
const names = definitions.map((definition) => definition.name);
const publicNames = publicDefinitions.map((definition) => definition.name);

assert.equal(definitions.length, 29);
assert.equal(publicDefinitions.length, 18);
assert.equal(new Set(names).size, names.length, 'tool names must be unique');
assert.equal(new Set(publicNames).size, publicNames.length, 'public tool names must be unique');
assert.deepEqual(BRIDGE_TOOL_NAMES, names);
assert.deepEqual(PUBLIC_HTTP_TOOL_NAMES, publicNames);
assert.deepEqual(getToolSchemas().map((schema) => schema.name), names);
assert.deepEqual(getPublicToolSchemas().map((schema) => schema.name), publicNames);
assert.deepEqual(getPublicToolMetadata().map((tool) => tool.name), publicNames);

for (const definition of definitions) {
  assert.equal(typeof definition.handler, 'string', `${definition.name} must declare a handler`);
  assert.equal(typeof HANDLERS[definition.handler], 'function', `${definition.name} references missing handler ${definition.handler}`);
  assert.ok(definition.inputSchema?.type === 'object', `${definition.name} must define an object schema`);
  assert.ok(definition.behavior && typeof definition.behavior === 'object', `${definition.name} must define behavior metadata`);
  for (const stripped of definition.publicStrip || []) {
    assert.ok(Object.hasOwn(definition.inputSchema.properties || {}, stripped), `${definition.name} strips unknown public property ${stripped}`);
  }
  if (definition.public) assert.ok(definition.publicOrder >= 0, `${definition.name} must define public order`);
  else assert.equal(definition.publicOrder, -1, `${definition.name} must not define public order`);
}

const groups = getToolGroups();
assert.deepEqual(groups.workspace, publicNames);
assert.deepEqual(groups.internal, definitions.filter((definition) => !definition.public).map((definition) => definition.name));
for (const [groupName, groupTools] of Object.entries(groups)) {
  assert.equal(new Set(groupTools).size, groupTools.length, `${groupName} group contains duplicate tools`);
  if (groupName !== 'internal') {
    for (const name of groupTools) assert.ok(publicNames.includes(name), `${groupName} exposes non-public tool ${name}`);
  }
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const mcpSection = readme.split('## MCP tools')[1]?.split('\n---')[0] || '';
const documentedPublicTools = [...mcpSection.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
assert.deepEqual(
  new Set(documentedPublicTools),
  new Set(publicNames),
  'README public tool table must match the registry'
);
assert.equal(documentedPublicTools.length, publicNames.length, 'README public tool table must not contain duplicate rows');

console.log(`Tool registry consistency passed for ${definitions.length} tools (${publicDefinitions.length} public).`);
