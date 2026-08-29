import assert from 'node:assert/strict';
import { ToolSchema } from '@modelcontextprotocol/core';

import { toolUiMetadata } from '../src/mcp/appUi.js';
import { openAiConversationId, toolContext } from '../src/mcp/context.js';
import { LOCAL_DEVELOPER_SECURITY_SCHEMES, LOCAL_DEVELOPER_TOOL_ANNOTATIONS } from '../src/mcp/localDeveloperMode.js';
import { PUBLIC_MCP_SERVER_INSTRUCTIONS } from '../src/mcp/serverInstructions.js';
import { getMcpToolSchemas, getPublicToolSchemas } from '../src/tools/schema.js';

const publicSchemas = getPublicToolSchemas();
const mcpSchemas = getMcpToolSchemas();

assert.equal(publicSchemas.length, 12, 'local developer mode keeps the compact 12-tool model surface');
assert.equal(mcpSchemas.length, 12, 'native status presentation must not add helper tools');
assert.equal(mcpSchemas.some(schema => schema.name.startsWith('relai_app_')), false, 'no app-only status helper may be registered');
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
  assert.deepEqual(toolUiMetadata(schema.name), {
    'openai/toolInvocation/invoking': expected[0],
    'openai/toolInvocation/invoked': expected[1]
  });
  assert.equal(schema._meta?.ui, undefined, `${schema.name} must stay iframe-free`);
  assert.equal(schema._meta?.['openai/outputTemplate'], undefined, `${schema.name} must not attach a ChatGPT output template`);
  assert.ok(expected.every(label => label.length <= 64));
}

assert.match(PUBLIC_MCP_SERVER_INSTRUCTIONS, /brief normal assistant progress messages/i, 'server instructions must preserve visible progress around tool use');
assert.match(PUBLIC_MCP_SERVER_INSTRUCTIONS, /Native tool invocation labels are supplemental status only and must not replace those progress messages/i);
assert.match(PUBLIC_MCP_SERVER_INSTRUCTIONS, /do not expose private chain-of-thought/i);

const openAiEnvelope = { 'openai/session': 'chat-session-regression' };
assert.equal(openAiConversationId(openAiEnvelope), 'chat-session-regression');
assert.equal(toolContext({ mcpReq: { id: 42, _meta: openAiEnvelope, envelope: {} } }).conversationId, 'chat-session-regression');

console.log('Native ChatGPT status labels coexist with user-visible progress without mounting a Rel.AI iframe.');
