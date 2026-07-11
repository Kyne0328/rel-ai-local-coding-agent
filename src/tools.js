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
const { beginConnectorToolCall } = require('./toolActivity');
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
  try {
    if (!isToolCallable(name)) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${TOOL_NAMES.join(', ')}. Restart/reconnect ChatGPT if the tool list looks stale.`);
    }
    if (connector) {
      finishActivity = beginConnectorToolCall({ tool: name, workspace: args?.workspace });
    }
    maybeStartSession(config, name, args || {});
    const value = await dispatchTool(config, name, args || {});
    const extraAudit = buildExtraAudit(name, value, args || {});
    applyCautionAudit(extraAudit, name, args || {}, value, config);
    invalidateSessionCacheForCall(config, name, args || {});
    logAudit(config, { tool: name, ok: true, workspace: args?.workspace, ms: Date.now() - started, ...extraAudit });
    return ok(connector ? compactForConnector(name, value, args || {}) : value);
  } catch (error) {
    const enhanced = enhanceToolError(name, error);
    activityResult = { ok: false, error: enhanced.message };
    logAudit(config, { tool: name, ok: false, workspace: args?.workspace, ms: Date.now() - started, error: enhanced.message });
    throw enhanced;
  } finally {
    finishActivity?.(activityResult);
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
