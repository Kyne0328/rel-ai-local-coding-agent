// @ts-check

import { z } from 'zod';
import { OPERATION_IDS as OP } from './operationIds.js';

const PUBLIC_CONTRACT_SCHEMA = z.object({
  required: z.array(z.string()).default([]),
  omit: z.array(z.string()).default([]),
  extra: z.record(z.string(), z.unknown()).default({})
}).strict();

const READ = 'repository:read';
const WRITE = 'repository:write';
const EXECUTE = 'command:execute';
const PROCESS = 'process:manage';
const PUBLISH = 'git:publish';

const TOOL_SURFACE_SOURCE_PATHS = Object.freeze([
  'src/tools/actionCatalog.js',
  'src/tools/actionDefinitions.js',
  'src/tools/actionRegistry.js',
  'src/tools/callTool.js',
  'src/tools/compactResult.js',
  'src/tools/connector.js',
  'src/tools/connectorHelpers.js',
  'src/tools/errors.js',
  'src/tools/executableSchema.js',
  'src/tools/handlers.js',
  'src/tools/operationDefinitionValues.js',
  'src/tools/operationIds.js',
  'src/tools/outputSchemas.js',
  'src/tools/outputValidation.js',
  'src/tools/publicOperationSchemas.js',
  'src/tools/publicSchema.js',
  'src/tools/runtimeRegistry.js',
  'src/tools/schema.js'
]);
const TOOL_SURFACE_SOURCE_SET = new Set(TOOL_SURFACE_SOURCE_PATHS);

const INSPECT_FIELDS = Object.freeze({
  symbol: contract({ required: ['symbol'], omit: ['query', 'paths', 'maxDepth'] }),
  references: contract({ required: ['symbol'], omit: ['query', 'paths', 'maxDepth'] }),
  related: contract({ omit: ['paths', 'maxDepth'], extra: { anyOf: [{ required: ['query'] }, { required: ['symbol'] }] } }),
  impact: contract({ omit: ['query'], extra: { anyOf: [{ required: ['symbol'] }, { required: ['paths'] }] } }),
  trace: contract({ required: ['symbol'], omit: ['query', 'paths'] }),
  diagnostics: contract({ omit: ['symbol', 'query', 'paths', 'maxResults', 'maxDepth'] }),
  architecture: contract({ omit: ['symbol', 'query', 'paths', 'maxDepth'] })
});

const UI_OMIT = Object.freeze({
  start: ['sessionId', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  navigate: ['port', 'host', 'protocol', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  snapshot: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  interact: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'fullPage', 'maxEntries', 'clear'],
  screenshot: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'maxEntries', 'clear'],
  console: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage'],
  network: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage'],
  viewport: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  reload: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear'],
  stop: ['port', 'host', 'protocol', 'route', 'allowedPorts', 'headless', 'width', 'height', 'timeoutMs', 'interaction', 'target', 'input', 'key', 'selectValue', 'state', 'fullPage', 'maxEntries', 'clear']
});

const ACTION_REGISTRY = Object.freeze({
  relai_work: Object.freeze({
    begin: operation(OP.WORK_BEGIN, { capability: READ }),
    status: operation(OP.WORK_STATUS, { capability: READ }),
    finish: operation(OP.WORK_FINISH, { capability: READ }),
    cancel: operation(OP.WORK_CANCEL, { capability: READ })
  }),
  relai_snapshot: Object.freeze({ default: operation(OP.SNAPSHOT, { capability: READ }) }),
  relai_read: Object.freeze({ default: operation(OP.READ, { capability: READ }) }),
  relai_search: Object.freeze({
    text: operation(OP.SEARCH_TEXT, { capability: READ }),
    semantic: operation(OP.SEARCH_SEMANTIC, { capability: READ })
  }),
  relai_inspect: Object.freeze(Object.fromEntries(Object.entries(INSPECT_FIELDS).map(([action, publicContract]) => [
    action,
    operation(OP.INSPECT, { capability: READ, keepAction: true, publicContract })
  ]))),
  relai_edit: Object.freeze({ default: operation(OP.EDIT, { capability: WRITE }) }),
  relai_exec: Object.freeze({ default: operation(OP.EXEC, { capability: EXECUTE }) }),
  relai_process: Object.freeze({
    start: operation(OP.PROCESS_START, { capability: PROCESS }),
    read: operation(OP.PROCESS_READ, { capability: READ }),
    write: operation(OP.PROCESS_WRITE, { capability: PROCESS }),
    stop: operation(OP.PROCESS_STOP, { capability: PROCESS }),
    list: operation(OP.PROCESS_LIST, { capability: READ })
  }),
  relai_ui: Object.freeze({
    start: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['port'], omit: UI_OMIT.start }) }),
    navigate: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'route'], omit: UI_OMIT.navigate }) }),
    snapshot: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.snapshot }) }),
    interact: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'interaction', 'target'], omit: UI_OMIT.interact }) }),
    screenshot: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.screenshot }) }),
    console: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.console }) }),
    network: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.network }) }),
    viewport: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId', 'width', 'height'], omit: UI_OMIT.viewport }) }),
    reload: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.reload }) }),
    stop: operation(OP.UI, { capability: PROCESS, keepAction: true, publicContract: contract({ required: ['sessionId'], omit: UI_OMIT.stop }) })
  }),
  relai_validate: Object.freeze({
    checks: operation(OP.VALIDATE_CHECKS, { capability: EXECUTE }),
    diagnostics: operation(OP.VALIDATE_DIAGNOSTICS, { capability: EXECUTE }),
    http: operation(OP.VALIDATE_HTTP, { capability: READ })
  }),
  relai_changes: Object.freeze({
    diff: operation(OP.CHANGES_DIFF, { capability: READ }),
    restore: operation(OP.CHANGES_RESTORE, { capability: WRITE }),
    reset: operation(OP.CHANGES_RESET, {
      capability: WRITE,
      approval: args => ({ message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?` })
    }),
    tidy_plan: operation(OP.CHANGES_TIDY_PLAN, { capability: READ }),
    tidy_run: operation(OP.CHANGES_TIDY_RUN, { capability: WRITE })
  }),
  relai_publish: Object.freeze({
    commit: operation(OP.PUBLISH_COMMIT, {
      capability: WRITE,
      approval: args => (args.addAll === true || args.sensitiveAuthorization
        ? { message: `Create the requested Git commit${args.addAll ? ' including all current changes' : ''}?` }
        : null)
    }),
    push: operation(OP.PUBLISH_PUSH, {
      capability: PUBLISH,
      approval: args => ({ message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?` })
    }),
    draft_pr: operation(OP.PUBLISH_DRAFT_PR, { capability: READ })
  })
});

/** @param {Record<string, any>} [value] */
function contract(value = {}) {
  const parsed = PUBLIC_CONTRACT_SCHEMA.parse(value);
  return Object.freeze({
    required: Object.freeze([...parsed.required]),
    omit: Object.freeze([...parsed.omit]),
    extra: Object.freeze({ ...parsed.extra })
  });
}

/** @param {string} operationName @param {Record<string, any>} [options] */
function operation(operationName, options = {}) {
  return Object.freeze({
    operationName,
    keepAction: options.keepAction === true,
    capability: String(options.capability || ''),
    approval: typeof options.approval === 'function' ? options.approval : null,
    publicContract: options.publicContract || null
  });
}

function isToolSurfaceSourcePath(value) {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  return TOOL_SURFACE_SOURCE_SET.has(normalized);
}

export { ACTION_REGISTRY, isToolSurfaceSourcePath };
