import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolSchema } from '@modelcontextprotocol/core';
import { fromJsonSchema } from '@modelcontextprotocol/server';

import { clearDashboardSessions } from '../src/http/dashboardSessions.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';
import { clearTaskHistory, flushTaskHistoryPersistence } from '../src/taskHistoryStore.js';
import {
  REL_AI_APP_UI_DOMAIN,
  REL_AI_APP_UI_MIME,
  REL_AI_APP_UI_URI,
  appUiResourceContent,
  appUiResultMetadata,
  invokeAppUiTool
} from '../src/mcp/appUi.js';
import { openAiConversationId, toolContext } from '../src/mcp/context.js';
import { LOCAL_DEVELOPER_SECURITY_SCHEMES, LOCAL_DEVELOPER_TOOL_ANNOTATIONS } from '../src/mcp/localDeveloperMode.js';
import { toolResult } from '../src/mcp/results.js';
import { serializeToolError } from '../src/tools/errors.js';
import { listResources, readResource } from '../src/resources.js';
import { callTool } from '../src/tools.js';
import { getMcpToolSchemas, getPublicToolSchemas } from '../src/tools/schema.js';

const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const previousConfig = process.env.REL_AI_MCP_CONFIG;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-mcp-app-ui-'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(temp, 'config.json');
process.env.REL_AI_MCP_STATE_DIR = temp;
process.env.REL_AI_MCP_CONFIG = configPath;
fs.writeFileSync(configPath, JSON.stringify({ version: 3, stateDir: temp, workspaces: { repo: { path: root } } }, null, 2));

try {
  const publicSchemas = getPublicToolSchemas();
  const mcpSchemas = getMcpToolSchemas();
  const publicByName = new Map(publicSchemas.map(schema => [schema.name, schema]));
  const mcpByName = new Map(mcpSchemas.map(schema => [schema.name, schema]));

  assert.equal(publicSchemas.length, 12, 'local developer mode keeps the compact 12-tool model surface');
  assert.equal(mcpSchemas.length, 13, 'MCP Apps adds one app-only status helper without adding a model-selectable tool');
  for (const schema of mcpSchemas) {
    assert.equal(ToolSchema.safeParse(schema).success, true, `${schema.name} must remain a valid MCP tool descriptor`);
  }
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
    assert.deepEqual(schema.annotations, LOCAL_DEVELOPER_TOOL_ANNOTATIONS, `${schema.name} must present as read-only to the local ChatGPT developer connector`);
    assert.deepEqual(schema._meta?.securitySchemes, LOCAL_DEVELOPER_SECURITY_SCHEMES, `${schema.name} must advertise noauth through the ChatGPT compatibility metadata supported by the installed MCP SDK`);
    const expected = invocationLabels.get(schema.name);
    assert.ok(expected, `${schema.name} must define ChatGPT invocation labels`);
    assert.deepEqual([
      schema._meta?.['openai/toolInvocation/invoking'],
      schema._meta?.['openai/toolInvocation/invoked']
    ], expected, `${schema.name} must replace generic Called tool chrome with concise status text`);
    assert.ok(expected.every(label => label.length <= 64), `${schema.name} invocation labels must stay within the OpenAI 64-character limit`);
    assert.ok(expected.every(label => !/called tool/i.test(label)), `${schema.name} must not use the generic Called tool label`);
  }

  const workMeta = publicByName.get('relai_work')?._meta;
  assert.equal(workMeta?.ui?.resourceUri, REL_AI_APP_UI_URI);
  assert.deepEqual(workMeta?.ui?.visibility, ['model', 'app']);
  assert.equal(workMeta?.['openai/outputTemplate'], REL_AI_APP_UI_URI);
  assert.ok(String(workMeta?.['openai/toolInvocation/invoking'] || '').length <= 64);
  assert.ok(String(workMeta?.['openai/toolInvocation/invoked'] || '').length <= 64);
  for (const schema of publicSchemas.filter(schema => schema.name !== 'relai_work')) {
    assert.equal(schema._meta?.ui?.resourceUri, undefined, `${schema.name} stays data-only so ordinary operations do not mount UI`);
    assert.equal(schema._meta?.['openai/outputTemplate'], undefined, `${schema.name} must not inherit the Rel.AI status-strip template`);
  }

  const appTaskSchema = mcpByName.get('relai_app_task');
  assert.ok(appTaskSchema, 'the read-only status helper must be registered for the mounted app');
  assert.deepEqual(appTaskSchema._meta?.ui?.visibility, ['app']);
  assert.deepEqual(appTaskSchema.annotations, LOCAL_DEVELOPER_TOOL_ANNOTATIONS);
  assert.deepEqual(appTaskSchema._meta?.securitySchemes, LOCAL_DEVELOPER_SECURITY_SCHEMES);
  assert.equal(publicByName.has('relai_app_task'), false, 'the app-only status helper must not enter the model-facing public catalog');
  assert.equal(mcpByName.has('relai_app_open'), false, 'desktop launch helper must be removed from the pure status surface');
  assert.equal(appTaskSchema.inputSchema.properties.action, undefined, 'the status helper must not retain obsolete action routing');
  const appTaskOutputValidator = fromJsonSchema(appTaskSchema.outputSchema)['~standard'];
  const appTaskError = new Error('Task is unavailable.');
  appTaskError.code = 'INVALID_TASK_STATE';
  const serializedAppTaskError = serializeToolError('relai_app_task', appTaskError);
  assert.equal((await appTaskOutputValidator.validate(serializedAppTaskError)).issues, undefined, 'app helper errors must satisfy the advertised structured-output schema');

  const resources = listResources({ workspaces: {} });
  const appResource = resources.resources.find(resource => resource.uri === REL_AI_APP_UI_URI);
  assert.ok(appResource, 'resources/list must advertise the Rel.AI MCP Apps resource');
  assert.equal(appResource.mimeType, REL_AI_APP_UI_MIME);

  const resourceRead = await readResource(REL_AI_APP_UI_URI);
  assert.equal(resourceRead.contents.length, 1);
  const content = resourceRead.contents[0];
  assert.equal(content.uri, REL_AI_APP_UI_URI);
  assert.equal(content.mimeType, REL_AI_APP_UI_MIME);
  assert.equal(content._meta.ui.prefersBorder, false);
  assert.equal(content._meta.ui.domain, REL_AI_APP_UI_DOMAIN);
  assert.equal(content._meta['openai/widgetDomain'], REL_AI_APP_UI_DOMAIN);
  assert.match(content._meta['openai/widgetDescription'], /Do not restate/i, 'widget description must discourage redundant assistant narration');
  assert.deepEqual(content._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.deepEqual(content._meta['openai/widgetCSP'], { connect_domains: [], resource_domains: [] });
  assert.equal((content.text.match(/<button\b/g) || []).length, 0, 'the status strip must expose no actions');
  assert.doesNotMatch(content.text, /View changes|Open in Rel\.AI|relai_app_open|requestDisplayMode|setWidgetState|widgetState|action:'changes'/, 'interactive workflow-card behavior must be removed');
  assert.doesNotMatch(content.text, /class="mark"|>R<|<h1 id="title">Rel\.AI<\/h1>/, 'ChatGPT already renders the app identity before the widget');
  for (const expected of [
    'ui/notifications/tool-result', 'tools/call', 'relai_app_task',
    'notifyIntrinsicHeight', 'ui/notifications/size-changed', 'openai:set_globals', 'safeArea', 'globals.toolOutput', 'input.arguments',
    "action==='begin'", 'refreshLiveStatus', 'lifecycle-hidden', 'height=cardVisible'
  ]) assert.ok(content.text.includes(expected), `status strip must implement ${expected}`);
  assert.doesNotMatch(content.text, /innerHTML|document\.write|<script[^>]+src=/i, 'status strip must not inject untrusted HTML or load external scripts');
  assert.match(content.text, /setTimeout\(function\(\)\{void refreshLiveStatus\(\)\},3000\)/, 'the begin status strip must refresh through the app-only status helper');
  assert.match(content.text, /cardVisible\?Math\.max\(1,Math\.ceil\(document\.documentElement\.scrollHeight\)\):1/, 'non-begin lifecycle widgets must request an explicit one-pixel collapsed height instead of zero, which hosts may treat as an unspecified iframe size');
  assert.match(content.text, /body\.lifecycle-hidden\{height:1px;min-height:1px;padding:0;overflow:hidden\}/, 'hidden lifecycle mounts must keep their own document layout collapsed while ChatGPT retains the tool wrapper');
  assert.doesNotMatch(content.text, /cardVisible\?Math\.ceil\(document\.documentElement\.scrollHeight\):0/, 'hidden lifecycle mounts must never report zero intrinsic height');

  const directContent = appUiResourceContent();
  assert.equal(directContent.text, content.text, 'resource helper and MCP resource read must use one canonical component source');

  assert.deepEqual(appUiResultMetadata('relai_work'), {
    relai: { surface: 'status-strip', version: 2 }
  });
  assert.equal(appUiResultMetadata('relai_validate'), undefined, 'validation must remain data-only instead of mounting another status strip');

  const task = await callTool('relai_work', { action: 'begin', workspace: 'repo', bootstrap: 'none' });
  assert.ok(task.work_id);
  const liveStatus = await invokeAppUiTool('relai_app_task', { work_id: task.work_id }, {});
  assert.equal(liveStatus.ok, true);
  assert.equal(liveStatus.data.work_id, task.work_id);
  assert.equal((await appTaskOutputValidator.validate(liveStatus)).issues, undefined, 'successful status helper output must satisfy the advertised structured-output schema');

  const completed = await callTool('relai_work', {
    action: 'finish', workspace: 'repo', work_id: task.work_id, summary: 'Completed read-only status-strip fixture.'
  });
  assert.equal(completed.completionKnown, true);
  const completedStatus = await invokeAppUiTool('relai_app_task', { work_id: task.work_id }, {});
  assert.equal(completedStatus.ok, true, 'status remains readable after task completion');
  assert.equal(completedStatus.data.task?.status, 'completed');

  const wrapped = toolResult({ ok: true, work_id: 'work-1', summary: 'Duplicate model-visible success detail.' }, false, { relai: { surface: 'status-strip' } });
  assert.deepEqual(wrapped.structuredContent, { ok: true, work_id: 'work-1', summary: 'Duplicate model-visible success detail.' });
  assert.equal(wrapped.content[0].text, 'Rel.AI operation succeeded.', 'successful structured results must not repeat their fields in model-visible text');
  assert.deepEqual(wrapped._meta, { relai: { surface: 'status-strip' } });
  assert.equal(wrapped.isError, false);
  const failed = toolResult({ ok: false, error: 'Detailed failure', nextAction: 'Retry carefully.' }, true);
  assert.match(failed.content[0].text, /Detailed failure/);
  assert.match(failed.content[0].text, /Retry carefully/);

  const openAiEnvelope = { 'openai/session': 'chat-session-regression' };
  assert.equal(openAiConversationId(openAiEnvelope), 'chat-session-regression');
  assert.equal(toolContext({ mcpReq: { id: 42, _meta: openAiEnvelope, envelope: {} } }).conversationId, 'chat-session-regression', 'ChatGPT vendor metadata from the SDK request context must populate the existing conversation correlation field');

  console.log('Local developer-mode read-only MCP Apps status strip and OpenAI metadata integration passed.');
} finally {
  await repositoryIntelligence.shutdown();
  await flushTaskHistoryPersistence();
  clearTaskHistory({ stateDir: temp, auditLogPath: path.join(temp, 'audit.jsonl') });
  clearDashboardSessions();
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (previousStateDir === undefined) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  if (previousConfig === undefined) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
}
