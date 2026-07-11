// Render an active session/policy object as one short, user-actionable line, or
// null when there is nothing worth saying (the common idle/default case). This
// replaces the always-present { trusted, sessionActive:false, baselineDirty:[],
// source:"default" } object that leaked implementation state without user value.
function policySentence(policy) {
  if (!policy || typeof policy !== "object") return null;
  const parts = [];
  if (policy.sessionActive === true) {
    parts.push(policy.taskHint ? `Session active: ${policy.taskHint}` : "Session active");
    if (Array.isArray(policy.baselineDirty) && policy.baselineDirty.length) {
      parts.push(`${policy.baselineDirty.length} pre-existing dirty file(s) are not attributed to this session`);
    }
    return parts.join(". ") + ".";
  }
  return null;
}

// Drop null/undefined and empty-array fields so a compact result never carries a
// key that only ever says "nothing here".
function pruneEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Compact a tool result for the ChatGPT connector surface. Keeps everything the
// model needs to decide what to do next; strips internal telemetry, always-default
// policy objects, duplicated arrays, and verbose raw-status blobs.
function compactForConnector(name, value, _args) {
  if (!value || typeof value !== "object") return value;
  switch (name) {
    case "relai_read": {
      // Replace the ~1 KB nested writeGuidance object on every file item with a
      // single short hint, and only when the file shape actually warrants care
      // (large or interpolation-heavy). Normal files carry no guidance at all.
      if (!Array.isArray(value.items)) return value;
      const items = value.items.map((item) => {
        if (!item || typeof item !== "object") return item;
        const guidance = item.writeGuidance;
        const next = { ...item };
        delete next.writeGuidance;
        delete next.cacheHit; // debug metadata; audited server-side already
        if (guidance?.recommendedMode === "exact-replace") {
          next.writeHint = "Large or interpolation-heavy file — prefer relai_edit with oldText/newText over a full rewrite.";
        }
        return next;
      });
      return { ...value, items };
    }
    case "relai_status": {
      const ws = value.workspace && typeof value.workspace === "object"
        ? pruneEmpty({
            alias: value.workspace.alias,
            root: value.workspace.root,
            commandKeys: value.workspace.commandKeys,
            testCommandKeys: value.workspace.testCommandKeys,
            staleCommandKeys: value.workspace.staleCommandKeys,
            staleTestCommandKeys: value.workspace.staleTestCommandKeys,
            error: value.workspace.error
          })
        : value.workspace;
      const state = ws && value.workspace ? policySentence(value.workspace.policy) : null;
      // Server-internal fields removed: tool groups,
      // the server's own npm scripts, its CI scan, and the raw policy object.
      return pruneEmpty({
        ok: value.ok,
        version: value.version,
        workspace: ws,
        state,
        workspaceCount: value.workspaceCount
      });
    }
    case "relai_diff":
    case "relai_git_status": {
      // Ownership arrays and per-entry raw status lines are only meaningful when a
      // real session baseline exists; otherwise they are noise (or, pre-fix, lies).
      const hasSplit = Array.isArray(value.baselineChangedFiles) && value.baselineChangedFiles.length > 0;
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        branch: value.branch,
        aheadBehind: value.aheadBehind,
        staged: value.staged,
        path: value.path,
        status: value.status,
        diff: value.diff,
        // Keep the split only when a baseline actually separates the sets.
        sessionChangedFiles: hasSplit ? value.sessionChangedFiles : undefined,
        baselineChangedFiles: hasSplit ? value.baselineChangedFiles : undefined,
        stderr: value.stderr
      });
    }
    case "relai_run_checks": {
      // `commands` duplicated `checks`; validationLevel/reason/changedFiles are
      // internal telemetry (see WORKFLOW_RELIABILITY); policy was default noise.
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        level: value.level,
        checks: value.checks,
        results: value.results,
        validated: value.validated,
        validationStatus: value.validationStatus,
        message: value.message,
        fullOutput: value.fullOutput
      });
    }
    case "relai_repo_snapshot": {
      // Drop config-forced constants, budget telemetry, the operation journal, and the full text
      // of every manifest — keep the manifest NAMES and the project hints.
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        root: value.root,
        manifests: value.manifests,
        discoveredCommands: value.discoveredCommands,
        fileCount: value.fileCount,
        files: value.files,
        skipped: value.skipped,
        truncated: value.truncated,
        hints: value.hints,
        recommendedFlow: value.recommendedFlow
      });
    }
    default:
      return value;
  }
}

module.exports = { compactForConnector, policySentence };
