import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ToolSchema } from '@modelcontextprotocol/core';

import {
  REL_AI_APP_UI_DOMAIN,
  REL_AI_APP_UI_MIME,
  REL_AI_APP_UI_URI,
  appUiResultMetadata,
  toolUiMetadata
} from '../src/mcp/appUi.js';
import { openAiConversationId, toolContext } from '../src/mcp/context.js';
import { LOCAL_DEVELOPER_SECURITY_SCHEMES, LOCAL_DEVELOPER_TOOL_ANNOTATIONS } from '../src/mcp/localDeveloperMode.js';
import { PUBLIC_MCP_SERVER_INSTRUCTIONS } from '../src/mcp/serverInstructions.js';
import { toolResult } from '../src/mcp/results.js';
import { listResources, readResource } from '../src/resources.js';
import { getMcpToolSchemas, getPublicToolSchemas } from '../src/tools/schema.js';

const publicSchemas = getPublicToolSchemas();
const mcpSchemas = getMcpToolSchemas();
const publicByName = new Map(publicSchemas.map(schema => [schema.name, schema]));

assert.equal(publicSchemas.length, 12, 'local developer mode keeps the compact 12-tool model surface');
assert.equal(mcpSchemas.length, 12, 'passive task card must not add app-only helper tools');
assert.equal(mcpSchemas.some(schema => schema.name.startsWith('relai_app_')), false, 'no app-only polling helper may be registered');
for (const schema of mcpSchemas) assert.equal(ToolSchema.safeParse(schema).success, true, `${schema.name} must remain a valid MCP tool descriptor`);

const invocationLabels = new Map([
  ['relai_work', ['Updating Rel.AI task…', 'Rel.AI task updated']],
  ['relai_snapshot', ['Scanning repository…', 'Repository scanned']],
  ['relai_read', ['Reading repository…', 'Repository read']],
  ['relai_search', ['Searching repository…', 'Repository searched']],
  ['relai_inspect', ['Inspecting code…', 'Code inspected']],
  ['relai_edit', ['Applying changes…', 'Changes applied']],
  ['relai_exec', ['Running command…', 'Command finished']],
  ['relai_process', ['Managing process…', 'Process updated']],
  ['relai_ui', ['Testing local UI…', 'Local UI tested']],
  ['relai_validate', ['Validating changes…', 'Validation finished']],
  ['relai_changes', ['Reviewing changes…', 'Changes reviewed']],
  ['relai_publish', ['Publishing changes…', 'Changes published']]
]);
for (const schema of publicSchemas) {
  assert.deepEqual(schema.annotations, LOCAL_DEVELOPER_TOOL_ANNOTATIONS, `${schema.name} must present as read-only to the local ChatGPT connector`);
  assert.deepEqual(schema._meta?.securitySchemes, LOCAL_DEVELOPER_SECURITY_SCHEMES, `${schema.name} must advertise noauth compatibility metadata`);
  const expected = invocationLabels.get(schema.name);
  assert.deepEqual([
    schema._meta?.['openai/toolInvocation/invoking'],
    schema._meta?.['openai/toolInvocation/invoked']
  ], expected, `${schema.name} must retain concise native invocation labels`);
  assert.ok(expected.every(label => label.length <= 64));
}

const workMeta = publicByName.get('relai_work')?._meta;
assert.equal(workMeta?.ui?.resourceUri, REL_AI_APP_UI_URI);
assert.deepEqual(workMeta?.ui?.visibility, ['model', 'app']);
assert.equal(workMeta?.['openai/outputTemplate'], REL_AI_APP_UI_URI);
for (const schema of publicSchemas.filter(schema => schema.name !== 'relai_work')) {
  assert.equal(schema._meta?.ui, undefined, `${schema.name} stays data-only so frequent tools never mount UI`);
  assert.equal(schema._meta?.['openai/outputTemplate'], undefined, `${schema.name} must not inherit the task-card template`);
  assert.deepEqual(toolUiMetadata(schema.name), {
    'openai/toolInvocation/invoking': invocationLabels.get(schema.name)[0],
    'openai/toolInvocation/invoked': invocationLabels.get(schema.name)[1]
  });
}

const resources = listResources({ workspaces: {} });
const appResource = resources.resources.find(resource => resource.uri === REL_AI_APP_UI_URI);
assert.ok(appResource, 'resources/list must advertise the passive Rel.AI task card');
assert.equal(appResource.mimeType, REL_AI_APP_UI_MIME);
assert.equal(fs.existsSync(new URL('../src/mcp/ui/workflow-card.html', import.meta.url)), true);
const resourceRead = await readResource(REL_AI_APP_UI_URI);
const content = resourceRead.contents[0];
assert.equal(content.uri, REL_AI_APP_UI_URI);
assert.equal(content.mimeType, REL_AI_APP_UI_MIME);
assert.equal(content._meta.ui.domain, REL_AI_APP_UI_DOMAIN);
assert.equal(content._meta['openai/widgetDomain'], REL_AI_APP_UI_DOMAIN);
assert.match(content._meta['openai/widgetDescription'], /supplements the conversation/i);
assert.match(content._meta['openai/widgetDescription'], /never replaces normal user-visible progress preambles/i);
assert.match(content._meta['openai/widgetDescription'], /never polls or calls tools/i);
assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
assert.equal((content.text.match(/<button\b/g) || []).length, 0, 'task card must expose no actions');
for (const forbidden of ['tools/call', 'relai_app_task', 'window.openai.callTool', 'setTimeout(', 'setInterval(', 'ResizeObserver', 'refreshLiveStatus', 'scheduleLiveStatus']) {
  assert.equal(content.text.includes(forbidden), false, `passive task card must not contain background-work primitive ${forbidden}`);
}
assert.match(content.text, /\['begin','finish','cancel'\]\.includes\(action\)/, 'only lifecycle-changing work actions stay visible as cards');
assert.match(content.text, /if\(height===lastReportedHeight\)return/, 'unchanged card height must not notify the host repeatedly');
assert.match(content.text, /requestHostClose\(\)/, 'status-only mounts must close instead of leaving an empty card shell');

assert.match(PUBLIC_MCP_SERVER_INSTRUCTIONS, /brief user-visible progress preambles/i, 'server instructions must preserve visible progress messages around tool use');
assert.match(PUBLIC_MCP_SERVER_INSTRUCTIONS, /do not expose private chain-of-thought/i);

assert.deepEqual(appUiResultMetadata('relai_work', { action: 'begin' }), { relai: { surface: 'task-card', version: 5 } });
assert.deepEqual(appUiResultMetadata('relai_work', { action: 'finish' }), { relai: { surface: 'task-card', version: 5 } });
assert.deepEqual(appUiResultMetadata('relai_work', { action: 'cancel' }), { relai: { surface: 'task-card', version: 5 } });
assert.equal(appUiResultMetadata('relai_work', { action: 'status' }), undefined, 'status-only calls carry no card hydration metadata');
assert.equal(appUiResultMetadata('relai_validate', { action: 'checks' }), undefined);

const wrapped = toolResult({ ok: true, work_id: 'work-1' }, false, appUiResultMetadata('relai_work', { action: 'begin' }));
assert.deepEqual(wrapped._meta, { relai: { surface: 'task-card', version: 5 } });

const openAiEnvelope = { 'openai/session': 'chat-session-regression' };
assert.equal(openAiConversationId(openAiEnvelope), 'chat-session-regression');
assert.equal(toolContext({ mcpReq: { id: 42, _meta: openAiEnvelope, envelope: {} } }).conversationId, 'chat-session-regression');

console.log('Passive MCP task card coexists with native ChatGPT progress preambles and performs no background work.');
