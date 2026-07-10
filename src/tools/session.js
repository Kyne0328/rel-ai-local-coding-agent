const sessionCache = require("../sessionCache");
const { classifyCaution } = require("../cautionZone");
const { resolveWorkspace } = require("../config");
const { resolveSafePath } = require("../safety");
const { ensureSessionStarted } = require("../policyResolver");

// Best-effort side steps (cache invalidation, caution tagging, session anchoring)
// must never fail an otherwise-successful tool call. Swallow their errors here, and
// surface them on stderr only when REL_AI_MCP_DEBUG is set, for diagnostics.
function debugSwallow(context, error) {
  if (process.env.REL_AI_MCP_DEBUG) {
    console.error(`[rel-ai-mcp] best-effort '${context}' failed: ${error?.message || error}`);
  }
}

const EXTRA_AUDIT_BUILDERS = {
  relai_edit(value, args, extra) {
    if (value?.plannerPath) extra.plannerPath = value.plannerPath;
    if (value?.plannerReason) extra.plannerReason = value.plannerReason;
    if (args?.path) extra.filePath = args.path;
  },
  relai_run_checks(value, _args, extra) {
    if (value?.validationLevel) extra.validationLevel = value.validationLevel;
    if (value?.validationLevelReason) extra.validationLevelReason = value.validationLevelReason;
    if (value?.aliasNormalizations != null) extra.aliasNormalizations = value.aliasNormalizations;
    if (value?.policy) extra.policySessionActive = value.policy.sessionActive;
  },
  relai_set_policy(value, _args, extra) {
    if (value?.operation) extra.policyOperation = value.operation;
    if (value?.policy) extra.policySessionActive = value.policy.sessionActive;
  },
  relai_write(_value, args, extra) {
    if (args?.path) extra.filePath = args.path;
  },
  relai_replace(_value, args, extra) {
    if (args?.path) extra.filePath = args.path;
  },
  relai_clear_files(_value, args, extra) {
    if (args?.path) extra.filePath = args.path;
    if (Array.isArray(args?.paths) && args.paths.length) extra.filePaths = args.paths;
  },
  relai_read(value, _args, extra) {
    if (Array.isArray(value?.items)) extra.cacheHit = value.items.some((i) => i?.cacheHit === true);
  },
  relai_repo_snapshot(value, _args, extra) {
    if (value?.effectiveMaxEntries != null) extra.effectiveMaxIndexFiles = value.effectiveMaxEntries;
    if (value?.budgetMultiplied != null) extra.budgetMultiplied = value.budgetMultiplied;
  }
};

function buildExtraAudit(name, value, args) {
  const extra = {};
  const build = EXTRA_AUDIT_BUILDERS[name];
  if (build) build(value, args, extra);
  return extra;
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

const CACHE_INVALIDATE_ALL = new Set(["relai_apply_update", "relai_apply_bundle"]);
const CACHE_INVALIDATE_PATHS = new Set(["relai_write", "relai_replace", "relai_edit"]);

function invalidateSessionCacheForCall(config, name, args) {
  try {
    const alias = args?.workspace;
    if (!alias) return;
    const workspace = resolveWorkspace(config, alias);
    const wsRoot = workspace?.path;
    if (!wsRoot) return;

    if (name === "relai_set_policy") {
      if (args.clear === true) sessionCache.invalidateAlias(alias);
      return;
    }
    if (CACHE_INVALIDATE_ALL.has(name)) {
      sessionCache.invalidateAlias(alias);
      return;
    }
    if (CACHE_INVALIDATE_PATHS.has(name)) {
      // relai_edit can touch many files (edits batch) or unknown files (updateText
      // patch / staged patch) — invalidate the whole alias so a follow-up relai_read
      // never serves stale cached content.
      if (name === "relai_edit" && (args.updateText != null || args.stage != null)) {
        sessionCache.invalidateAlias(alias);
        return;
      }
      invalidatePaths(alias, wsRoot, collectTouchedPaths(name, args));
      return;
    }
    if (name === "relai_clear_files") {
      invalidatePaths(alias, wsRoot, collectClearPaths(args));
    }
  } catch (error) {
    debugSwallow("cache-invalidate", error);
  }
}

function collectTouchedPaths(name, args) {
  const touched = [];
  if (args?.path) touched.push(args.path);
  if (name === "relai_edit" && Array.isArray(args?.edits)) {
    for (const edit of args.edits) if (edit?.path) touched.push(edit.path);
  }
  return touched;
}

function collectClearPaths(args) {
  const paths = [];
  if (args?.path) paths.push(args.path);
  if (Array.isArray(args?.paths)) for (const p of args.paths) paths.push(p);
  return paths;
}

function invalidatePaths(alias, wsRoot, paths) {
  for (const p of paths) {
    try {
      const safe = resolveSafePath(wsRoot, p);
      sessionCache.invalidatePath(alias, safe.absolutePath);
    } catch (error) {
      debugSwallow("resolve-safe-path", error);
    }
  }
}

const SESSION_STARTING_TOOLS = new Set([
  "relai_write", "relai_replace", "relai_edit",
  "relai_apply_update", "relai_apply_bundle",
  "relai_clear_files", "relai_remove_file"
]);

function maybeStartSession(config, toolName, args) {
  if (!SESSION_STARTING_TOOLS.has(toolName)) return;
  if (args?.dryRun === true) return;
  // Staged writes that do not touch the workspace yet ('start'/'append'/'abort')
  // should not anchor the baseline — only the committing/direct call does.
  if ((toolName === "relai_write" || toolName === "relai_edit") && typeof args.stage === "string") {
    const stage = args.stage.trim().toLowerCase();
    if (stage === "start" || stage === "append" || stage === "abort") return;
  }
  const alias = args?.workspace;
  if (!alias) return;
  try {
    const workspace = resolveWorkspace(config, alias);
    if (workspace?.path) ensureSessionStarted(config, workspace.alias, workspace.path);
  } catch (error) {
    // Unknown workspace surfaces as a normal dispatch error later; ignore here.
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
