// @ts-check

import {
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getOperationDefinition,
  getOperationDefinitions
} from './actionDefinitions.js';
import { schemaFromDefinition } from './schemaBuilder.js';

const TOOL_SURFACE_VERSION = 42;
const READ = 'repository:read';
const WRITE = 'repository:write';
const EXECUTE = 'command:execute';
const PROCESS = 'process:manage';
const PUBLISH = 'git:publish';

// This registry is the single owner of every public action's executable operation,
// authorization capability, approval rule, and action-shape behavior. Everything
// else in this module is derived from these entries plus the canonical operation
// definitions, so an action cannot silently drift from its runtime policy.
const ACTION_REGISTRY = Object.freeze({
  relai_work: Object.freeze({
    begin: operation('relai_begin_work', { capability: READ }),
    status: operation('relai_status', { capability: READ }),
    finish: operation('relai_finish_work', { capability: READ }),
    cancel: operation('relai_cancel_work', { capability: READ })
  }),
  relai_snapshot: Object.freeze({ default: operation('relai_repo_snapshot', { capability: READ }) }),
  relai_read: Object.freeze({ default: operation('relai_read', { capability: READ }) }),
  relai_search: Object.freeze({
    text: operation('relai_search', { capability: READ }),
    semantic: operation('relai_semantic_search', { capability: READ })
  }),
  relai_inspect: Object.freeze({
    symbol: operation('relai_code_inspect', { capability: READ, keepAction: true }),
    references: operation('relai_code_inspect', { capability: READ, keepAction: true }),
    related: operation('relai_code_inspect', { capability: READ, keepAction: true }),
    impact: operation('relai_code_inspect', { capability: READ, keepAction: true }),
    trace: operation('relai_code_inspect', { capability: READ, keepAction: true }),
    diagnostics: operation('relai_code_inspect', { capability: READ, keepAction: true }),
    architecture: operation('relai_code_inspect', { capability: READ, keepAction: true })
  }),
  relai_edit: Object.freeze({ default: operation('relai_edit', { capability: WRITE }) }),
  relai_exec: Object.freeze({ default: operation('relai_exec', { capability: EXECUTE }) }),
  relai_process: Object.freeze({
    start: operation('relai_process_start', { capability: PROCESS }),
    read: operation('relai_process_read', { capability: READ }),
    write: operation('relai_process_write', { capability: PROCESS }),
    stop: operation('relai_process_stop', { capability: PROCESS }),
    list: operation('relai_process_list', { capability: READ })
  }),
  relai_ui: Object.freeze({
    start: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    navigate: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    snapshot: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    interact: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    screenshot: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    console: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    network: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    viewport: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    reload: operation('relai_ui', { capability: PROCESS, keepAction: true }),
    stop: operation('relai_ui', { capability: PROCESS, keepAction: true })
  }),
  relai_validate: Object.freeze({
    checks: operation('relai_run_checks', { capability: EXECUTE }),
    diagnostics: operation('relai_diagnostics_run', { capability: EXECUTE }),
    http: operation('relai_http_probe', { capability: READ })
  }),
  relai_changes: Object.freeze({
    diff: operation('relai_diff', { capability: READ }),
    restore: operation('relai_restore_paths', { capability: WRITE }),
    reset: operation('relai_reset_workspace', {
      capability: WRITE,
      approval: args => ({ message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?` })
    }),
    tidy_plan: operation('relai_tidy_plan', { capability: READ }),
    tidy_run: operation('relai_tidy_run', { capability: WRITE })
  }),
  relai_publish: Object.freeze({
    commit: operation('relai_git_commit', {
      capability: WRITE,
      approval: args => (args.addAll === true || args.sensitiveAuthorization
        ? { message: `Create the requested Git commit${args.addAll ? ' including all current changes' : ''}?` }
        : null)
    }),
    push: operation('relai_git_push', {
      capability: PUBLISH,
      approval: args => ({ message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?` })
    }),
    draft_pr: operation('relai_git_draft_pr', { capability: READ })
  })
});

const TOOL_ACTION_CATALOG = Object.freeze(buildCatalog());
const ACTION_BY_KEY = new Map(TOOL_ACTION_CATALOG.map(entry => [catalogKey(entry.publicTool, entry.action), entry]));
const TOOL_CATALOG = Object.freeze(getCatalogToolDefinitions().map(definition => Object.freeze({
  definition,
  actions: Object.freeze(TOOL_ACTION_CATALOG.filter(entry => entry.publicTool === definition.name))
})));

function buildCatalog() {
  const entries = [];
  for (const [publicTool, actions] of Object.entries(ACTION_REGISTRY)) {
    const publicDefinition = getCatalogToolDefinition(publicTool);
    if (!publicDefinition) throw new Error(`Catalog references unknown public tool '${publicTool}'.`);
    for (const [action, mapping] of Object.entries(actions)) {
      const operationMetadata = getOperationDefinition(mapping.operationName);
      if (!operationMetadata) {
        throw new Error(`Catalog action ${publicTool}:${action} references unknown operation '${mapping.operationName}'.`);
      }
      const contract = actionContract(publicDefinition, action, operationMetadata);
      const capability = mapping.capability;
      if (!capability) throw new Error(`Catalog action ${publicTool}:${action} has no authorization capability.`);
      entries.push(Object.freeze({
        publicTool,
        action,
        operationName: mapping.operationName,
        keepAction: mapping.keepAction,
        title: operationMetadata.title,
        description: operationMetadata.description,
        fields: contract.fields,
        required: contract.required,
        inputSchema: operationMetadata.inputSchema,
        outputSchema: operationMetadata.outputSchema,
        annotations: operationMetadata.annotations,
        behavior: operationMetadata.behavior,
        execution: operationMetadata.execution,
        dashboard: operationMetadata.dashboard,
        groups: operationMetadata.groups,
        capability,
        approval: mapping.approval || null,
        handlerName: operationMetadata.handlerName
      }));
    }
  }
  return entries;
}

function actionContract(publicDefinition, action, operationMetadata) {
  if (action === 'default') {
    const schema = schemaFromDefinition(publicDefinition).inputSchema;
    return Object.freeze({
      fields: Object.freeze(Object.keys(schema.properties || {}).filter(field => field !== 'action').sort()),
      required: Object.freeze([...(schema.required || [])].filter(field => field !== 'action').sort())
    });
  }
  const contract = publicDefinition.actionContracts?.find(item => item.action === action);
  if (!contract) throw new Error(`Catalog action ${publicDefinition.name}:${action} has no public action contract.`);
  const required = [...contract.required];
  if (operationMetadata.behavior?.taskScope === 'required' && !required.includes('work_id')) required.push('work_id');
  return Object.freeze({
    fields: Object.freeze([...contract.fields]),
    required: Object.freeze(required.sort())
  });
}

function operation(operationName, options = {}) {
  return Object.freeze({
    operationName,
    keepAction: options.keepAction === true,
    capability: String(options.capability || ''),
    approval: typeof options.approval === 'function' ? options.approval : null
  });
}

function catalogKey(publicTool, action) {
  return `${publicTool}:${action || 'default'}`;
}

function getToolActionCatalog() {
  return TOOL_ACTION_CATALOG;
}

function getCatalogTools() {
  return TOOL_CATALOG;
}


/** @param {string} publicTool @param {Record<string, any>} args */
function getCatalogAction(publicTool, args = {}) {
  const actions = ACTION_REGISTRY[String(publicTool || '')];
  if (!actions) return null;
  const action = Object.hasOwn(actions, 'default') ? 'default' : String(args.action || '').trim();
  const entry = ACTION_BY_KEY.get(catalogKey(publicTool, action));
  if (!entry) {
    const choices = Object.keys(actions).filter(value => value !== 'default');
    throw new Error(`Unsupported action '${action || '(missing)'}' for ${publicTool}. Supported actions: ${choices.join(', ')}.`);
  }
  return entry;
}

/** @param {string} name @param {Record<string, any>} args */
function resolveToolOperation(name, args = {}) {
  const publicName = String(name || '');
  const entry = getCatalogAction(publicName, args);
  if (!entry) return null;
  let operationArgs = { ...(args || {}) };
  if (!entry.keepAction) delete operationArgs.action;
  operationArgs = normalizeOperationArguments(publicName, entry.action, entry, operationArgs);
  return {
    publicName,
    action: entry.action === 'default' ? '' : entry.action,
    operationName: entry.operationName,
    operationArgs,
    definition: getOperationDefinition(entry.operationName),
    catalogEntry: entry,
    compact: true
  };
}

function normalizeOperationArguments(publicName, action, entry, args) {
  const allowed = new Set([...(entry.fields || []), '_operationTaskId']);
  if (entry.keepAction) allowed.add('action');
  const unsupported = Object.keys(args).filter(field => !allowed.has(field));
  if (unsupported.length) {
    const publicDefinition = getCatalogToolDefinition(publicName);
    const publicFields = new Set([
      ...Object.keys(schemaFromDefinition(publicDefinition).inputSchema?.properties || {}),
      '_operationTaskId'
    ]);
    const unknown = unsupported.filter(field => !publicFields.has(field));
    if (unknown.length) throw new Error(`Unsupported field '${unknown[0]}' for ${publicName} action ${action}.`);
    for (const field of unsupported) delete args[field];
  }
  for (const field of entry.required || []) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      throw new Error(`Missing required field '${field}' for ${publicName} action ${action}.`);
    }
  }
  return args;
}

function getOperationCapability(operationName) {
  const name = String(operationName || '');
  const entries = TOOL_ACTION_CATALOG.filter(entry => entry.operationName === name);
  if (!entries.length) return '';
  const capabilities = new Set(entries.map(entry => entry.capability));
  if (capabilities.size !== 1) throw new Error(`Operation '${name}' has conflicting action capabilities.`);
  return entries[0].capability;
}

/** @param {string} publicTool @param {Record<string, any>} args */
function catalogApprovalRequirement(publicTool, args = {}) {
  const resolution = resolveToolOperation(publicTool, args);
  if (!resolution?.catalogEntry?.approval) return null;
  return resolution.catalogEntry.approval(resolution.operationArgs);
}

export {
  ACTION_REGISTRY,

  TOOL_SURFACE_VERSION,
  catalogApprovalRequirement,
  getCatalogAction,
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getCatalogTools,
  getOperationCapability,
  getOperationDefinition,
  getOperationDefinitions,
  getToolActionCatalog,
  resolveToolOperation
};
