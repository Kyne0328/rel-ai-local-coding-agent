import assert from 'node:assert/strict';
import { ToolSchema } from '@modelcontextprotocol/core';
import { fromJsonSchema } from '@modelcontextprotocol/server';

import { connectorInstructions } from '../src/mcpServer.js';
import { getToolDefinitions } from '../src/tools.js';
import { resolveToolOperation } from '../src/tools/dispatch.js';
import {
  CORE_TOOL_NAMES, TOOL_NAMES, getPublicToolSchemas,
  getToolDefinitions as getDefinitionMetadata, getToolGroups, getToolMetadata,
  getToolSchemas, getToolSurfaceManifest
} from '../src/tools/schema.js';

const compactConfig = { toolProfile: 'compact', workspaces: {} };
const coreConfig = { toolProfile: 'core', workspaces: {} };
const expectedCompact = [
  'relai_work', 'relai_snapshot', 'relai_read', 'relai_search', 'relai_inspect', 'relai_edit',
  'relai_exec', 'relai_process', 'relai_worktree', 'relai_validate', 'relai_changes', 'relai_publish'
];
const expectedCore = ['relai_work', 'relai_read', 'relai_search', 'relai_inspect', 'relai_edit', 'relai_exec', 'relai_validate'];
const removedDirectNames = [
  'relai_begin_work', 'relai_repo_snapshot', 'relai_code_inspect', 'relai_process_start',
  'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list',
  'relai_worktree_create', 'relai_semantic_search', 'relai_run_checks', 'relai_http_probe',
  'relai_diff', 'relai_status', 'relai_finish_work'
];

assert.deepEqual(TOOL_NAMES, expectedCompact);
assert.deepEqual(CORE_TOOL_NAMES, expectedCore);
assert.deepEqual(getDefinitionMetadata(compactConfig).map(item => item.name), expectedCompact);
assert.deepEqual(getDefinitionMetadata(coreConfig).map(item => item.name), expectedCore);
assert.equal(getToolDefinitions(compactConfig).length, 12);
assert.equal(getToolDefinitions(coreConfig).length, 7);

const compactSchemas = getToolSchemas(compactConfig);
const compactPublic = getPublicToolSchemas(compactConfig);
const corePublic = getPublicToolSchemas(coreConfig);
const compactBytes = bytes(compactPublic);
const coreBytes = bytes(corePublic);
assert.ok(compactBytes < 29_000, `compact discovery schema is ${compactBytes} bytes`);
assert.ok(coreBytes < 17_000, `core discovery schema is ${coreBytes} bytes`);
assert.ok(coreBytes < compactBytes);
assert.ok(Buffer.byteLength(JSON.stringify(connectorInstructions(compactConfig)), 'utf8') < 512);

const compactManifest = getToolSurfaceManifest(compactConfig);
assert.equal(compactManifest.schemaVersion, 4);
assert.equal(compactManifest.toolSurfaceVersion, 31);
assert.equal(compactManifest.profile, 'compact');
assert.equal(compactManifest.toolCount, 12);
assert.deepEqual(compactManifest.tools.map(item => item.name), expectedCompact);
assert.deepEqual(compactManifest.deprecations, []);
assert.deepEqual(compactManifest.compatibilityAliases, {});
assert.equal(Object.hasOwn(compactManifest, 'migration'), false);
assert.deepEqual(getToolSurfaceManifest(coreConfig).tools.map(item => item.name), expectedCore);

for (const schema of compactSchemas) {
  assert.equal(ToolSchema.safeParse(schema).success, true, `${schema.name} must satisfy ToolSchema`);
  assert.equal(Object.hasOwn(compactPublic.find(item => item.name === schema.name), 'outputSchema'), false);
}
for (const removed of removedDirectNames) {
  assert.equal(resolveToolOperation(removed, {}), null, `${removed} must not resolve as a public tool`);
  assert.equal(compactPublic.some(tool => tool.name === removed), false, `${removed} must not be discovered`);
}

const schemaByName = new Map(compactSchemas.map(schema => [schema.name, schema]));
assert.deepEqual(schemaByName.get('relai_work').inputSchema.properties.action.enum, ['begin', 'status', 'finish', 'cancel']);
assert.deepEqual(schemaByName.get('relai_process').inputSchema.properties.action.enum, ['start', 'read', 'write', 'stop', 'list']);
assert.ok(schemaByName.get('relai_process').inputSchema.properties.kind.enum.includes('service'));

await valid('relai_work', { action: 'begin', workspace: 'repo' });
await invalid('relai_work', { action: 'begin' });
await valid('relai_work', { action: 'finish', work_id: 'work', summary: 'Done.' });
await invalid('relai_work', { action: 'finish', work_id: 'work' });
await valid('relai_process', { action: 'start', work_id: 'work', command: 'npm run dev', kind: 'service', purpose: 'Run the development server.' });
await invalid('relai_process', { action: 'start', work_id: 'work', command: 'npm test' });
await valid('relai_process', { action: 'read', work_id: 'work', processId: 'p', includeMetadata: false });
await invalid('relai_process', { action: 'read', work_id: 'work', processId: 'p', command: 'ignored' });
await invalid('relai_work', { action: 'status', title: 'ignored' });
await valid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxFiles: 200 });
await invalid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxFiles: 201 });
await valid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', maxResults: 100 });
await invalid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', maxResults: 101 });
await valid('relai_validate', { action: 'http', work_id: 'work', route: '/health', timeoutMs: 600000 });
await invalid('relai_validate', { action: 'http', work_id: 'work', route: '/health', level: 'release' });
await invalid('relai_validate', { action: 'http', work_id: 'work', route: '/health', timeoutMs: 600001 });

assert.throws(() => resolveToolOperation('relai_work', { action: 'begin', workspace: 'repo', work_id: 'invalid' }), /Unsupported field 'work_id'/);
assert.throws(() => resolveToolOperation('relai_work', { action: 'status', title: 'invalid' }), /Unsupported field 'title'/);
assert.throws(() => resolveToolOperation('relai_process', { action: 'read', work_id: 'work', processId: 'p', command: 'invalid' }), /Unsupported field 'command'/);
assert.throws(() => resolveToolOperation('relai_process', { action: 'read', work_id: 'work', processId: 'p', unknown: true }), /Unsupported field 'unknown'/);
assert.equal(resolveToolOperation('relai_validate', { action: 'checks', work_id: 'work' }).operationName, 'relai_run_checks');
assert.equal(resolveToolOperation('relai_validate', { action: 'http', work_id: 'work', route: '/health' }).operationName, 'relai_http_probe');

const metadata = getToolMetadata(compactConfig);
const validateMetadata = metadata.find(item => item.name === 'relai_validate');
assert.equal(validateMetadata.taskSupport, 'optional');
assert.equal(validateMetadata.actions.find(item => item.action === 'checks').taskSupport, 'optional');
assert.equal(validateMetadata.actions.find(item => item.action === 'http').taskSupport, 'forbidden');
assert.equal(validateMetadata.actions.find(item => item.action === 'http').executionClass, 'bounded_synchronous');
assert.ok(validateMetadata.actions.find(item => item.action === 'http').fields.includes('route'));
const processMetadata = metadata.find(item => item.name === 'relai_process');
assert.ok(processMetadata.actions.find(item => item.action === 'start').required.includes('kind'));
assert.ok(processMetadata.actions.find(item => item.action === 'start').required.includes('purpose'));
const groups = getToolGroups(compactConfig);
assert.ok(groups.git.includes('relai_publish'));
assert.ok(groups.cleanup.includes('relai_changes'));
for (const removedProfile of ['legacy', 'full', 'compact,legacy']) {
  assert.throws(() => getToolSchemas({ toolProfile: removedProfile, workspaces: {} }), /Removed profiles|Invalid Rel\.AI tool profile/);
}

console.log(`Hard-cutover tool profiles and action contracts passed: compact ${compactBytes}, core ${coreBytes} bytes.`);

function bytes(tools) { return Buffer.byteLength(JSON.stringify({ tools }), 'utf8'); }
async function valid(name, value) {
  const result = await fromJsonSchema(schemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.equal(result.issues, undefined, `${name} valid input: ${JSON.stringify(result.issues || [])}`);
}
async function invalid(name, value) {
  const result = await fromJsonSchema(schemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.ok(result.issues?.length, `${name} must reject ${JSON.stringify(value)}`);
}
