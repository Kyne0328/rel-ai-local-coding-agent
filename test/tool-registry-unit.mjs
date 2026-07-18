import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  getToolDefinitions,
  getToolSchemas,
  getToolMetadata,
  getToolGroups,
  TOOL_NAMES
} = require('../src/tools/schema.js');
const { HANDLERS } = require('../src/tools/handlers.js');

const definitions = getToolDefinitions();
const names = definitions.map(definition => definition.name);
const expected = [
  'relai_repo_snapshot',
  'relai_read',
  'relai_write',
  'relai_replace',
  'relai_tidy_plan',
  'relai_tidy_run',
  'relai_run_checks',
  'relai_browser',
  'relai_diff',
  'relai_restore_changes',
  'relai_status',
  'relai_git_status',
  'relai_git_commit',
  'relai_git_push',
  'relai_git_create_pr',
  'relai_edit',
  'relai_complete_task'
];

assert.equal(definitions.length, 17);
assert.deepEqual(names, expected);
assert.deepEqual(TOOL_NAMES, expected);
assert.equal(new Set(names).size, names.length, 'tool names must be unique');
assert.deepEqual(getToolSchemas().map(schema => schema.name), expected);
assert.deepEqual(getToolMetadata().map(tool => tool.name), expected);

for (const definition of definitions) {
  assert.equal(typeof HANDLERS[definition.handler], 'function', `${definition.name} references missing handler ${definition.handler}`);
  assert.equal(definition.inputSchema?.type, 'object', `${definition.name} must define an object schema`);
  for (const stripped of definition.connectorStrip || []) {
    assert.ok(Object.hasOwn(definition.inputSchema.properties || {}, stripped), `${definition.name} strips unknown connector property ${stripped}`);
  }
  assert.equal(Object.hasOwn(definition, 'public'), false, `${definition.name} must not retain public/internal flags`);
  assert.equal(Object.hasOwn(definition, 'publicOrder'), false, `${definition.name} must not retain public ordering`);
}

const readTool = definitions.find(definition => definition.name === 'relai_read');
assert.ok(readTool, 'read tool must be registered');
assert.ok(readTool.inputSchema.properties.startLine, 'read schema must expose startLine');
assert.ok(readTool.inputSchema.properties.endLine, 'read schema must expose endLine');
assert.ok(readTool.inputSchema.properties.guidanceMode, 'read schema must expose guidanceMode');
assert.match(readTool.description, /bounded line range/);

const completionTool = definitions.find(definition => definition.name === 'relai_complete_task');
assert.ok(completionTool, 'completion tool must be registered');
assert.deepEqual(completionTool.inputSchema.required, ['workspace', 'summary']);
assert.equal(completionTool.inputSchema.properties.summary.minLength, 1);
assert.equal(completionTool.inputSchema.properties.summary.maxLength, 2000);
assert.match(completionTool.description, /final relai_run_checks call succeeds/);

const groups = getToolGroups();
assert.deepEqual(groups.workspace, expected);
assert.equal(Object.hasOwn(groups, 'internal'), false);
for (const [groupName, groupTools] of Object.entries(groups)) {
  assert.equal(new Set(groupTools).size, groupTools.length, `${groupName} group contains duplicate tools`);
  for (const name of groupTools) assert.ok(expected.includes(name), `${groupName} contains an unknown tool ${name}`);
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const mcpSection = readme.split('## MCP tools')[1]?.split('\n---')[0] || '';
const documented = [...mcpSection.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
assert.deepEqual(new Set(documented), new Set(expected), 'README tool table must match the 17-tool registry');
assert.equal(documented.length, expected.length, 'README tool table must not contain duplicate rows');

console.log('Tool registry consistency passed for one 17-tool surface.');
