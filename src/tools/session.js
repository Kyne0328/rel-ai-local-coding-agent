// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolArgs} ToolArgs */
/** @typedef {import('../../types/boundaries').ToolResult} ToolResult */
/** @typedef {(extra: Record<string, unknown>, value: ToolResult, args: ToolArgs) => void} AuditEnricher */

const sessionCache = require("../sessionCache");
const { classifyCaution } = require("../cautionZone");
const { resolveWorkspace } = require("../config");
const { resolveSafePath } = require("../safety");
const { ensureSessionStarted } = require("../policyResolver");
const { getToolDefinition } = require("./schema");

function debugSwallow(context, error) {
  if (process.env.REL_AI_MCP_DEBUG) {
    console.error(`[rel-ai-mcp] best-effort '${context}' failed: ${error?.message || error}`);
  }
}

/** @type {Readonly<Record<string, AuditEnricher>>} */
const AUDIT_ENRICHERS = Object.freeze({
  edit: enrichEditAudit,
  checks: enrichChecksAudit,
  completion: enrichCompletionAudit,
  path: enrichPathAudit,
  read: enrichReadAudit,
  snapshot: enrichSnapshotAudit
});

/** @param {string} name @param {ToolResult} value @param {ToolArgs} args @returns {Record<string, unknown>} */
function buildExtraAudit(name, value, args) {
  /** @type {Record<string, unknown>} */
  const extra = {};
  const auditKind = getToolDefinition(name)?.behavior?.audit || "";
  AUDIT_ENRICHERS[auditKind]?.(extra, value, args);
  enrichCommonAudit(extra, name, value);
  return extra;
}

function enrichCommonAudit(extra, name, value) {
  const changedFiles = Array.isArray(value?.changedFiles)
    ? value.changedFiles
    : Array.isArray(value?.statusAfter?.sessionChangedFiles)
      ? value.statusAfter.sessionChangedFiles
      : [];
  if (changedFiles.length) extra.changedFiles = changedFiles.slice(0, 200);
  assignTruthy(extra, "validationStatus", value?.validationStatus);
  if (name === "relai_git_commit" && value?.ok !== false) extra.commitCreated = true;
  if (name === "relai_git_push" && value?.ok !== false) extra.pushPublished = true;
  if (name === "relai_git_create_pr" && value?.ok !== false) extra.prDrafted = true;
}

function enrichEditAudit(extra, value, args) {
  assignTruthy(extra, "plannerPath", value?.plannerPath);
  assignTruthy(extra, "plannerReason", value?.plannerReason);
  addAuditPath(extra, args?.path);
}

function enrichChecksAudit(extra, value) {
  assignTruthy(extra, "validationLevel", value?.validationLevel);
  assignTruthy(extra, "validationLevelReason", value?.validationLevelReason);
  assignDefined(extra, "aliasNormalizations", value?.aliasNormalizations);
  if (value?.policy) extra.policySessionActive = value.policy.sessionActive;
}

function enrichCompletionAudit(extra, value) {
  assignDefined(extra, "completionKnown", value?.completionKnown === true);
  assignTruthy(extra, "endReason", value?.endReason);
  assignTruthy(extra, "taskSummary", value?.summary);
  assignTruthy(extra, "validationAt", value?.validationAt);
}

function enrichPathAudit(extra, _value, args) {
  addAuditPath(extra, args?.path);
}

function enrichReadAudit(extra, value) {
  if (Array.isArray(value?.items)) extra.cacheHit = value.items.some((item) => item?.cacheHit === true);
}

function enrichSnapshotAudit(extra, value) {
  assignDefined(extra, "effectiveMaxIndexFiles", value?.effectiveMaxEntries);
  assignDefined(extra, "budgetMultiplied", value?.budgetMultiplied);
}

function assignTruthy(target, key, value) {
  if (value) target[key] = value;
}

function assignDefined(target, key, value) {
  if (value != null) target[key] = value;
}

function addAuditPath(extra, filePath) {
  if (filePath) extra.filePath = filePath;
}

function applyCautionAudit(extra, name, args, value, config) {
  try {
    const caution = classifyCaution(name, args);
    if (caution?.level === "caution") {
      extra.cautionLevel = caution.level;
      extra.cautionReason = caution.reason;
    }
  } catch (error) {
    debugSwallow("classify-caution", error);
  }
}

function invalidateSessionCacheForCall(config, name, args) {
  try {
    const alias = args?.workspace;
    if (!alias) return;
    const cacheMode = getToolDefinition(name)?.behavior?.cache || "";
    if (!cacheMode) return;
    const workspace = resolveWorkspace(config, alias);
    const wsRoot = workspace?.path;
    if (!wsRoot) return;
    if (cacheMode === "edit" && (args.updateText != null || args.stage != null)) {
      sessionCache.invalidateAlias(alias);
      return;
    }
    if (cacheMode === "paths" || cacheMode === "edit") {
      invalidatePaths(alias, wsRoot, collectTouchedPaths(args, cacheMode === "edit"));
      return;
    }
  } catch (error) {
    debugSwallow("cache-invalidate", error);
  }
}

function collectTouchedPaths(args, includeEdits) {
  const touched = [];
  if (args?.path) touched.push(args.path);
  if (includeEdits && Array.isArray(args?.edits)) {
    for (const edit of args.edits) if (edit?.path) touched.push(edit.path);
  }
  return touched;
}

function invalidatePaths(alias, wsRoot, paths) {
  for (const filePath of paths) {
    try {
      const safe = resolveSafePath(wsRoot, filePath);
      sessionCache.invalidatePath(alias, safe.absolutePath);
    } catch (error) {
      debugSwallow("resolve-safe-path", error);
    }
  }
}

function maybeStartSession(config, toolName, args, details = {}) {
  const behavior = getToolDefinition(toolName)?.behavior;
  if (behavior?.startsSession !== true || args?.dryRun === true) return { started: false, alias: '' };
  if (behavior.deferStagedSession === true && typeof args.stage === "string") {
    const stage = args.stage.trim().toLowerCase();
    if (stage === "start" || stage === "append" || stage === "abort") return { started: false, alias: '' };
  }
  const alias = args?.workspace;
  if (!alias) return { started: false, alias: '' };
  try {
    const workspace = resolveWorkspace(config, alias);
    const started = workspace?.path
      ? ensureSessionStarted(config, workspace.alias, workspace.path, { taskId: details.taskId })
      : false;
    return { started, alias: workspace.alias };
  } catch (error) {
    debugSwallow("start-session", error);
    return { started: false, alias: String(alias || '') };
  }
}

module.exports = {
  debugSwallow,
  buildExtraAudit,
  applyCautionAudit,
  invalidateSessionCacheForCall,
  maybeStartSession
};
