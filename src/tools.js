const { readConfig } = require('./config');
const { logAudit } = require('./audit');
const {
  toolSchemas,
  getToolSchemas,
  getToolMetadata,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  isToolCallable,
  TOOL_NAMES
} = require('./tools/schema');
const { compactForConnector, policySentence } = require('./tools/connector');
const { enhanceToolError } = require('./tools/errors');
const {
  buildExtraAudit,
  applyCautionAudit,
  invalidateSessionCacheForCall,
  maybeStartSession
} = require('./tools/session');
const { dispatchTool } = require('./tools/dispatch');
const { beginConnectorToolCall, runWithToolActivity } = require('./toolActivity');
const { runWorkspaceOperation } = require('./workspaceOperationQueue');
const { clearSessionPolicy } = require('./policyResolver');
const {
  workspaceList,
  workspaceInspect,
  workspaceTree,
  workspaceProfile
} = require('./tools/status');

async function callTool(name, args = {}, context = {}) {
  const config = readConfig();
  const started = Date.now();
  const connector = Boolean(context?.publicHttpOnly);
  let finishActivity = null;
  let activityResult = { ok: true };
  let sessionStart = { started: false, alias: '' };
  try {
    if (!isToolCallable(name)) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${TOOL_NAMES.join(', ')}. Restart/reconnect ChatGPT if the tool list looks stale.`);
    }
    finishActivity = beginConnectorToolCall({
      tool: name,
      workspace: args?.workspace,
      scopeId: context?.taskScopeId || (connector ? '' : 'local:default'),
      connector,
      operation: describeToolOperation(name, args || {})
    });
    const value = await runWithToolActivity(finishActivity, () => runWorkspaceOperation(args?.workspace, () => {
      sessionStart = maybeStartSession(config, name, args || {}, { taskId: finishActivity?.taskId });
      return dispatchTool(config, name, args || {}, { connector });
    }));
    const valueOk = value?.ok !== false;
    activityResult = {
      ok: valueOk,
      ...(valueOk ? {} : { error: String(value?.error || value?.message || `${name} returned ok:false`) })
    };
    if (sessionStart.started && !hasWorkspaceChanges(value)) clearSessionPolicy(config, sessionStart.alias);
    const extraAudit = buildExtraAudit(name, value, args || {});
    applyCautionAudit(extraAudit, name, args || {}, value, config);
    invalidateSessionCacheForCall(config, name, args || {});
    logAudit(config, { taskId: finishActivity?.taskId, tool: name, operation: finishActivity?.operation, ok: valueOk, workspace: args?.workspace, ms: Date.now() - started, ...extraAudit, ...(valueOk ? {} : { error: activityResult.error }) });
    return ok(connector ? compactForConnector(name, value, args || {}) : value);
  } catch (error) {
    const enhanced = enhanceToolError(name, error);
    activityResult = { ok: false, error: enhanced.message };
    logAudit(config, { taskId: finishActivity?.taskId, tool: name, operation: finishActivity?.operation, ok: false, workspace: args?.workspace, ms: Date.now() - started, error: enhanced.message });
    throw enhanced;
  } finally {
    finishActivity?.(activityResult);
  }
}

function hasWorkspaceChanges(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.changed === true) return true;
  if (Array.isArray(value.changedFiles) && value.changedFiles.length > 0) return true;
  if (Array.isArray(value.statusAfter?.sessionChangedFiles) && value.statusAfter.sessionChangedFiles.length > 0) return true;
  return false;
}

function describeToolOperation(name, args = {}) {
  const workspace = String(args.workspace || '').trim();
  const path = String(args.path || '').trim();
  const suffix = workspace ? ` in ${workspace}` : '';
  switch (name) {
    case 'relai_repo_snapshot': return `Scanning the repository${suffix}`;
    case 'relai_read': {
      const paths = Array.isArray(args.paths) ? args.paths.filter(Boolean) : [];
      if (paths.length === 1) return `Reading ${paths[0]}${suffix}`;
      return `Reading ${paths.length || 'workspace'} paths${suffix}`;
    }
    case 'relai_search': return `Searching for ${String(args.pattern || '').slice(0, 60) || 'a pattern'}${suffix}`;
    case 'relai_write': return path ? `Writing ${path}${suffix}` : `Writing a workspace file${suffix}`;
    case 'relai_replace': return path ? `Editing ${path}${suffix}` : `Applying an exact edit${suffix}`;
    case 'relai_edit': {
      if (path) return `Editing ${path}${suffix}`;
      if (Array.isArray(args.edits)) return `Applying ${args.edits.length} file edits${suffix}`;
      if (args.updateText) return `Applying a workspace patch${suffix}`;
      return `Editing the workspace${suffix}`;
    }
    case 'relai_tidy_plan': return `Reviewing generated artifacts${suffix}`;
    case 'relai_tidy_run': return `Removing approved generated artifacts${suffix}`;
    case 'relai_run_checks': return `Running ${String(args.level || 'standard')} validation${suffix}`;
    case 'relai_browser': return args.check ? `Running UI check ${args.check}${suffix}` : `Checking route ${args.route || '/'}${suffix}`;
    case 'relai_diff': return `Reviewing repository changes${suffix}`;
    case 'relai_restore_changes': return `Restoring workspace changes${suffix}`;
    case 'relai_git_status': return `Reading Git status${suffix}`;
    case 'relai_git_commit': return `Creating a Git commit${suffix}`;
    case 'relai_git_push': return `Publishing the current branch${suffix}`;
    case 'relai_git_create_pr': return `Drafting a pull request${suffix}`;
    case 'relai_status': return workspace ? `Reading Rel.AI status for ${workspace}` : 'Reading Rel.AI status';
    case 'relai_complete_task': return `Reporting task completion${suffix}`;
    default: return `Running ${String(name || 'Rel.AI tool').replace(/^relai_/, '').replaceAll('_', ' ')}`;
  }
}

function ok(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'ok')
    ? value
    : { ok: true, ...value };
}

module.exports = {
  toolSchemas,
  getToolSchemas,
  getToolMetadata,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  TOOL_NAMES,
  callTool,
  workspaceList,
  workspaceInspect,
  workspaceTree,
  workspaceProfile,
  enhanceToolError,
  compactForConnector,
  policySentence
};
