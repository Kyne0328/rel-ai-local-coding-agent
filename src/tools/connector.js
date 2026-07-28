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

// Compact connector results while stripping internal telemetry, default policy
// objects, duplicated arrays, and verbose raw-status blobs.
function compactRepositoryState(value, { includeWorkspace = true } = {}) {
  if (!value || typeof value !== "object") return value;
  const hasSplit = Array.isArray(value.baselineChangedFiles) && value.baselineChangedFiles.length > 0;
  return pruneEmpty({
    ok: value.ok,
    workspace: includeWorkspace ? value.workspace : undefined,
    branch: value.branch,
    aheadBehind: value.aheadBehind,
    status: value.status,
    changedFiles: value.changedFiles, untrackedFiles: value.untrackedFiles,
    sessionChangedFiles: hasSplit ? value.sessionChangedFiles : undefined,
    baselineChangedFiles: hasSplit ? value.baselineChangedFiles : undefined,
    stderr: value.stderr,
    deprecated: value.deprecated,
    deprecatedTool: value.deprecatedTool,
    replacementTool: value.replacementTool,
    migration: value.migration
  });
}
function compactForConnector(name, value, args = {}) {
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
        delete next.cacheHit; // debug metadata; audited server-side already
        if (String(args.guidanceMode || "").toLowerCase() !== "full") {
          delete next.writeGuidance;
          if (guidance?.recommendedMode === "exact-replace") {
            next.writeHint = "Large or interpolation-heavy file — prefer relai_edit with oldText/newText over a full rewrite.";
          }
        }
        return next;
      });
      return { ...value, items };
    }
    case "relai_status": {
      const ws = value.workspace && typeof value.workspace === "object"
        ? pruneEmpty({
            alias: value.workspace.alias,
            commandKeys: value.workspace.commandKeys,
            testCommandKeys: value.workspace.testCommandKeys,
            staleCommandKeys: value.workspace.staleCommandKeys,
            staleTestCommandKeys: value.workspace.staleTestCommandKeys,
            repository: compactRepositoryState(value.workspace.repository, { includeWorkspace: false }),
            error: value.workspace.error
          })
        : value.workspace;
      const state = ws && value.workspace ? policySentence(value.workspace.policy) : null;
      // Server-internal fields removed: tool groups,
      // the server's own npm scripts, its CI scan, and the raw policy object.
      return pruneEmpty({
        ok: value.ok,
        version: value.version,
        runtime: value.runtime,
        repositoryRuntime: value.repositoryRuntime,
        runtimeCompatibility: value.runtimeCompatibility,
        toolSurface: value.toolSurface ? {
          schemaVersion: value.toolSurface.schemaVersion,
          toolSurfaceVersion: value.toolSurface.toolSurfaceVersion,
          toolCount: value.toolSurface.toolCount,
          deprecations: value.toolSurface.deprecations,
          compatibilityAliases: value.toolSurface.compatibilityAliases
        } : undefined,
        workspace: ws,
        state,
        workspaceCount: value.workspaceCount,
        workspaceAliases: value.workspaceAliases
      });
    }
    case "relai_diff": {
      const compact = compactRepositoryState(value);
      return pruneEmpty({
        ...compact,
        staged: value.staged,
        path: value.path,
        diff: value.diff
      });
    }
    case "relai_run_checks": {
      // `commands` duplicated `checks`; validationLevel/reason/changedFiles are
      // internal telemetry (see WORKFLOW_RELIABILITY); policy was default noise.
      return pruneEmpty({
        ok: value.ok, workspace: value.workspace, level: value.level,
        checks: value.checks, results: value.results, skippedChecks: value.skippedChecks,
        completedUnits: value.completedUnits, totalUnits: value.totalUnits,
        failedCheck: value.failedCheck, cancelled: value.cancelled,
        validated: value.validated, validationStatus: value.validationStatus,
        completionKnown: value.completionKnown, endReason: value.endReason,
        completionSource: value.completionSource, summary: value.summary,
        validationAt: value.validationAt,
        planId: value.planId, planSelection: value.planSelection, planCreatedAt: value.planCreatedAt,
        changedFiles: value.completionKnown === true ? value.changedFiles : undefined,
        message: value.message, nextAction: value.nextAction,
        fullOutput: value.fullOutput
      });
    }
    case "relai_exec":
      return {
        ok: value.ok,
        workspace: value.workspace,
        command: value.command,
        cwd: value.cwd,
        shell: value.shell,
        exitCode: value.exitCode,
        durationMs: value.durationMs,
        stdout: value.stdout || '',
        stderr: value.stderr || '',
        stdoutBytes: value.stdoutBytes || 0,
        stderrBytes: value.stderrBytes || 0,
        stdoutTruncated: value.stdoutTruncated === true,
        stderrTruncated: value.stderrTruncated === true,
        timedOut: value.timedOut === true,
        ...(value.signal ? { signal: value.signal } : {}),
        ...(value.error ? { error: value.error } : {}),
        ...(Array.isArray(value.environmentKeys) && value.environmentKeys.length ? { environmentKeys: value.environmentKeys } : {}),
        changedFiles: Array.isArray(value.changedFiles) ? value.changedFiles : [],
        changedFilesTruncated: value.changedFilesTruncated === true,
        mutationTracking: value.mutationTracking
      };
    case "relai_repo_snapshot": {
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        manifests: value.manifests,
        discoveredCommands: value.discoveredCommands,
        projectInstructions: value.projectInstructions,
        fileCount: value.fileCount,
        files: value.files,
        skippedCount: Array.isArray(value.skipped) ? value.skipped.length : undefined,
        truncated: value.truncated,
        hints: value.hints,
        git: value.git,
        recommendedFlow: value.recommendedFlow
      });
    }
    default:
      return value;
  }
}

export { compactForConnector, policySentence };
