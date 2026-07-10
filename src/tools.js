const { readConfig } = require("./config");
const { logAudit } = require("./audit");
const {
  toolSchemas,
  allToolSchemas,
  getToolSchemas,
  getPublicToolSchemas,
  getPublicToolMetadata,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  isToolCallable,
  BRIDGE_TOOL_NAMES,
  PUBLIC_HTTP_TOOL_NAMES
} = require("./tools/schema");
const { compactForConnector, policySentence } = require("./tools/connector");
const { enhanceToolError } = require("./tools/errors");
const {
  buildExtraAudit,
  applyCautionAudit,
  invalidateSessionCacheForCall,
  maybeStartSession
} = require("./tools/session");
const { dispatchTool } = require("./tools/dispatch");
const {
  workspaceList,
  workspaceInspect,
  workspaceTree,
  workspaceProfile,
  buildSessionSummary
} = require("./tools/status");

async function callTool(name, args = {}, context = {}) {
  const config = readConfig();
  const started = Date.now();
  const canonicalName = name;
  const connector = Boolean(context?.publicHttpOnly);
  try {
    if (!isToolCallable(name)) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${BRIDGE_TOOL_NAMES.join(", ")}. Restart/reconnect ChatGPT if the tool list looks stale.`);
    }
    maybeStartSession(config, canonicalName, args || {});
    const value = await dispatchTool(config, canonicalName, args || {});
    const extraAudit = buildExtraAudit(canonicalName, value, args || {});
    applyCautionAudit(extraAudit, canonicalName, args || {}, value, config);
    invalidateSessionCacheForCall(config, canonicalName, args || {});
    logAudit(config, { tool: canonicalName, ok: true, workspace: args?.workspace, ms: Date.now() - started, ...extraAudit });
    // The full stdio surface keeps every field (tests and local tooling read them).
    // The ChatGPT connector gets a compacted result: internal telemetry, always-
    // default policy objects, and duplicated/verbose fields are dropped so the model
    // spends its context on state it can act on, not implementation leakage.
    return ok(connector ? compactForConnector(canonicalName, value, args || {}) : value);
  } catch (error) {
    const enhanced = enhanceToolError(canonicalName, error);
    logAudit(config, { tool: canonicalName, ok: false, workspace: args?.workspace, ms: Date.now() - started, error: enhanced.message });
    throw enhanced;
  }
}

function ok(value) {
  return value && typeof value === "object" && Object.hasOwn(value, "ok")
    ? value
    : { ok: true, ...value };
}

module.exports = {
  toolSchemas,
  allToolSchemas,
  getToolSchemas,
  getPublicToolSchemas,
  getPublicToolMetadata,
  getToolDefinition,
  getToolDefinitions,
  getToolGroups,
  BRIDGE_TOOL_NAMES,
  PUBLIC_HTTP_TOOL_NAMES,
  callTool,
  workspaceList,
  workspaceInspect,
  workspaceTree,
  workspaceProfile,
  buildSessionSummary,
  enhanceToolError,
  compactForConnector,
  policySentence
};
