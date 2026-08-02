import { getToolDefinition as getLegacyToolDefinition } from './registry.js';

const COMPACT_TOOL_NAMES = Object.freeze([
  'relai_work',
  'relai_snapshot',
  'relai_read',
  'relai_search',
  'relai_inspect',
  'relai_edit',
  'relai_exec',
  'relai_process',
  'relai_worktree',
  'relai_validate',
  'relai_changes',
  'relai_publish'
]);

const COMPACT_OPERATIONS = Object.freeze({
  relai_work: Object.freeze({
    begin: Object.freeze({ tool: 'relai_begin_work' }),
    status: Object.freeze({ tool: 'relai_status' }),
    finish: Object.freeze({ tool: 'relai_finish_work' }),
    cancel: Object.freeze({ tool: 'relai_cancel_work' })
  }),
  relai_snapshot: Object.freeze({ default: Object.freeze({ tool: 'relai_repo_snapshot' }) }),
  relai_read: Object.freeze({ default: Object.freeze({ tool: 'relai_read' }) }),
  relai_search: Object.freeze({
    text: Object.freeze({ tool: 'relai_search' }),
    semantic: Object.freeze({ tool: 'relai_semantic_search' })
  }),
  relai_inspect: Object.freeze({
    symbol: Object.freeze({ tool: 'relai_code_inspect', keepAction: true }),
    references: Object.freeze({ tool: 'relai_code_inspect', keepAction: true }),
    related: Object.freeze({ tool: 'relai_code_inspect', keepAction: true }),
    impact: Object.freeze({ tool: 'relai_code_inspect', keepAction: true }),
    trace: Object.freeze({ tool: 'relai_code_inspect', keepAction: true }),
    diagnostics: Object.freeze({ tool: 'relai_code_inspect', keepAction: true })
  }),
  relai_edit: Object.freeze({ default: Object.freeze({ tool: 'relai_edit' }) }),
  relai_exec: Object.freeze({ default: Object.freeze({ tool: 'relai_exec' }) }),
  relai_process: Object.freeze({
    start: Object.freeze({ tool: 'relai_process_start' }),
    read: Object.freeze({ tool: 'relai_process_read' }),
    write: Object.freeze({ tool: 'relai_process_write' }),
    stop: Object.freeze({ tool: 'relai_process_stop' }),
    list: Object.freeze({ tool: 'relai_process_list' })
  }),
  relai_worktree: Object.freeze({
    create: Object.freeze({ tool: 'relai_worktree_create' }),
    list: Object.freeze({ tool: 'relai_worktree_list' }),
    remove: Object.freeze({ tool: 'relai_worktree_remove' })
  }),
  relai_validate: Object.freeze({
    checks: Object.freeze({ tool: 'relai_run_checks' }),
    diagnostics: Object.freeze({ tool: 'relai_diagnostics_run' }),
    http: Object.freeze({ tool: 'relai_http_probe' })
  }),
  relai_changes: Object.freeze({
    diff: Object.freeze({ tool: 'relai_diff' }),
    restore: Object.freeze({ tool: 'relai_restore_paths' }),
    reset: Object.freeze({ tool: 'relai_reset_workspace' }),
    tidy_plan: Object.freeze({ tool: 'relai_tidy_plan' }),
    tidy_run: Object.freeze({ tool: 'relai_tidy_run' })
  }),
  relai_publish: Object.freeze({
    commit: Object.freeze({ tool: 'relai_git_commit' }),
    push: Object.freeze({ tool: 'relai_git_push' }),
    draft_pr: Object.freeze({ tool: 'relai_git_draft_pr' })
  })
});

const LEGACY_TO_COMPACT = Object.freeze(buildLegacyMigrationMap());

function resolveToolOperation(name, args = {}) {
  const publicName = String(name || '');
  const compact = COMPACT_OPERATIONS[publicName];
  if (!compact) {
    const definition = getLegacyToolDefinition(publicName);
    return definition ? { publicName, operationName: publicName, operationArgs: args || {}, definition, compact: false } : null;
  }

  const action = Object.hasOwn(compact, 'default') ? 'default' : String(args.action || '').trim();
  const operation = compact[action];
  if (!operation) {
    const choices = Object.keys(compact).filter(value => value !== 'default');
    throw new Error(`Unsupported action '${action || '(missing)'}' for ${publicName}. Supported actions: ${choices.join(', ')}.`);
  }
  const definition = getLegacyToolDefinition(operation.tool);
  if (!definition) throw new Error(`Compact operation ${publicName}:${action} targets unknown internal tool '${operation.tool}'.`);
  let operationArgs = { ...(args || {}) };
  if (!operation.keepAction) delete operationArgs.action;
  operationArgs = normalizeCompactOperationArguments(publicName, action, definition, operationArgs);
  return {
    publicName,
    action: action === 'default' ? '' : action,
    operationName: operation.tool,
    operationArgs,
    definition,
    compact: true
  };
}

function normalizeCompactOperationArguments(publicName, action, definition, args) {
  const allowed = new Set([...Object.keys(definition.inputSchema?.properties || {}), 'work_id', '_operationTaskId']);
  const unsupported = Object.keys(args).filter(field => !allowed.has(field));
  const unionFields = new Set(['work_id']);
  for (const operation of Object.values(COMPACT_OPERATIONS[publicName] || {})) {
    const operationDefinition = getLegacyToolDefinition(operation.tool);
    for (const field of Object.keys(operationDefinition?.inputSchema?.properties || {})) unionFields.add(field);
  }
  for (const field of unsupported) {
    if (!unionFields.has(field)) throw new Error(`Unsupported field '${field}' for ${publicName} action ${action}.`);
    delete args[field];
  }
  if (definition.name === 'relai_begin_work') delete args.work_id;
  const taskScoped = definition.behavior?.taskScope === 'required';
  const required = (definition.inputSchema?.required || []).filter(field => !(taskScoped && field === 'workspace'));
  for (const field of required) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      throw new Error(`Missing required field '${field}' for ${publicName} action ${action}.`);
    }
  }
  return args;
}

function buildLegacyMigrationMap() {
  const mapping = {};
  for (const [compactTool, actions] of Object.entries(COMPACT_OPERATIONS)) {
    for (const [action, operation] of Object.entries(actions)) {
      mapping[operation.tool] = Object.freeze({
        tool: compactTool,
        ...(action === 'default' ? {} : { action })
      });
    }
  }
  return mapping;
}

export {
  COMPACT_OPERATIONS,
  COMPACT_TOOL_NAMES,
  LEGACY_TO_COMPACT,
  resolveToolOperation
};
