import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { getToolDefinitions } from '../src/tools.js';
import { getToolSchemas, getToolMetadata, getToolGroups, getToolSurfaceManifest, TOOL_NAMES } from '../src/tools/schema.js';

const expected = [
  'relai_start_task', 'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_code_inspect', 'relai_exec',
  'relai_process_start', 'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list',
  'relai_worktree_create', 'relai_worktree_list', 'relai_worktree_remove', 'relai_semantic_search',
  'relai_diagnostics_run', 'relai_validation_plan', 'relai_operation_task_get', 'relai_operation_task_cancel',
  'relai_tidy_plan', 'relai_tidy_run', 'relai_run_checks',
  'relai_http_probe', 'relai_ui_check', 'relai_diff', 'relai_restore_paths', 'relai_reset_workspace',
  'relai_status', 'relai_git_commit', 'relai_git_push', 'relai_git_draft_pr', 'relai_edit', 'relai_complete_task'
];
const definitions = getToolDefinitions();
const schemas = getToolSchemas();
const byName = new Map(definitions.map(definition => [definition.name, definition]));
const schemaByName = new Map(schemas.map(schema => [schema.name, schema]));

assert.equal(definitions.length, 33);
assert.deepEqual(TOOL_NAMES, expected);
assert.deepEqual(definitions.map(item => item.name), expected);
assert.deepEqual(getToolMetadata().map(item => item.name), expected);
assert.equal(new Set(expected).size, expected.length);

const manifest = getToolSurfaceManifest();
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.toolSurfaceVersion, 22);
assert.equal(manifest.toolCount, 33);
assert.deepEqual(manifest.tools.map(item => item.name), expected);
assert.equal(manifest.tools.every(item => item.state === 'active'), true);
assert.deepEqual(manifest.deprecations, []);
assert.deepEqual(manifest.compatibilityAliases, {});

for (const definition of definitions) {
  assert.equal(typeof definition.handler, 'function', `${definition.name} handler`);
  assert.equal(typeof definition.handlerName, 'string', `${definition.name} handlerName`);
  assert.equal(definition.inputSchema?.type, 'object', `${definition.name} input schema`);
  assert.equal(definition.outputSchema?.type, 'object', `${definition.name} output schema`);
  assert.equal(schemaByName.get(definition.name)?.outputSchema?.type, 'object', `${definition.name} connector output schema`);
  assert.equal(Object.hasOwn(definition, 'public'), false);
}
for (const schema of schemas.filter(item => item.name !== 'relai_start_task')) {
  assert.ok(schema.inputSchema.properties.task_id, `${schema.name} must expose task_id`);
}
assert.equal(schemaByName.get('relai_start_task').inputSchema.properties.task_id, undefined);
assert.equal(schemaByName.get('relai_start_task').inputSchema.properties.title.maxLength, 100);
assert.equal(schemaByName.get('relai_start_task').inputSchema.properties.objective.maxLength, 500);
assert.deepEqual(schemaByName.get('relai_complete_task').inputSchema.required, ['workspace', 'summary', 'task_id']);

assert.deepEqual(byName.get('relai_code_inspect').inputSchema.properties.action.enum,
  ['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics']);
assert.equal(byName.get('relai_code_inspect').annotations.readOnlyHint, true);
assert.ok(byName.get('relai_semantic_search').inputSchema.properties.query);
assert.equal(byName.get('relai_semantic_search').annotations.readOnlyHint, true);

for (const name of ['relai_process_start', 'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list']) {
  assert.ok(byName.has(name), `${name} missing`);
}
assert.deepEqual(byName.get('relai_process_start').inputSchema.required, ['workspace', 'command']);
assert.deepEqual(byName.get('relai_process_read').inputSchema.required, ['processId']);
assert.equal(byName.get('relai_process_start').annotations.openWorldHint, true);

for (const name of ['relai_worktree_create', 'relai_worktree_list', 'relai_worktree_remove']) assert.ok(byName.has(name));
assert.equal(byName.get('relai_worktree_remove').dashboard.requiresApproval, true);
assert.equal(byName.get('relai_worktree_list').annotations.readOnlyHint, true);

const diagnostics = byName.get('relai_diagnostics_run');
assert.equal(diagnostics.behavior.longRunning, true);
assert.ok(diagnostics.inputSchema.properties.commands);
const plan = byName.get('relai_validation_plan');
assert.equal(plan.annotations.readOnlyHint, true);
const checks = byName.get('relai_run_checks');
assert.equal(checks.behavior.longRunning, true);
for (const field of ['check', 'checks', 'checksText', 'planId', 'planLevel', 'defer', 'complete', 'summary']) {
  assert.ok(checks.inputSchema.properties[field], `run checks ${field}`);
}
assert.deepEqual(checks.inputSchema.properties.planLevel.enum, ['focused', 'quick', 'standard', 'release']);
assert.equal(byName.get('relai_exec').inputSchema.properties.defer.type, 'boolean');
assert.equal(diagnostics.inputSchema.properties.defer.type, 'boolean');
assert.deepEqual(byName.get('relai_operation_task_get').inputSchema.required, ['operationTaskId']);
assert.equal(byName.get('relai_operation_task_get').annotations.readOnlyHint, true);
assert.equal(byName.get('relai_operation_task_cancel').annotations.destructiveHint, true);

const commit = byName.get('relai_git_commit');
assert.equal(commit.inputSchema.properties.allowSecretPaths, undefined);
assert.ok(commit.inputSchema.properties.sensitiveAuthorization);
assert.deepEqual(commit.inputSchema.properties.sensitiveAuthorization.required, ['operation', 'paths', 'reason']);
assert.equal(byName.get('relai_git_push').annotations.openWorldHint, true);
assert.equal(byName.get('relai_git_draft_pr').annotations.openWorldHint, false);

const edit = byName.get('relai_edit');
for (const field of ['oldText', 'newText', 'replacements', 'content', 'updateText', 'edits', 'expectedSha256']) {
  assert.ok(edit.inputSchema.properties[field], `edit ${field}`);
}
assert.deepEqual(edit.inputSchema.properties.stage.enum, ['start', 'append', 'commit', 'abort']);
assert.equal(byName.get('relai_reset_workspace').dashboard.requiresApproval, true);

const groups = getToolGroups();
assert.deepEqual(groups.workspace, expected);
for (const [groupName, names] of Object.entries(groups)) {
  assert.equal(new Set(names).size, names.length, `${groupName} duplicates`);
  for (const name of names) assert.ok(expected.includes(name), `${groupName} unknown ${name}`);
}

const configured = getToolSchemas({ workspaces: { zebra: {}, app: {} } });
const configuredStart = configured.find(item => item.name === 'relai_start_task');
assert.match(configuredStart.inputSchema.properties.workspace.description, /Aliases: app, zebra/);
assert.match(configuredStart.inputSchema.properties.workspace.description, /Relative paths/);

const removed = ['relai_write', 'relai_replace', 'relai_browser', 'relai_restore_changes', 'relai_git_status', 'relai_git_create_pr'];
for (const name of removed) assert.equal(expected.includes(name), false);

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const mcpSection = readme.split('## MCP tools')[1]?.split('\n---')[0] || '';
const documented = [...mcpSection.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
assert.deepEqual(new Set(documented), new Set(expected), 'README tool table must match the 33-tool registry');
assert.equal(documented.length, expected.length);

console.log('Tool registry consistency passed for the 33-tool MCP 2026 surface.');
