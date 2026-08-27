import { readFileSync } from 'node:fs';

// ChatGPT treats the UI resource URI as a cache key. Bump it whenever the component HTML/CSS/JS changes.
const REL_AI_APP_UI_URI = 'ui://relai/task-card/v5.html';
const REL_AI_APP_UI_MIME = 'text/html;profile=mcp-app';
const REL_AI_APP_UI_DOMAIN = 'https://web-sandbox.oaiusercontent.com';
const TASK_CARD_HTML = readFileSync(new URL('./ui/workflow-card.html', import.meta.url), 'utf8');
const LIFECYCLE_ACTIONS = new Set(['begin', 'finish', 'cancel']);

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

function rendersTaskCard(name) {
  return String(name || '') === 'relai_work';
}

function toolUiMetadata(name) {
  const toolName = String(name || '');
  const status = TOOL_INVOCATION_STATUS[toolName];
  if (!status) return undefined;
  const metadata = {
    'openai/toolInvocation/invoking': status[0],
    'openai/toolInvocation/invoked': status[1]
  };
  if (rendersTaskCard(toolName)) {
    metadata.ui = Object.freeze({ resourceUri: REL_AI_APP_UI_URI, visibility: Object.freeze(['model', 'app']) });
    metadata['openai/outputTemplate'] = REL_AI_APP_UI_URI;
  }
  return Object.freeze(metadata);
}

function appUiResultMetadata(name, args = {}) {
  if (!rendersTaskCard(name) || !LIFECYCLE_ACTIONS.has(String(args.action || ''))) return undefined;
  return { relai: { surface: 'task-card', version: 5 } };
}

function appUiResourceContent() {
  return {
    uri: REL_AI_APP_UI_URI,
    mimeType: REL_AI_APP_UI_MIME,
    text: TASK_CARD_HTML,
    _meta: {
      ui: {
        prefersBorder: false,
        domain: REL_AI_APP_UI_DOMAIN,
        csp: { connectDomains: [], resourceDomains: [] }
      },
      'openai/widgetDescription': 'Passive Rel.AI task lifecycle card. It supplements the conversation and never replaces normal user-visible progress preambles or final explanations. It never polls or calls tools.',
      'openai/widgetPrefersBorder': false,
      'openai/widgetDomain': REL_AI_APP_UI_DOMAIN,
      'openai/widgetCSP': {
        connect_domains: [],
        resource_domains: []
      }
    }
  };
}

export {
  REL_AI_APP_UI_DOMAIN,
  REL_AI_APP_UI_MIME,
  REL_AI_APP_UI_URI,
  appUiResourceContent,
  appUiResultMetadata,
  toolUiMetadata
};
