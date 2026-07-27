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
  getToolSurfaceManifest,
  TOOL_NAMES
} = require('../src/tools/schema.js');
const { MAX_BATCH_EDITS } = require('../src/editLimits.js');

const definitions = getToolDefinitions();
const names = definitions.map(definition => definition.name);
const expected = [
  'relai_start_task',
  'relai_repo_snapshot',
  'relai_read',
  'relai_search',
  'relai_code_inspect',
  'relai_exec',
  'relai_tidy_plan',
  'relai_tidy_run',
  'relai_run_checks',
  'relai_http_probe',
  'relai_ui_check',
  'relai_diff',
  'relai_restore_paths',
  'relai_reset_workspace',
  'relai_status',
  'relai_git_commit',
  'relai_git_push',
  'relai_git_draft_pr',
  'relai_edit',
  'relai_complete_task'
];

assert.equal(definitions.length, 20);
assert.deepEqual(names, expected);
assert.deepEqual(TOOL_NAMES, expected);
assert.equal(new Set(names).size, names.length, 'tool names must be unique');
assert.deepEqual(getToolSchemas().map(schema => schema.name), expected);
const configuredSchemas = getToolSchemas({ workspaces: { zebra: {}, app: {} } });
assert.equal(configuredSchemas.find(tool => tool.name === 'relai_start_task').inputSchema.properties.workspace.enum, undefined);
assert.match(configuredSchemas.find(tool => tool.name === 'relai_start_task').inputSchema.properties.workspace.description, /exact absolute path/);
assert.match(configuredSchemas.find(tool => tool.name === 'relai_start_task').inputSchema.properties.workspace.description, /Relative paths such as '\.'/);
assert.deepEqual(getToolMetadata().map(tool => tool.name), expected);
const toolSurface = getToolSurfaceManifest();
assert.equal(toolSurface.schemaVersion, 1);
assert.equal(toolSurface.toolSurfaceVersion, 12);
assert.equal(toolSurface.toolCount, expected.length);
assert.deepEqual(toolSurface.tools.map(tool => tool.name), expected);
assert.equal(toolSurface.tools.filter(tool => tool.state === 'active').length, 20);
assert.equal(toolSurface.deprecations.length, 0);
const removedTools = ['relai_write', 'relai_replace', 'relai_browser', 'relai_restore_changes', 'relai_git_status', 'relai_git_create_pr'];
for (const name of removedTools) assert.equal(names.includes(name), false, `${name} must be removed from the callable surface`);
assert.deepEqual(toolSurface.compatibilityAliases, {});

for (const definition of definitions) {
  assert.equal(typeof definition.handler, 'function', `${definition.name} must bind directly to an executable handler`);
  assert.equal(definition.inputSchema?.type, 'object', `${definition.name} must define an object schema`);
  for (const stripped of definition.connectorStrip || []) {
    assert.ok(Object.hasOwn(definition.inputSchema.properties || {}, stripped), `${definition.name} strips unknown connector property ${stripped}`);
  }
  assert.equal(Object.hasOwn(definition, 'public'), false, `${definition.name} must not retain public/internal flags`);
  assert.equal(Object.hasOwn(definition, 'publicOrder'), false, `${definition.name} must not retain public ordering`);
}

const startTaskTool = definitions.find(definition => definition.name === 'relai_start_task');
assert.ok(startTaskTool, 'logical task identity tool must be registered');
assert.deepEqual(startTaskTool.inputSchema.required, ['workspace']);
assert.equal(startTaskTool.annotations.destructiveHint, false);
assert.match(startTaskTool.description, /opaque task_id/);
assert.equal(Object.hasOwn(getToolSchemas().find(tool => tool.name === 'relai_start_task').inputSchema.properties, 'task_id'), false);

const readTool = definitions.find(definition => definition.name === 'relai_read');
assert.ok(readTool, 'read tool must be registered');
assert.ok(readTool.inputSchema.properties.startLine, 'read schema must expose startLine');
assert.ok(readTool.inputSchema.properties.endLine, 'read schema must expose endLine');
assert.ok(readTool.inputSchema.properties.guidanceMode, 'read schema must expose guidanceMode');
assert.match(readTool.description, /bounded line range/);

const searchTool = definitions.find(definition => definition.name === 'relai_search');
assert.ok(searchTool, 'search tool must be registered');
assert.deepEqual(searchTool.inputSchema.properties.mode.enum, ['auto', 'compact', 'context']);
for (const field of ['contextBefore', 'contextAfter', 'groupByFile', 'mergeOverlaps', 'maxFiles', 'maxRangesPerFile', 'maxRangeLines', 'maxBytes']) {
  assert.ok(searchTool.inputSchema.properties[field], `search schema must expose ${field}`);
}
assert.match(searchTool.description, /Auto mode is the default/);

const codeInspectTool = definitions.find(definition => definition.name === 'relai_code_inspect');
assert.ok(codeInspectTool, 'code-intelligence tool must be registered');
assert.deepEqual(codeInspectTool.inputSchema.required, ['workspace', 'action']);
assert.deepEqual(codeInspectTool.inputSchema.properties.action.enum, ['symbol', 'references', 'related', 'impact', 'diagnostics']);
assert.ok(codeInspectTool.inputSchema.properties.symbol);
assert.ok(codeInspectTool.inputSchema.properties.paths);
assert.ok(codeInspectTool.inputSchema.properties.maxDepth);
assert.equal(codeInspectTool.annotations.readOnlyHint, true);
assert.equal(codeInspectTool.annotations.openWorldHint, false);
assert.match(codeInspectTool.description, /fingerprint-invalidated live code index/);
assert.match(codeInspectTool.description, /not an embedding service or compiler language server/);

const runChecksTool = definitions.find(definition => definition.name === 'relai_run_checks');
assert.ok(runChecksTool, 'run-checks tool must be registered');
assert.deepEqual(runChecksTool.inputSchema.properties.level.enum, ['quick', 'standard', 'release']);
assert.equal(runChecksTool.connectorStrip.length, 0, 'connector must expose explicit validation inputs');
for (const field of ['check', 'checks', 'checksText', 'complete', 'summary']) {
  assert.ok(runChecksTool.inputSchema.properties[field], `run-checks schema must expose ${field}`);
  assert.ok(getToolSchemas().find(tool => tool.name === 'relai_run_checks').inputSchema.properties[field], `connector run-checks schema must retain ${field}`);
}
assert.equal(runChecksTool.inputSchema.properties.summary.maxLength, 2000);
assert.match(runChecksTool.description, /complete:true with summary/);
assert.match(runChecksTool.description, /relai_complete_task after any final read-only review/);

const httpProbeTool = definitions.find(definition => definition.name === 'relai_http_probe');
assert.ok(httpProbeTool, 'HTTP probe tool must be registered');
assert.deepEqual(httpProbeTool.inputSchema.required, ['workspace', 'route']);
assert.equal(Object.hasOwn(httpProbeTool.inputSchema.properties, 'url'), false);
assert.equal(httpProbeTool.annotations.readOnlyHint, true);
const uiCheckTool = definitions.find(definition => definition.name === 'relai_ui_check');
assert.ok(uiCheckTool, 'UI check tool must be registered');
assert.deepEqual(uiCheckTool.inputSchema.required, ['workspace', 'check']);
assert.equal(Object.hasOwn(uiCheckTool.inputSchema.properties, 'command'), false);
const restorePathsTool = definitions.find(definition => definition.name === 'relai_restore_paths');
assert.ok(restorePathsTool, 'scoped restore tool must be registered');
assert.deepEqual(restorePathsTool.inputSchema.required, ['workspace', 'paths']);
assert.equal(restorePathsTool.inputSchema.properties.paths.minItems, 1);
assert.equal(Object.hasOwn(restorePathsTool.inputSchema.properties, 'clean'), false);
const resetWorkspaceTool = definitions.find(definition => definition.name === 'relai_reset_workspace');
assert.ok(resetWorkspaceTool, 'workspace reset tool must be registered');
assert.deepEqual(resetWorkspaceTool.inputSchema.required, ['workspace', 'confirmation']);
assert.deepEqual(resetWorkspaceTool.inputSchema.properties.confirmation.enum, ['RESET', 'RESET_AND_CLEAN']);
assert.equal(resetWorkspaceTool.annotations.destructiveHint, true);
const diffTool = definitions.find(definition => definition.name === 'relai_diff');
assert.ok(diffTool.inputSchema.properties.redactSensitive, 'diff schema must expose redacted sensitive review');
assert.match(diffTool.description, /metadata-only summaries/);

const statusTool = definitions.find(definition => definition.name === 'relai_status');
assert.ok(statusTool.inputSchema.properties.maxBytes, 'status schema must retain repository output bounds');
assert.match(statusTool.description, /workspace\.repository/);
const draftPrTool = definitions.find(definition => definition.name === 'relai_git_draft_pr');
assert.ok(draftPrTool, 'local PR draft tool must be registered');
assert.equal(draftPrTool.annotations.readOnlyHint, true);
assert.equal(draftPrTool.annotations.openWorldHint, false);
assert.match(draftPrTool.description, /does not call a hosting provider/);
const editTool = definitions.find(definition => definition.name === 'relai_edit');
assert.ok(editTool, 'edit tool must be registered');
assert.deepEqual(editTool.inputSchema.properties.level.enum, ['quick', 'standard', 'release']);
assert.ok(editTool.inputSchema.properties.occurrence, 'edit schema must expose occurrence targeting');
assert.ok(editTool.inputSchema.properties.replacements, 'edit schema must expose replacement arrays');
assert.ok(editTool.inputSchema.properties.edits.items.properties.occurrence, 'batch edit items must expose occurrence targeting');
assert.ok(editTool.inputSchema.properties.edits.items.properties.replacements, 'batch edit items must expose replacement arrays');
assert.equal(MAX_BATCH_EDITS, 100, 'structured batch limit must support 100 edits');
assert.equal(editTool.inputSchema.properties.edits.maxItems, MAX_BATCH_EDITS, 'schema batch limit must match runtime limit');
assert.match(editTool.description, /up to 100 files/);
assert.deepEqual(editTool.inputSchema.properties.stage.enum, ['start', 'append', 'commit', 'abort']);
assert.match(editTool.description, /Large content stages automatically/);

const completionTool = definitions.find(definition => definition.name === 'relai_complete_task');
assert.ok(completionTool, 'completion tool must be registered');
assert.deepEqual(completionTool.inputSchema.required, ['workspace', 'summary']);
assert.deepEqual(getToolSchemas().find(tool => tool.name === 'relai_complete_task').inputSchema.required, ['workspace', 'summary', 'task_id']);
assert.ok(getToolSchemas().find(tool => tool.name === 'relai_complete_task').inputSchema.properties.task_id);
assert.equal(completionTool.inputSchema.properties.summary.minLength, 1);
assert.equal(completionTool.inputSchema.properties.summary.maxLength, 2000);
assert.match(completionTool.description, /final read-only review/);
assert.match(completionTool.description, /exact logical task/);

const execTool = definitions.find(definition => definition.name === 'relai_exec');
assert.ok(execTool, 'exec tool must be registered');
assert.deepEqual(execTool.inputSchema.required, ['workspace', 'command']);
assert.ok(execTool.inputSchema.properties.cwd);
assert.ok(execTool.inputSchema.properties.env);
assert.ok(execTool.inputSchema.properties.maxOutputBytes);
assert.equal(execTool.connectorStrip.length, 0, 'connector must retain the command field');
assert.deepEqual(execTool.annotations, {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true
});

assert.ok(editTool.inputSchema.properties.expectedSha256, 'edit schema must expose stale-overwrite protection');
assert.ok(editTool.inputSchema.properties.edits.items.properties.expectedSha256, 'batch edit items must expose stale-overwrite protection');
const commitTool = definitions.find(definition => definition.name === 'relai_git_commit');
assert.ok(commitTool.inputSchema.properties.allowSecretPaths, 'commit schema must retain the migration override');
assert.ok(commitTool.inputSchema.properties.sensitiveAuthorization, 'commit schema must expose scoped sensitive authorization');
assert.deepEqual(commitTool.inputSchema.properties.sensitiveAuthorization.required, ['operation', 'paths', 'reason']);
for (const schema of getToolSchemas().filter(tool => tool.name !== 'relai_start_task')) {
  assert.ok(schema.inputSchema.properties.task_id, `${schema.name} must expose task_id`);
}

assert.deepEqual(definitions.find(definition => definition.name === 'relai_read').annotations, {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
});
assert.deepEqual(definitions.find(definition => definition.name === 'relai_edit').annotations, {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
});
assert.equal(definitions.find(definition => definition.name === 'relai_git_push').annotations.openWorldHint, true);
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
assert.deepEqual(new Set(documented), new Set(expected), 'README tool table must match the 20-tool registry');
assert.equal(documented.length, expected.length, 'README tool table must not contain duplicate rows');

console.log('Tool registry consistency passed for one 20-tool surface with no compatibility tools.');
