import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CallToolResultSchema,
  ToolExecutionSchema,
  ToolSchema
} from '@modelcontextprotocol/core';
import { fromJsonSchema } from '@modelcontextprotocol/server';

import { toolResult } from '../src/mcp/results.js';
import { NATIVE_TASK_WIRE_RESULT_SCHEMA } from '../src/tools/outputSchemas.js';
import { getToolDefinitions } from '../src/tools.js';
import {
  getToolGroups,
  getToolMetadata,
  getPublicToolSchemas,
  getToolSchemas,
  getToolSurfaceManifest,
  TOOL_NAMES
} from '../src/tools/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = [
  'relai_begin_work', 'relai_repo_snapshot', 'relai_read', 'relai_search', 'relai_code_inspect', 'relai_exec',
  'relai_process_start', 'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list',
  'relai_worktree_create', 'relai_worktree_list', 'relai_worktree_remove', 'relai_semantic_search',
  'relai_diagnostics_run', 'relai_tidy_plan', 'relai_tidy_run', 'relai_run_checks',
  'relai_http_probe', 'relai_diff', 'relai_restore_paths', 'relai_reset_workspace',
  'relai_status', 'relai_git_commit', 'relai_git_push', 'relai_git_draft_pr', 'relai_edit', 'relai_cancel_work', 'relai_finish_work'
];
const nativeTaskEligible = new Set([
  'relai_exec',
  'relai_diagnostics_run',
  'relai_run_checks'
]);
const processTools = new Set([
  'relai_process_start',
  'relai_process_read',
  'relai_process_write',
  'relai_process_stop',
  'relai_process_list'
]);
const alwaysImmediate = new Set([
  'relai_begin_work',
  'relai_repo_snapshot',
  'relai_read',
  'relai_search',
  'relai_status',
  'relai_cancel_work',
  'relai_finish_work'
]);

const definitions = getToolDefinitions();
const schemas = getToolSchemas();
const publicSchemas = getPublicToolSchemas();
const metadata = getToolMetadata();
const byName = new Map(definitions.map(definition => [definition.name, definition]));
const schemaByName = new Map(schemas.map(schema => [schema.name, schema]));
const publicSchemaByName = new Map(publicSchemas.map(schema => [schema.name, schema]));
const metadataByName = new Map(metadata.map(item => [item.name, item]));

assert.equal(definitions.length, 30);
assert.deepEqual(TOOL_NAMES, expected);
assert.deepEqual(definitions.map(item => item.name), expected);
assert.deepEqual(metadata.map(item => item.name), expected);
assert.equal(new Set(expected).size, expected.length);
assert.equal(expected.includes('relai_native_tasks_probe'), false);
assert.equal(expected.some(name => /operation_task_(?:get|update|cancel)|native_tasks_probe|task_poll/.test(name)), false);

const manifest = getToolSurfaceManifest();
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.toolSurfaceVersion, 27);
assert.equal(manifest.toolCount, 30);
assert.deepEqual(manifest.tools.map(item => item.name), expected);
assert.equal(manifest.tools.every(item => item.state === 'active'), true);
const manifestByName = new Map(manifest.tools.map(item => [item.name, item]));
assert.equal(manifestByName.get('relai_exec').executionClass, 'native_task_eligible');
assert.equal(manifestByName.get('relai_exec').taskSupport, 'optional');
assert.equal(manifestByName.get('relai_process_start').executionClass, 'persistent_process');
assert.equal(manifestByName.get('relai_process_start').taskSupport, 'forbidden');
assert.deepEqual(manifest.deprecations, []);
assert.deepEqual(manifest.compatibilityAliases, {});

for (const definition of definitions) {
  assert.equal(typeof definition.handler, 'function', `${definition.name} handler`);
  assert.equal(typeof definition.handlerName, 'string', `${definition.name} handlerName`);
  assert.equal(definition.inputSchema?.type, 'object', `${definition.name} input schema`);
  assert.equal(definition.outputSchema?.type, 'object', `${definition.name} output schema`);
  assert.equal(schemaByName.get(definition.name)?.outputSchema?.type, 'object', `${definition.name} connector output schema`);
  assert.equal(Object.hasOwn(publicSchemaByName.get(definition.name), 'outputSchema'), false, `${definition.name} must not publish its internal output validator`);
  assert.equal(Object.hasOwn(definition, 'public'), false);

  const parsedTool = ToolSchema.safeParse(schemaByName.get(definition.name));
  assert.equal(parsedTool.success, true, `${definition.name} must satisfy the installed MCP ToolSchema: ${parsedTool.error?.message || ''}`);
  assert.equal(
    Object.hasOwn(schemaByName.get(definition.name), 'execution'),
    false,
    `${definition.name} must omit the deleted 2026-07-28 execution vocabulary from tools/list`
  );

  if (nativeTaskEligible.has(definition.name)) {
    assert.deepEqual(definition.execution, { taskSupport: 'optional' }, `${definition.name} task support`);
    assert.equal(ToolExecutionSchema.safeParse(definition.execution).success, true);
    assert.equal(metadataByName.get(definition.name).executionClass, 'native_task_eligible');
    assert.equal(metadataByName.get(definition.name).taskSupport, 'optional');
  } else {
    assert.equal(Object.hasOwn(definition, 'execution'), false, `${definition.name} must not claim native Tasks support`);
    assert.equal(metadataByName.get(definition.name).taskSupport, 'forbidden');
  }

  if (processTools.has(definition.name)) {
    assert.equal(definition.behavior.executionClass, 'persistent_process', `${definition.name} process classification`);
  } else if (alwaysImmediate.has(definition.name)) {
    assert.equal(definition.behavior.executionClass, 'always_immediate', `${definition.name} immediate classification`);
  } else if (nativeTaskEligible.has(definition.name)) {
    assert.equal(definition.behavior.executionClass, 'native_task_eligible', `${definition.name} task classification`);
  } else {
    assert.equal(definition.behavior.executionClass, 'bounded_synchronous', `${definition.name} synchronous classification`);
  }
}

assert.ok(
  Buffer.byteLength(JSON.stringify({ tools: publicSchemas })) < 80_000,
  'public tools/list payload must remain below the 80 KiB discovery budget'
);

for (const schema of schemas.filter(item => !['relai_begin_work', 'relai_status'].includes(item.name))) {
  assert.ok(schema.inputSchema.properties.work_id, `${schema.name} must expose work_id`);
  assert.ok(schema.inputSchema.required.includes('work_id'), `${schema.name} must require work_id`);
  assert.equal(schema.inputSchema.required.includes('workspace'), false, `${schema.name} must resolve workspace from work_id`);
}
assert.equal(schemaByName.get('relai_begin_work').inputSchema.properties.work_id, undefined);
assert.ok(schemaByName.get('relai_status').inputSchema.properties.work_id);
assert.equal(schemaByName.get('relai_status').inputSchema.required.includes('work_id'), false);
assert.equal(schemaByName.get('relai_begin_work').inputSchema.properties.title.maxLength, 100);
assert.equal(schemaByName.get('relai_begin_work').inputSchema.properties.objective.maxLength, 500);
assert.deepEqual(schemaByName.get('relai_begin_work').inputSchema.properties.bootstrap.enum, ['compact', 'full', 'none']);
assert.deepEqual(schemaByName.get('relai_finish_work').inputSchema.required, ['summary', 'work_id']);
assert.deepEqual(schemaByName.get('relai_cancel_work').inputSchema.required, ['work_id']);

assert.deepEqual(byName.get('relai_code_inspect').inputSchema.properties.action.enum,
  ['symbol', 'references', 'related', 'impact', 'trace', 'diagnostics']);
assert.equal(byName.get('relai_code_inspect').annotations.readOnlyHint, true);
assert.equal(byName.get('relai_semantic_search').annotations.readOnlyHint, true);
assert.equal(byName.get('relai_tidy_plan').annotations.readOnlyHint, true);

assert.equal(byName.get('relai_cancel_work').annotations.destructiveHint, false);
assert.equal(byName.get('relai_cancel_work').annotations.idempotentHint, true);
assert.equal(byName.get('relai_process_stop').annotations.idempotentHint, true);
assert.equal(byName.get('relai_git_commit').annotations.destructiveHint, false);
assert.equal(byName.get('relai_git_push').annotations.destructiveHint, false);
assert.equal(byName.get('relai_git_push').annotations.openWorldHint, true);
assert.equal(byName.get('relai_git_draft_pr').annotations.openWorldHint, false);
for (const name of ['relai_diagnostics_run', 'relai_run_checks']) {
  assert.equal(byName.get(name).annotations.readOnlyHint, false, `${name} can execute repository scripts`);
  assert.equal(byName.get(name).annotations.destructiveHint, true, `${name} scripts may mutate or delete repository state`);
  assert.equal(byName.get(name).annotations.openWorldHint, true, `${name} script effects are open-world`);
}
assert.equal(byName.get('relai_process_stop').annotations.openWorldHint, false);

assert.deepEqual(schemaByName.get('relai_process_start').inputSchema.required, ['command', 'work_id']);
assert.deepEqual(byName.get('relai_process_read').inputSchema.required, ['processId']);
assert.equal(byName.get('relai_process_start').annotations.openWorldHint, true);
for (const name of processTools) {
  assert.equal(Object.hasOwn(byName.get(name), 'execution'), false, `${name} must remain process-oriented`);
}

const diagnostics = byName.get('relai_diagnostics_run');
assert.equal(diagnostics.behavior.longRunning, true);
assert.ok(diagnostics.inputSchema.properties.commands);
const checks = byName.get('relai_run_checks');
assert.equal(checks.behavior.longRunning, true);
for (const field of ['check', 'checks', 'checksText', 'complete', 'summary']) {
  assert.ok(checks.inputSchema.properties[field], `run checks ${field}`);
}
assert.equal(checks.inputSchema.properties.planId, undefined);
assert.equal(checks.inputSchema.properties.planLevel, undefined);
assert.equal(byName.get('relai_exec').inputSchema.properties.defer, undefined);
assert.equal(diagnostics.inputSchema.properties.defer, undefined);

const commit = byName.get('relai_git_commit');
assert.equal(commit.inputSchema.properties.allowSecretPaths, undefined);
assert.ok(commit.inputSchema.properties.sensitiveAuthorization);
assert.deepEqual(commit.inputSchema.properties.sensitiveAuthorization.required, ['operation', 'paths', 'reason']);
for (const name of ['relai_worktree_create', 'relai_worktree_remove', 'relai_tidy_run', 'relai_restore_paths', 'relai_reset_workspace', 'relai_git_commit', 'relai_git_push']) {
  assert.equal(byName.get(name).behavior.concurrencyScope, 'workspace', `${name} must remain repository-global`);
}
for (const name of ['relai_read', 'relai_search', 'relai_exec', 'relai_run_checks', 'relai_edit']) {
  assert.equal(byName.get(name).behavior.concurrencyScope, 'task', `${name} must permit independent task lanes`);
}

const directSamples = {
  relai_exec: { ok: true, workspace: 'repo', work_id: 'logical-task', exitCode: 0, durationMs: 12 },
  relai_diagnostics_run: { ok: true, workspace: 'repo', work_id: 'logical-task', diagnostics: [], diagnosticCount: 0 },
  relai_run_checks: { ok: true, workspace: 'repo', work_id: 'logical-task', results: [], validationStatus: 'passed' },
  relai_process_start: { ok: true, work_id: 'logical-task', processId: 'proc_123', status: 'running', lifecycle: 'persistent' },
  relai_process_read: { ok: true, work_id: 'logical-task', processId: 'proc_123', status: 'running', stdout: {}, stderr: {} },
  relai_process_write: { ok: true, work_id: 'logical-task', processId: 'proc_123', acceptedBytes: 4, status: 'running' },
  relai_process_stop: { ok: true, work_id: 'logical-task', processId: 'proc_123', status: 'stopped', duplicate: false },
  relai_process_list: { ok: true, work_id: 'logical-task', processes: [], count: 0 },
  relai_cancel_work: { ok: true, work_id: 'logical-task', status: 'cancelled', duplicate: false },
  relai_finish_work: { ok: true, work_id: 'logical-task', completionKnown: true, validationStatus: 'passed' }
};
for (const [name, sample] of Object.entries(directSamples)) {
  await assertValidOutput(name, sample);
}
await assertInvalidOutput('relai_process_start', {
  ok: true,
  work_id: 'logical-task',
  status: 'running',
  lifecycle: 'persistent'
});
await assertInvalidOutput('relai_exec', { ok: true, workspace: 'repo', work_id: 'logical-task' });

const nativeTaskResult = {
  resultType: 'task',
  taskId: 'task_abcdefghijklmnopqrstuvwxyz1234567890',
  status: 'working',
  ttlMs: 60_000,
  createdAt: new Date().toISOString(),
  lastUpdatedAt: new Date().toISOString(),
  pollIntervalMs: 1000,
  statusMessage: 'Validation is running.'
};
const nativeTaskValidator = fromJsonSchema(NATIVE_TASK_WIRE_RESULT_SCHEMA)['~standard'];
assert.equal((await nativeTaskValidator.validate(nativeTaskResult)).issues, undefined, 'flat native task result schema');
assert.equal((await nativeTaskValidator.validate({ resultType: 'complete' })).issues, undefined, 'task control acknowledgement schema');

const largePayload = {
  ok: true,
  workspace: 'repo',
  work_id: 'logical-task',
  stdout: 'x'.repeat(200_000),
  stderr: 'y'.repeat(200_000),
  message: 'Large bounded command result.'
};
const wrapped = toolResult(largePayload, false);
assert.equal(CallToolResultSchema.safeParse(wrapped).success, true, 'direct CallToolResult schema');
assert.equal(wrapped.structuredContent, largePayload);
assert.ok(Buffer.byteLength(wrapped.content[0].text, 'utf8') <= 8 * 1024);
assert.notEqual(wrapped.content[0].text, JSON.stringify(largePayload, null, 2));
assert.match(wrapped.content[0].text, /Rel\.AI operation succeeded/);
const oversized = toolResult({ ...largePayload, stdout: 'x'.repeat(600_000) }, false);
assert.equal(oversized.structuredContent.truncated, true);
assert.ok(Buffer.byteLength(oversized.content[0].text, 'utf8') <= 8 * 1024);

const groups = getToolGroups();
assert.deepEqual(groups.workspace, expected);
for (const [groupName, names] of Object.entries(groups)) {
  assert.equal(new Set(names).size, names.length, `${groupName} duplicates`);
  for (const name of names) assert.ok(expected.includes(name), `${groupName} unknown ${name}`);
}

const configured = getToolSchemas({ workspaces: { zebra: {}, app: {} } });
const configuredStart = configured.find(item => item.name === 'relai_begin_work');
assert.match(configuredStart.inputSchema.properties.workspace.description, /Aliases: app, zebra/);
assert.match(configuredStart.inputSchema.properties.workspace.description, /Relative paths/);

const removed = [
  'relai_write', 'relai_replace', 'relai_browser', 'relai_restore_changes', 'relai_git_status',
  'relai_git_create_pr', 'relai_native_tasks_probe', 'relai_operation_task_get', 'relai_operation_task_cancel'
];
for (const name of removed) assert.equal(expected.includes(name), false);

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const mcpSection = readme.split('## MCP tools')[1]?.split('\n---')[0] || '';
const documented = [...mcpSection.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]);
assert.deepEqual(new Set(documented), new Set(expected), 'README tool table must match the 30-tool registry');
assert.equal(documented.length, expected.length);

console.log('Tool registry, native Tasks eligibility, annotations, process semantics, schemas, and bounded result envelopes passed for 30 public tools.');

async function assertValidOutput(name, value) {
  const standard = fromJsonSchema(schemaByName.get(name).outputSchema)['~standard'];
  const result = await standard.validate(value);
  assert.equal(result.issues, undefined, `${name} valid output: ${JSON.stringify(result.issues || [])}`);
}

async function assertInvalidOutput(name, value) {
  const standard = fromJsonSchema(schemaByName.get(name).outputSchema)['~standard'];
  const result = await standard.validate(value);
  assert.ok(Array.isArray(result.issues) && result.issues.length > 0, `${name} must reject incomplete output`);
}
