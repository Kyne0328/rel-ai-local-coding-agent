'use strict';

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

const AUDIT_ENRICHERS = Object.freeze({
  edit: enrichEditAudit,
  checks: enrichChecksAudit,
  policy: enrichPolicyAudit,
  path: enrichPathAudit,
  clearPaths: enrichClearPathsAudit,
  read: enrichReadAudit,
  snapshot: enrichSnapshotAudit
});

function buildExtraAudit(name, value, args) {
  const extra = {};
  const auditKind = getToolDefinition(name)?.behavior?.audit || "";
  AUDIT_ENRICHERS[auditKind]?.(extra, value, args);
  return extra;
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

function enrichPolicyAudit(extra, value) {
  assignTruthy(extra, "policyOperation", value?.operation);
  if (value?.policy) extra.policySessionActive = value.policy.sessionActive;
}

function enrichPathAudit(extra, _value, args) {
  addAuditPath(extra, args?.path);
}

function enrichClearPathsAudit(extra, _value, args) {
  addAuditPath(extra, args?.path);
  if (Array.isArray(args?.paths) && args.paths.length) extra.filePaths = args.paths;
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
    const caution = classifyCaution(name, args, value, config);
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
    if (cacheMode === "policy") {
      if (args.clear === true) sessionCache.invalidateAlias(alias);
      return;
    }

    const workspace = resolveWorkspace(config, alias);
    const wsRoot = workspace?.path;
    if (!wsRoot) return;
    if (cacheMode === "workspace") {
      sessionCache.invalidateAlias(alias);
      return;
    }
    if (cacheMode === "edit" && (args.updateText != null || args.stage != null)) {
      sessionCache.invalidateAlias(alias);
      return;
    }
    if (cacheMode === "paths" || cacheMode === "edit") {
      invalidatePaths(alias, wsRoot, collectTouchedPaths(args, cacheMode === "edit"));
      return;
    }
    if (cacheMode === "clearPaths") {
      invalidatePaths(alias, wsRoot, collectClearPaths(args));
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

function collectClearPaths(args) {
  const paths = [];
  if (args?.path) paths.push(args.path);
  if (Array.isArray(args?.paths)) paths.push(...args.paths);
  return paths;
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

function maybeStartSession(config, toolName, args) {
  const behavior = getToolDefinition(toolName)?.behavior;
  if (behavior?.startsSession !== true || args?.dryRun === true) return;
  if (behavior.deferStagedSession === true && typeof args.stage === "string") {
    const stage = args.stage.trim().toLowerCase();
    if (stage === "start" || stage === "append" || stage === "abort") return;
  }
  const alias = args?.workspace;
  if (!alias) return;
  try {
    const workspace = resolveWorkspace(config, alias);
    if (workspace?.path) ensureSessionStarted(config, workspace.alias, workspace.path);
  } catch (error) {
    debugSwallow("start-session", error);
  }
}

module.exports = {
  debugSwallow,
  buildExtraAudit,
  applyCautionAudit,
  invalidateSessionCacheForCall,
  maybeStartSession
};
