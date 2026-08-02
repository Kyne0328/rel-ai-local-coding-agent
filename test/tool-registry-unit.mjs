import assert from 'node:assert/strict';
import { ToolSchema } from '@modelcontextprotocol/core';
import { fromJsonSchema } from '@modelcontextprotocol/server';

import { connectorInstructions } from '../src/mcpServer.js';
import { getToolDefinitions } from '../src/tools.js';
import { LEGACY_TO_COMPACT, resolveToolOperation } from '../src/tools/dispatch.js';
import {
  LEGACY_TOOL_NAMES,
  TOOL_NAMES,
  getPublicToolSchemas,
  getToolDefinitions as getDefinitionMetadata,
  getToolGroups,
  getToolMetadata,
  getToolSchemas,
  getToolSurfaceManifest
} from '../src/tools/schema.js';

const compactConfig = { toolProfile: 'compact', workspaces: {} };
const legacyConfig = { toolProfile: 'legacy', workspaces: {} };
const expectedCompact = [
  'relai_work', 'relai_snapshot', 'relai_read', 'relai_search', 'relai_inspect', 'relai_edit',
  'relai_exec', 'relai_process', 'relai_worktree', 'relai_validate', 'relai_changes', 'relai_publish'
];
const expectedLegacy = [
  'relai_begin_work', 'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_code_inspect', 'relai_exec',
  'relai_process_start', 'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list',
  'relai_worktree_create', 'relai_worktree_list', 'relai_worktree_remove', 'relai_semantic_search',
  'relai_diagnostics_run', 'relai_tidy_plan', 'relai_tidy_run', 'relai_run_checks', 'relai_http_probe',
  'relai_diff', 'relai_restore_paths', 'relai_reset_workspace', 'relai_status', 'relai_git_commit',
  'relai_git_push', 'relai_git_draft_pr', 'relai_edit', 'relai_cancel_work', 'relai_finish_work'
];

assert.deepEqual(TOOL_NAMES, expectedCompact);
assert.deepEqual(LEGACY_TOOL_NAMES, expectedLegacy);
assert.deepEqual(getDefinitionMetadata(compactConfig).map(item => item.name), expectedCompact);
assert.deepEqual(getDefinitionMetadata(legacyConfig).map(item => item.name), expectedLegacy);
assert.equal(getToolDefinitions(compactConfig).length, 12);
assert.equal(getToolDefinitions(legacyConfig).length, 30);

const compactSchemas = getToolSchemas(compactConfig);
const compactPublic = getPublicToolSchemas(compactConfig);
const legacyPublic = getPublicToolSchemas(legacyConfig);
const compactBytes = Buffer.byteLength(JSON.stringify({ tools: compactPublic }), 'utf8');
const legacyBytes = Buffer.byteLength(JSON.stringify({ tools: legacyPublic }), 'utf8');
assert.ok(compactBytes < 18_000, `compact discovery schema is ${compactBytes} bytes`);
assert.ok(legacyBytes > compactBytes);
assert.ok(compactBytes <= Math.floor(legacyBytes * 0.6), `expected at least 40% reduction: ${legacyBytes} -> ${compactBytes}`);
assert.ok(Buffer.byteLength(JSON.stringify(connectorInstructions(compactConfig)), 'utf8') < 512);

const compactManifest = getToolSurfaceManifest(compactConfig);
assert.equal(compactManifest.schemaVersion, 2);
assert.equal(compactManifest.toolSurfaceVersion, 29);
assert.equal(compactManifest.profile, 'compact');
assert.equal(compactManifest.toolCount, 12);
assert.deepEqual(compactManifest.tools.map(item => item.name), expectedCompact);
assert.deepEqual(compactManifest.deprecations, []);
assert.equal(Object.keys(compactManifest.migration).length, 30);

const legacyManifest = getToolSurfaceManifest(legacyConfig);
assert.equal(legacyManifest.profile, 'legacy');
assert.equal(legacyManifest.toolCount, 30);
assert.equal(legacyManifest.deprecations.length, 30);
assert.deepEqual(legacyManifest.migration, {});

for (const schema of compactSchemas) {
  assert.equal(ToolSchema.safeParse(schema).success, true, `${schema.name} must satisfy ToolSchema`);
  assert.equal(Object.hasOwn(compactPublic.find(item => item.name === schema.name), 'outputSchema'), false);
}
for (const legacyName of expectedLegacy.filter(name => !expectedCompact.includes(name))) {
  assert.equal(compactPublic.some(item => item.name === legacyName), false, `${legacyName} must be absent from compact discovery`);
}

const schemaByName = new Map(compactSchemas.map(schema => [schema.name, schema]));
assert.deepEqual(schemaByName.get('relai_work').inputSchema.properties.action.enum, ['begin', 'status', 'finish', 'cancel']);
assert.deepEqual(schemaByName.get('relai_search').inputSchema.properties.action.enum, ['text', 'semantic']);
assert.deepEqual(schemaByName.get('relai_process').inputSchema.properties.action.enum, ['start', 'read', 'write', 'stop', 'list']);
assert.deepEqual(schemaByName.get('relai_validate').inputSchema.properties.action.enum, ['checks', 'diagnostics', 'http']);
assert.deepEqual(schemaByName.get('relai_changes').inputSchema.properties.action.enum, ['diff', 'restore', 'reset', 'tidy_plan', 'tidy_run']);
assert.deepEqual(schemaByName.get('relai_publish').inputSchema.properties.action.enum, ['commit', 'push', 'draft_pr']);

await valid('relai_work', { action: 'begin', workspace: 'repo' });
await invalid('relai_work', { action: 'begin' });
await valid('relai_work', { action: 'begin', workspace: 'repo', work_id: 'ignored' });
await valid('relai_work', { action: 'finish', work_id: 'work', summary: 'Done.' });
await invalid('relai_work', { action: 'finish', work_id: 'work' });
await valid('relai_work', { action: 'status', title: 'ignored' });
await valid('relai_process', { action: 'start', work_id: 'work', command: 'npm test' });
await invalid('relai_process', { action: 'start', work_id: 'work' });
await valid('relai_process', { action: 'read', work_id: 'work', processId: 'p', command: 'ignored' });
await valid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxFiles: 200 });
await invalid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxFiles: 201 });
await valid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', maxResults: 100 });
await invalid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', maxResults: 101 });
await valid('relai_validate', { action: 'http', work_id: 'work', route: '/health', timeoutMs: 600000 });
await invalid('relai_validate', { action: 'http', work_id: 'work', route: '/health', timeoutMs: 600001 });
await valid('relai_changes', { action: 'reset', work_id: 'work', confirmation: 'RESET' });
await invalid('relai_changes', { action: 'unknown', work_id: 'work' });

const normalizedRead = resolveToolOperation('relai_process', { action: 'read', work_id: 'work', processId: 'p', command: 'ignored' });
assert.equal(normalizedRead.operationArgs.command, undefined);
const normalizedStatus = resolveToolOperation('relai_work', { action: 'status', title: 'ignored' });
assert.equal(normalizedStatus.operationArgs.title, undefined);
const normalizedBegin = resolveToolOperation('relai_work', { action: 'begin', workspace: 'repo', work_id: 'ignored' });
assert.equal(normalizedBegin.operationArgs.workspace, 'repo');
assert.equal(normalizedBegin.operationArgs.work_id, undefined);
assert.throws(
  () => resolveToolOperation('relai_work', { action: 'begin' }),
  /Missing required field 'workspace'/
);
assert.throws(
  () => resolveToolOperation('relai_work', { action: 'finish', work_id: 'work' }),
  /Missing required field 'summary'/
);
assert.throws(
  () => resolveToolOperation('relai_process', { action: 'read', work_id: 'work', processId: 'p', unknown: true }),
  /Unsupported field 'unknown'/
);
assert.throws(
  () => resolveToolOperation('relai_publish', { action: 'commit', work_id: 'work' }),
  /Missing required field 'message'/
);
assert.equal(resolveToolOperation('relai_validate', { action: 'checks', work_id: 'work' }).operationName, 'relai_run_checks');
assert.equal(resolveToolOperation('relai_inspect', { action: 'impact', work_id: 'work', symbol: 'x' }).operationArgs.action, 'impact');

for (const legacyName of expectedLegacy) {
  assert.ok(LEGACY_TO_COMPACT[legacyName], `migration mapping missing ${legacyName}`);
}
assert.deepEqual(LEGACY_TO_COMPACT.relai_begin_work, { tool: 'relai_work', action: 'begin' });
assert.deepEqual(LEGACY_TO_COMPACT.relai_run_checks, { tool: 'relai_validate', action: 'checks' });
assert.deepEqual(LEGACY_TO_COMPACT.relai_edit, { tool: 'relai_edit' });

const metadata = getToolMetadata(compactConfig);
assert.deepEqual(metadata.map(item => item.name), expectedCompact);
const groups = getToolGroups(compactConfig);
assert.deepEqual(groups.workspace, expectedCompact);
assert.ok(groups.git.includes('relai_publish'));
assert.ok(groups.cleanup.includes('relai_changes'));

assert.throws(
  () => getToolSchemas({ toolProfile: 'compact,legacy', workspaces: {} }),
  /profiles cannot be combined/
);

console.log(`Compact and legacy tool registries passed: ${legacyBytes} -> ${compactBytes} discovery bytes.`);

async function valid(name, value) {
  const result = await fromJsonSchema(schemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.equal(result.issues, undefined, `${name} valid input: ${JSON.stringify(result.issues || [])}`);
}

async function invalid(name, value) {
  const result = await fromJsonSchema(schemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.ok(result.issues?.length, `${name} must reject ${JSON.stringify(value)}`);
}
