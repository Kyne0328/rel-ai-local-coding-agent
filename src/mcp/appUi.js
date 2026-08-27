import { readFileSync } from 'node:fs';

import { LOCAL_DEVELOPER_SECURITY_SCHEMES, LOCAL_DEVELOPER_TOOL_ANNOTATIONS } from './localDeveloperMode.js';

// ChatGPT treats the UI resource URI as a cache key. Bump it whenever the component HTML/CSS/JS changes.
const REL_AI_APP_UI_URI = 'ui://relai/status-strip/v3.html';
const REL_AI_APP_UI_MIME = 'text/html;profile=mcp-app';
const REL_AI_APP_UI_DOMAIN = 'https://web-sandbox.oaiusercontent.com';
const STATUS_STRIP_HTML = readFileSync(new URL('./ui/workflow-card.html', import.meta.url), 'utf8');

const APP_UI_TOOL_STATUS = Object.freeze({
  relai_work: ['Updating Rel.AI task…', 'Rel.AI task updated']
});

const TOOL_INVOCATION_STATUS = Object.freeze({
  relai_work: ['Updating Rel.AI task…', 'Rel.AI task updated'],
  relai_snapshot: ['Scanning repository…', 'Repository scanned'],
  relai_read: ['Reading repository…', 'Repository read'],
  relai_search: ['Searching repository…', 'Repository searched'],
  relai_inspect: ['Inspecting code…', 'Code inspected'],
  relai_edit: ['Applying changes…', 'Changes applied'],
  relai_exec: ['Running command…', 'Command finished'],
  relai_process: ['Managing process…', 'Process updated'],
  relai_ui: ['Testing local UI…', 'Local UI tested'],
  relai_validate: ['Validating changes…', 'Validation finished'],
  relai_changes: ['Reviewing changes…', 'Changes reviewed'],
  relai_publish: ['Publishing changes…', 'Changes published']
});

const APP_UI_TOOL_SCHEMAS = Object.freeze([
  Object.freeze({
    name: 'relai_app_task',
    title: 'Rel.AI App Task Status',
    description: 'UI-only helper that returns current task state for the mounted read-only Rel.AI status strip.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: {
        work_id: { type: 'string', minLength: 1, maxLength: 200 },
        workspace: { type: 'string' }
      },
      required: ['work_id'],
      additionalProperties: false
    }),
    outputSchema: Object.freeze({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        data: { type: 'object', additionalProperties: true },
        error: { type: 'string' },
        errorCode: { type: 'string' },
        errorDetails: { type: 'object', additionalProperties: true }
      },
      required: ['ok'],
      additionalProperties: false
    }),
    annotations: LOCAL_DEVELOPER_TOOL_ANNOTATIONS,
    _meta: Object.freeze({
      securitySchemes: LOCAL_DEVELOPER_SECURITY_SCHEMES,
      ui: Object.freeze({ visibility: Object.freeze(['app']) })
    })
  })
]);

function isAppUiTool(name) {
  return Object.hasOwn(APP_UI_TOOL_STATUS, String(name || ''));
}

function toolUiMetadata(name) {
  const toolName = String(name || '');
  const status = TOOL_INVOCATION_STATUS[toolName];
  if (!status) return undefined;
  const metadata = {
    'openai/toolInvocation/invoking': status[0],
    'openai/toolInvocation/invoked': status[1]
  };
  if (isAppUiTool(toolName)) {
    metadata.ui = Object.freeze({ resourceUri: REL_AI_APP_UI_URI, visibility: Object.freeze(['model', 'app']) });
    metadata['openai/outputTemplate'] = REL_AI_APP_UI_URI;
  }
  return Object.freeze(metadata);
}

function appUiResultMetadata(name) {
  if (!isAppUiTool(name)) return undefined;
  return { relai: { surface: 'status-strip', version: 3 } };
}

function appUiResourceContent() {
  return {
    uri: REL_AI_APP_UI_URI,
    mimeType: REL_AI_APP_UI_MIME,
    text: STATUS_STRIP_HTML,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: REL_AI_APP_UI_DOMAIN,
        csp: { connectDomains: [], resourceDomains: [] }
      },
      'openai/widgetDescription': 'Authoritative compact task status. Do not restate its status, validation, workspace, or changed-file count unless the user asks.',
      'openai/widgetPrefersBorder': false,
      'openai/widgetDomain': REL_AI_APP_UI_DOMAIN,
      'openai/widgetCSP': {
        connect_domains: [],
        resource_domains: []
      }
    }
  };
}

function getAppUiToolSchemas() {
  return APP_UI_TOOL_SCHEMAS;
}

async function invokeAppUiTool(name, args = {}, context = {}) {
  if (name !== 'relai_app_task') throw new Error(`Unknown Rel.AI app-only tool '${name}'.`);
  const { callTool } = await import('../tools/callTool.js');
  const workId = String(args.work_id || '').trim();
  const workspace = String(args.workspace || '').trim();
  const publicArgs = { action: 'status', work_id: workId };
  if (workspace) publicArgs.workspace = workspace;
  const output = await callTool('relai_work', publicArgs, { ...context, trackTaskActivity: false });
  return { ok: output?.ok !== false, data: output || {} };
}

export {
  REL_AI_APP_UI_DOMAIN,
  REL_AI_APP_UI_MIME,
  REL_AI_APP_UI_URI,
  appUiResourceContent,
  appUiResultMetadata,
  getAppUiToolSchemas,
  invokeAppUiTool,
  isAppUiTool,
  toolUiMetadata
};
