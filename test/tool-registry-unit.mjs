import assert from 'node:assert/strict';
import { ToolSchema } from '@modelcontextprotocol/core';
import { fromJsonSchema } from '@modelcontextprotocol/server';

import { connectorInstructions } from '../src/mcpServer.js';
import { getToolDefinitions } from '../src/tools.js';
import { getOperationDefinitions, resolveToolOperation } from '../src/tools/actionCatalog.js';
import { OPERATION_IDS as OP, OPERATION_ID_VALUES } from '../src/tools/operationIds.js';
import { validateExecutableOperationInput } from '../src/tools/runtimeRegistry.js';
import {
  TOOL_NAMES, getPublicToolSchemas,
  getToolDefinitions as getDefinitionMetadata, getToolGroups, getToolMetadata,
  getToolSchemas, getToolSurfaceManifest
} from '../src/tools/schema.js';

const config = { workspaces: {} };
const requiredTools = [
  'relai_work', 'relai_snapshot', 'relai_read', 'relai_search', 'relai_inspect', 'relai_edit',
  'relai_exec', 'relai_process', 'relai_ui', 'relai_validate', 'relai_changes', 'relai_publish'
];
const removedDirectNames = [
  'relai_begin_work', 'relai_repo_snapshot', 'relai_code_inspect', 'relai_process_start',
  'relai_process_read', 'relai_process_write', 'relai_process_stop', 'relai_process_list',
  'relai_worktree_create', 'relai_worktree_list', 'relai_worktree_remove', 'relai_semantic_search', 'relai_run_checks', 'relai_http_probe',
  'relai_diff', 'relai_status', 'relai_finish_work'
];

assert.ok(TOOL_NAMES.length > 0, 'the public tool registry must not be empty');
assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length, 'public tool names must remain unique');
for (const required of requiredTools) assert.ok(TOOL_NAMES.includes(required), `${required} must remain available`);
assert.deepEqual(getDefinitionMetadata(config).map(item => item.name), [...TOOL_NAMES]);
assert.equal(getToolDefinitions(config).length, TOOL_NAMES.length);

const schemas = getToolSchemas(config);
const publicSchemas = getPublicToolSchemas(config);
const schemaBytes = bytes(publicSchemas);
assert.ok(schemaBytes > 0, 'unified discovery schema must serialize to a non-empty payload');
assert.deepEqual(
  getPublicToolSchemas({ toolProfile: 'core', workspaces: {} }),
  publicSchemas,
  'stale profile configuration must not change discovery'
);
assert.ok(Buffer.byteLength(JSON.stringify(connectorInstructions(config)), 'utf8') > 0, 'connector instructions must serialize to a non-empty payload');
assert.match(connectorInstructions(config), /task-ownership/i, 'global instructions retain task ownership as a universal invariant');
assert.match(connectorInstructions(config), /approval/i, 'global instructions retain approval safety as a universal invariant');
assert.match(connectorInstructions(config), /authoritative evidence/i, 'global instructions retain truthful evidence semantics');
assert.match(connectorInstructions(config), /explicit task-completion contract/i, 'global instructions retain explicit completion semantics');
assert.doesNotMatch(connectorInstructions(config), /Inspect relevant files|Validate after changes|recovery guidance/i, 'discretionary workflow tactics belong to the workflow runtime/skills, not global MCP instructions');

const manifest = getToolSurfaceManifest(config);
assert.ok(Number.isSafeInteger(manifest.schemaVersion) && manifest.schemaVersion > 0, 'manifest schema revision must remain a positive integer');
assert.ok(Number.isSafeInteger(manifest.toolSurfaceVersion) && manifest.toolSurfaceVersion > 0, 'tool-surface revision must remain a positive integer');
assert.equal(Object.hasOwn(manifest, 'profile'), false);
assert.equal(manifest.toolCount, TOOL_NAMES.length);
assert.deepEqual(manifest.tools.map(item => item.name), [...TOOL_NAMES]);
assert.deepEqual(manifest.deprecations, []);
assert.equal(Object.hasOwn(manifest, 'compatibilityAliases'), false, 'hard cutover must not advertise compatibility aliases');
assert.equal(Object.hasOwn(manifest, 'migration'), false);
assert.ok(manifest.tools.flatMap(item => item.actions || []).every(action => !Object.hasOwn(action, 'operation')), 'public manifest actions must not leak internal operation IDs');
assert.deepEqual(getOperationDefinitions().map(item => item.name).sort(), [...OPERATION_ID_VALUES].sort(), 'internal operation registry must use only canonical hard-cut IDs');
assert.ok(getOperationDefinitions().every(item => !item.name.startsWith('relai_')), 'internal operation IDs must not masquerade as public MCP tool names');

for (const schema of schemas) {
  assert.equal(ToolSchema.safeParse(schema).success, true, `${schema.name} must satisfy ToolSchema`);
  const publicSchema = publicSchemas.find(item => item.name === schema.name);
  assert.ok(publicSchema?.outputSchema, `${schema.name} must advertise outputSchema`);
  assert.equal(publicSchema.outputSchema.type, 'object');
  assert.equal(publicSchema.outputSchema.additionalProperties, false);
  assert.deepEqual(publicSchema.outputSchema.required, ['ok']);
}
const importUnsafeRootKeywords = ['oneOf', 'anyOf', 'allOf', 'if', 'then', 'else', 'not', 'propertyNames'];
for (const schema of publicSchemas) {
  for (const keyword of importUnsafeRootKeywords) {
    assert.equal(schema.inputSchema[keyword], undefined, `${schema.name} discovery must not use root ${keyword}`);
  }
  assert.equal(schema.inputSchema.additionalProperties, false, `${schema.name} discovery must reject unknown fields`);
  assert.match(schema.description || '', /\bUse\b/i, `${schema.name} must state when to use the tool`);
  assert.match(schema.description || '', /\bDo not\b/i, `${schema.name} must state when not to use the tool`);
}
const publicWorkSchema = publicSchemas.find(item => item.name === 'relai_work')?.inputSchema;
for (const field of ['workspace', 'title', 'objective', 'bootstrap', 'instructionPath', 'summary', 'reason', 'work_id']) {
  assert.ok(publicWorkSchema?.properties?.[field], `relai_work connector schema must expose ${field}`);
}
assert.equal(publicWorkSchema?.allOf, undefined, 'relai_work discovery stays import-safe; action-specific validation belongs to the canonical runtime contract');
const publicSearchInputSchema = publicSchemas.find(item => item.name === 'relai_search')?.inputSchema;
for (const field of ['queries', 'maxResults', 'maxFiles']) {
  assert.equal(publicSearchInputSchema?.properties?.[field]?.anyOf, undefined, `relai_search root ${field} schema must collapse bounded action variants instead of advertising a redundant union`);
}
assert.match(publicSearchInputSchema?.properties?.pattern?.description || '', /Action usage: text\./, 'flat discovery must identify text-only fields');
assert.match(publicSearchInputSchema?.properties?.query?.description || '', /Action usage: semantic\./, 'flat discovery must identify semantic-only fields');
assert.match(publicSearchInputSchema?.properties?.action?.description || '', /text: pattern or queries.*semantic: queries or query|text: pattern or queries.*semantic: query or queries/, 'flat discovery must preserve canonical alternative input forms');
assert.match(publicSearchInputSchema?.properties?.maxFiles?.description || '', /text \[1-200\].*semantic \[1-20000\]/, 'flat discovery must preserve action-specific numeric bounds');
assert.match(publicWorkSchema?.properties?.maxBytes?.description || '', /Action usage: status\./, 'flat discovery must identify action-specific optional fields');
const publicValidateInputSchema = publicSchemas.find(item => item.name === 'relai_validate')?.inputSchema;
assert.equal(publicValidateInputSchema?.properties?.timeoutMs?.anyOf, undefined, 'relai_validate root timeoutMs schema must collapse bounded action variants instead of advertising a redundant union');
const publicSearchSchema = publicSchemas.find(item => item.name === 'relai_search')?.outputSchema;
assert.equal(publicSearchSchema?.properties?.neuralEmbeddings?.type, 'boolean', 'semantic search output metadata must remain declared');
assert.equal(publicSearchSchema?.properties?.originalBytes?.type, 'number', 'compacted tool results must remain valid against the public output schema');
const publicExecSchema = publicSchemas.find(item => item.name === 'relai_exec');
for (const field of ['command', 'executable', 'argv', 'input', 'cwd', 'env', 'timeoutMs', 'maxOutputBytes', 'work_id']) {
  assert.ok(publicExecSchema?.inputSchema?.properties?.[field], `relai_exec connector schema must expose ${field}`);
}
const publicEditSchema = publicSchemas.find(item => item.name === 'relai_edit');
assert.match(publicEditSchema?.inputSchema?.properties?.content?.description || '', /Complete replacement content/i, 'public edit discovery must retain complete-file guidance');
assert.match(publicEditSchema?.inputSchema?.properties?.stage?.description || '', /only when the client transport cannot carry/i, 'public edit discovery must explain staged mode as a transport fallback');
const publicProcessSchema = publicSchemas.find(item => item.name === 'relai_process');
assert.match(publicProcessSchema?.inputSchema?.properties?.command?.description || '', /shell syntax.*Action usage: start/i, 'public process discovery must retain shell guidance and action ownership');
assert.match(publicProcessSchema?.inputSchema?.properties?.processId?.description || '', /Action usage: read \(required\); write \(required\); stop \(required\)/, 'public process discovery must identify process-id actions');
assert.match(publicExecSchema?.description || '', /Prefer executable \+ argv/i, 'ChatGPT discovery must prefer shell-free direct execution before trying a shell command');
assert.match(publicExecSchema?.inputSchema?.description || '', /Prefer direct executable \+ argv mode by default/i);
assert.match(publicExecSchema?.inputSchema?.description || '', /Input form: command or executable\./i, 'flat discovery must preserve canonical executable-mode alternatives');
assert.match(publicExecSchema?.inputSchema?.properties?.command?.description || '', /Do not embed JavaScript, Python, JSON, patches/i);
assert.match(publicExecSchema?.inputSchema?.properties?.executable?.description || '', /shell:false/i);
assert.match(publicExecSchema?.inputSchema?.properties?.argv?.description || '', /without shell parsing/i);
assert.match(publicExecSchema?.inputSchema?.properties?.input?.description || '', /multiline scripts or structured text/i);
assert.equal(publicExecSchema?.inputSchema?.allOf, undefined, 'relai_exec discovery stays import-safe; execution-mode exclusivity is enforced at runtime');
for (const removed of removedDirectNames) {
  assert.equal(resolveToolOperation(removed, {}), null, `${removed} must not resolve as a public tool`);
  assert.equal(publicSchemas.some(tool => tool.name === removed), false, `${removed} must not be discovered`);
}

const schemaByName = new Map(schemas.map(schema => [schema.name, schema]));
const publicSchemaByName = new Map(publicSchemas.map(schema => [schema.name, schema]));
assert.deepEqual(schemaByName.get('relai_work').inputSchema.properties.action.enum, ['begin', 'status', 'finish', 'cancel']);
const processSchema = schemaByName.get('relai_process');
assert.deepEqual(processSchema.inputSchema.properties.action.enum, ['start', 'read', 'write', 'stop', 'list']);
assert.ok(processSchema.inputSchema.properties.kind.enum.includes('service'));
assert.match(processSchema.description, /prefer executable \+ argv/i);
assert.match(processSchema.inputSchema.properties.executable.description, /shell:false/i);
assert.match(processSchema.inputSchema.properties.argv.description, /without shell parsing/i);
assert.match(processSchema.inputSchema.properties.input.description, /without closing the persistent stdin stream/i);
const editSchema = schemaByName.get('relai_edit');
assert.equal(editSchema.inputSchema.oneOf?.length, 7, 'relai_edit executable schema must retain all canonical edit-form variants');
assert.match(editSchema.description, /oldText\/newText/i);
assert.match(editSchema.description, /content for complete-file replacement/i);
assert.match(editSchema.description, /automatically handles large complete-file writes/i);
assert.match(editSchema.description, /explicit staged mode only when a client transport cannot carry/i);
assert.match(editSchema.inputSchema.properties.content.description, /staged internally when needed/i);
assert.match(editSchema.inputSchema.properties.updateText.description, /one logical patch together/i);
assert.match(editSchema.inputSchema.properties.stage.description, /only when the client transport cannot carry/i);

await valid('relai_work', { action: 'begin', workspace: 'repo' });
await invalid('relai_work', { action: 'begin' });
await valid('relai_work', { action: 'finish', work_id: 'work', summary: 'Done.' });
await invalid('relai_work', { action: 'finish', work_id: 'work' });
await valid('relai_process', { action: 'start', work_id: 'work', command: 'npm run dev', kind: 'service', purpose: 'Run the development server.', reuseExisting: true });
await valid('relai_process', { action: 'start', work_id: 'work', executable: 'node', argv: ['server.js', '--port', '3000'], input: 'ready\n', kind: 'service', purpose: 'Run the development server directly.' });
await invalid('relai_process', { action: 'start', work_id: 'work', command: 'npm run dev', executable: 'node', kind: 'service', purpose: 'Ambiguous execution mode.' });
await invalid('relai_process', { action: 'start', work_id: 'work', argv: ['server.js'], kind: 'service', purpose: 'Missing executable.' });
await invalid('relai_process', { action: 'start', work_id: 'work', command: 'npm test' });
await valid('relai_process', { action: 'read', work_id: 'work', processId: 'p', includeMetadata: false });
await invalid('relai_process', { action: 'read', work_id: 'work', processId: 'p', command: 'ignored' });
await invalid('relai_work', { action: 'status', title: 'ignored' });
await valid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxFiles: 200, maxResults: 1000 });
await valid('relai_search', { action: 'text', work_id: 'work', queries: ['needle', 'haystack'], maxFiles: 200 });
await invalid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', queries: ['haystack'] });
await invalid('relai_search', { action: 'text', work_id: 'work', queries: ['a', 'b', 'c', 'd', 'e'] });
await invalid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxFiles: 201 });
await invalid('relai_search', { action: 'text', work_id: 'work', pattern: 'needle', maxResults: 1001 });
await valid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', maxResults: 100, maxFiles: 20000 });
await valid('relai_search', { action: 'semantic', work_id: 'work', queries: ['needle', 'haystack'], maxResults: 100 });
await invalid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', queries: ['haystack'] });
await invalid('relai_search', { action: 'semantic', work_id: 'work', maxResults: 101, queries: ['needle'] });
await invalid('relai_search', { action: 'semantic', work_id: 'work', query: 'needle', maxFiles: 20001 });
await valid('relai_validate', { action: 'http', work_id: 'work', route: '/health', timeoutMs: 600000 });
await invalid('relai_validate', { action: 'http', work_id: 'work', route: '/health', level: 'release' });
await invalid('relai_validate', { action: 'http', work_id: 'work', route: '/health', timeoutMs: 600001 });
await valid('relai_exec', { work_id: 'work', command: 'node -v' });
await valid('relai_exec', { work_id: 'work', executable: 'node', argv: ['-v'] });
await valid('relai_exec', { work_id: 'work', executable: 'node', argv: ['-'], input: 'process.stdout.write("ok")' });
await invalid('relai_exec', { work_id: 'work' });
await invalid('relai_exec', { work_id: 'work', command: 'node -v', executable: 'node' });
await invalid('relai_exec', { work_id: 'work', command: 'node -v', argv: ['-v'] });
await valid('relai_edit', { work_id: 'work', path: 'README.md', content: '# Replacement\n' });
await valid('relai_edit', { work_id: 'work', path: 'README.md', oldText: 'before', newText: 'after' });
await valid('relai_edit', { work_id: 'work', path: 'README.md', replacements: [{ oldText: 'before', newText: 'after' }] });
await valid('relai_edit', { work_id: 'work', updateText: '*** Begin Patch\n*** End Patch' });
await valid('relai_edit', { work_id: 'work', edits: [{ path: 'README.md', content: '# Replacement\n' }] });
await valid('relai_edit', { work_id: 'work', stage: 'start', path: 'README.md', content: '# Chunk\n' });
await valid('relai_edit', { work_id: 'work', stage: 'append', writeId: 'write', content: '# Chunk\n' });
await valid('relai_edit', { work_id: 'work', stage: 'commit', writeId: 'write' });
await invalid('relai_edit', { work_id: 'work', path: 'README.md' });
await invalid('relai_edit', { path: 'README.md', content: '# Missing task\n' });
await invalid('relai_edit', { work_id: 'work', path: 'README.md', content: 42 });
await invalid('relai_edit', { work_id: 'work', path: 'README.md', content: '# Replacement\n', overwrite: true });

// Connector discovery intentionally exposes a flat, import-safe superset of
// callable fields. Conditional requirements and cross-action ownership are
// enforced once by the canonical executable/runtime contract below.
await publicValid('relai_work', { action: 'begin', workspace: 'repo' });
await publicValid('relai_work', { action: 'begin' });
await publicValid('relai_work', { action: 'status', title: 'runtime-rejects-sibling-field' });
await publicValid('relai_read', { work_id: 'work', paths: ['README.md'] });
await publicValid('relai_read', { work_id: 'work', ranges: [{ path: 'README.md', startLine: 1, endLine: 2 }] });
await publicValid('relai_search', { action: 'text', work_id: 'work', queries: ['needle', 'haystack'], maxFiles: 200 });
await publicValid('relai_search', { action: 'text', work_id: 'work', query: 'runtime-rejects-sibling-field' });
await publicValid('relai_search', { action: 'semantic', work_id: 'work', queries: ['needle', 'haystack'], maxResults: 100 });
await publicValid('relai_process', { action: 'start', work_id: 'work', command: 'npm run dev' });
await publicValid('relai_inspect', { action: 'symbol', work_id: 'work' });
await publicValid('relai_ui', { action: 'navigate', work_id: 'work', sessionId: 'ui_12345678901234567890' });
await publicValid('relai_validate', { action: 'http', work_id: 'work', route: '/health', level: 'release' });
await publicValid('relai_changes', { action: 'restore', work_id: 'work' });
await publicValid('relai_publish', { action: 'commit', work_id: 'work' });
await publicValid('relai_exec', { work_id: 'work' });
await publicValid('relai_exec', { work_id: 'work', command: 'node -v', executable: 'node' });
await publicValid('relai_edit', { work_id: 'work', path: 'README.md' });
await publicValid('relai_edit', { work_id: 'work', path: 'README.md', content: '# Replacement\n', oldText: 'before', newText: 'after' });

// Discovery still rejects universally invalid shapes: unknown fields, missing
// universal task/action identity, and wrong primitive types.
await publicInvalid('relai_search', { action: 'text', pattern: 'needle' });
await publicInvalid('relai_search', { action: 'text', work_id: 'work', unknown: true });
await publicInvalid('relai_edit', { work_id: 'work', content: 42 });

// Internal/direct invocation gets the same canonical validation before a handler runs.
await validateExecutableOperationInput(OP.SEARCH_TEXT, { workspace: 'repo', work_id: 'work', pattern: 'needle', maxFiles: 200 });
await assert.rejects(() => validateExecutableOperationInput(OP.SEARCH_TEXT, { workspace: 'repo', pattern: 'needle', maxFiles: 201 }), /Input validation error for search\.text/);
await assert.rejects(() => validateExecutableOperationInput(OP.SEARCH_SEMANTIC, { workspace: 'repo', query: 'needle', maxResults: 101 }), /Input validation error for search\.semantic/);
await assert.rejects(() => validateExecutableOperationInput(OP.VALIDATE_HTTP, { workspace: 'repo', route: '/health', timeoutMs: 600001 }), /Input validation error for validate\.http/);
await assert.rejects(() => validateExecutableOperationInput(OP.EXEC, { workspace: 'repo' }), /Input validation error for exec/);
await assert.rejects(() => validateExecutableOperationInput(OP.EDIT, { workspace: 'repo', path: 'README.md' }), /Input validation error for edit/);

assert.throws(() => resolveToolOperation('relai_work', { action: 'begin', workspace: 'repo', work_id: 'wrong-action-field' }), /Unsupported field 'work_id'/);
assert.throws(() => resolveToolOperation('relai_work', { action: 'status', title: 'wrong-action-field' }), /Unsupported field 'title'/);
assert.throws(() => resolveToolOperation('relai_process', { action: 'read', work_id: 'work', processId: 'p', command: 'wrong-action-field' }), /Unsupported field 'command'/);
assert.throws(() => resolveToolOperation('relai_process', { action: 'read', work_id: 'work', processId: 'p', unknown: true }), /Unsupported field 'unknown'/);
assert.equal(resolveToolOperation('relai_validate', { action: 'checks', work_id: 'work' }).operationName, OP.VALIDATE_CHECKS);
assert.equal(resolveToolOperation('relai_validate', { action: 'http', work_id: 'work', route: '/health' }).operationName, OP.VALIDATE_HTTP);

const metadata = getToolMetadata(config);
const validateMetadata = metadata.find(item => item.name === 'relai_validate');
assert.equal(validateMetadata.taskSupport, 'optional');
assert.equal(validateMetadata.actions.find(item => item.action === 'checks').taskSupport, 'optional');
assert.equal(validateMetadata.actions.find(item => item.action === 'diagnostics').taskSupport, 'optional');
assert.equal(validateMetadata.actions.find(item => item.action === 'http').taskSupport, 'optional');
assert.equal(validateMetadata.actions.find(item => item.action === 'http').executionClass, 'native_task_eligible');
assert.ok(validateMetadata.actions.find(item => item.action === 'http').fields.includes('route'));
const processMetadata = metadata.find(item => item.name === 'relai_process');
assert.ok(processMetadata.actions.find(item => item.action === 'start').required.includes('kind'));
assert.ok(processMetadata.actions.find(item => item.action === 'start').required.includes('purpose'));
const groups = getToolGroups(config);
assert.ok(groups.git.includes('relai_publish'));
assert.ok(groups.cleanup.includes('relai_changes'));

console.log(`Unified tool surface and action contracts passed: ${schemaBytes} bytes.`);

function bytes(tools) { return Buffer.byteLength(JSON.stringify({ tools }), 'utf8'); }
async function valid(name, value) {
  const result = await fromJsonSchema(schemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.equal(result.issues, undefined, `${name} valid input: ${JSON.stringify(result.issues || [])}`);
}
async function invalid(name, value) {
  const result = await fromJsonSchema(schemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.ok(result.issues?.length, `${name} must reject ${JSON.stringify(value)}`);
}
async function publicValid(name, value) {
  const result = await fromJsonSchema(publicSchemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.equal(result.issues, undefined, `${name} public valid input: ${JSON.stringify(result.issues || [])}`);
}
async function publicInvalid(name, value) {
  const result = await fromJsonSchema(publicSchemaByName.get(name).inputSchema)['~standard'].validate(value);
  assert.ok(result.issues?.length, `${name} public schema must reject ${JSON.stringify(value)}`);
}
