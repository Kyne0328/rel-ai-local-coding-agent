// @ts-check

import {
  getCatalogToolDefinition,
  getCatalogToolDefinitions,
  getOperationDefinition,
  getOperationDefinitions
} from './actionDefinitions.js';
import { schemaFromDefinition } from './schemaBuilder.js';

const TOOL_SURFACE_VERSION = 36;
const ACTION_OPERATIONS = Object.freeze({
  relai_work: Object.freeze({
    begin: operation('relai_begin_work'),
    status: operation('relai_status'),
    finish: operation('relai_finish_work'),
    cancel: operation('relai_cancel_work')
  }),
  relai_snapshot: Object.freeze({ default: operation('relai_repo_snapshot') }),
  relai_read: Object.freeze({ default: operation('relai_read') }),
  relai_search: Object.freeze({
    text: operation('relai_search'),
    semantic: operation('relai_semantic_search')
  }),
  relai_inspect: Object.freeze({
    symbol: operation('relai_code_inspect', true),
    references: operation('relai_code_inspect', true),
    related: operation('relai_code_inspect', true),
    impact: operation('relai_code_inspect', true),
    trace: operation('relai_code_inspect', true),
    diagnostics: operation('relai_code_inspect', true),
    architecture: operation('relai_code_inspect', true)
  }),
  relai_edit: Object.freeze({ default: operation('relai_edit') }),
  relai_exec: Object.freeze({ default: operation('relai_exec') }),
  relai_process: Object.freeze({
    start: operation('relai_process_start'),
    read: operation('relai_process_read'),
    write: operation('relai_process_write'),
    stop: operation('relai_process_stop'),
    list: operation('relai_process_list')
  }),
  relai_worktree: Object.freeze({
    create: operation('relai_worktree_create'),
    list: operation('relai_worktree_list'),
    remove: operation('relai_worktree_remove')
  }),
  relai_validate: Object.freeze({
    checks: operation('relai_run_checks'),
    diagnostics: operation('relai_diagnostics_run'),
    http: operation('relai_http_probe')
  }),
  relai_changes: Object.freeze({
    diff: operation('relai_diff'),
    restore: operation('relai_restore_paths'),
    reset: operation('relai_reset_workspace'),
    tidy_plan: operation('relai_tidy_plan'),
    tidy_run: operation('relai_tidy_run')
  }),
  relai_publish: Object.freeze({
    commit: operation('relai_git_commit'),
    push: operation('relai_git_push'),
    draft_pr: operation('relai_git_draft_pr')
  })
});

const OPERATION_CAPABILITIES = Object.freeze({
  relai_begin_work: 'repository:read',
  relai_repo_snapshot: 'repository:read',
  relai_read: 'repository:read',
  relai_search: 'repository:read',
  relai_code_inspect: 'repository:read',
  relai_semantic_search: 'repository:read',
  relai_process_read: 'repository:read',
  relai_process_list: 'repository:read',
  relai_worktree_list: 'repository:read',
  relai_tidy_plan: 'repository:read',
  relai_http_probe: 'repository:read',
  relai_diff: 'repository:read',
  relai_status: 'repository:read',
  relai_git_draft_pr: 'repository:read',
  relai_cancel_work: 'repository:read',
  relai_finish_work: 'repository:read',
  relai_edit: 'repository:write',
  relai_restore_paths: 'repository:write',
  relai_reset_workspace: 'repository:write',
  relai_tidy_run: 'repository:write',
  relai_worktree_create: 'repository:write',
  relai_worktree_remove: 'repository:write',
  relai_git_commit: 'repository:write',
  relai_exec: 'command:execute',
  relai_diagnostics_run: 'command:execute',
  relai_run_checks: 'command:execute',
  relai_process_start: 'process:manage',
  relai_process_write: 'process:manage',
  relai_process_stop: 'process:manage',
  relai_git_push: 'git:publish'
});

const APPROVAL_POLICIES = Object.freeze({
  relai_reset_workspace: args => ({
    message: `Discard workspace changes using ${args.removeUntracked ? 'RESET_AND_CLEAN' : 'RESET'}?`
  }),
  relai_worktree_remove: args => ({
    message: `Remove managed worktree ${args.alias || ''}${args.force ? ' with force' : ''}? The Git branch will be preserved.`
  }),
  relai_git_push: args => ({
    message: `Publish branch ${args.branch || '(current branch)'} to ${args.remote || 'origin'}?`
  }),
  relai_git_commit: args => (args.addAll === true || args.sensitiveAuthorization
    ? { message: `Create the requested Git commit${args.addAll ? ' including all current changes' : ''}?` }
    : null)
});

const TOOL_ACTION_CATALOG = Object.freeze(buildCatalog());
const ACTION_BY_KEY = new Map(TOOL_ACTION_CATALOG.map(entry => [catalogKey(entry.publicTool, entry.action), entry]));
const TOOL_CATALOG = Object.freeze(getCatalogToolDefinitions().map(definition => Object.freeze({
  definition,
  actions: Object.freeze(TOOL_ACTION_CATALOG.filter(entry => entry.publicTool === definition.name))
})));

function buildCatalog() {
  const entries = [];
  for (const [publicTool, actions] of Object.entries(ACTION_OPERATIONS)) {
    const publicDefinition = getCatalogToolDefinition(publicTool);
    if (!publicDefinition) throw new Error(`Catalog references unknown public tool '${publicTool}'.`);
    for (const [action, mapping] of Object.entries(actions)) {
      const operationMetadata = getOperationDefinition(mapping.operationName);
      if (!operationMetadata) {
        throw new Error(`Catalog action ${publicTool}:${action} references unknown operation '${mapping.operationName}'.`);
      }
      const contract = actionContract(publicDefinition, action, operationMetadata);
      const capability = OPERATION_CAPABILITIES[mapping.operationName];
      if (!capability) throw new Error(`Catalog operation '${mapping.operationName}' has no authorization capability.`);
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
        approval: APPROVAL_POLICIES[mapping.operationName] || null,
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

function operation(operationName, keepAction = false) {
  return Object.freeze({ operationName, keepAction });
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
  const actions = ACTION_OPERATIONS[String(publicTool || '')];
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
  const allowed = new Set([...Object.keys(entry.inputSchema?.properties || {}), 'work_id', '_operationTaskId']);
  const unsupported = Object.keys(args).filter(field => !allowed.has(field));
  if (unsupported.length) throw new Error(`Unsupported field '${unsupported[0]}' for ${publicName} action ${action}.`);
  if (entry.operationName === 'relai_begin_work' && Object.hasOwn(args, 'work_id')) {
    throw new Error(`Unsupported field 'work_id' for ${publicName} action ${action}.`);
  }
  const taskScoped = entry.behavior?.taskScope === 'required';
  const required = (entry.inputSchema?.required || []).filter(field => !(taskScoped && field === 'workspace'));
  for (const field of required) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      throw new Error(`Missing required field '${field}' for ${publicName} action ${action}.`);
    }
  }
  return args;
}

function getOperationCapability(operationName) {
  return OPERATION_CAPABILITIES[String(operationName || '')] || '';
}

/** @param {string} publicTool @param {Record<string, any>} args */
function catalogApprovalRequirement(publicTool, args = {}) {
  const resolution = resolveToolOperation(publicTool, args);
  if (!resolution?.catalogEntry?.approval) return null;
  return resolution.catalogEntry.approval(resolution.operationArgs);
}

export {
  ACTION_OPERATIONS,

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
