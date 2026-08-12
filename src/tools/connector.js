import { slimCompactPublicResult } from './compactResult.js';
import { withTaskIdentity } from './task.js';
import {
  boundedStringArray,
  compactCommandResult,
  compactProcessMetadata,
  compactRepositoryState,
  policySentence,
  pruneEmpty
} from './connectorHelpers.js';

function serializeConnectorResult({ publicName, action, operationName, value, args = {}, workId = '' }) {
  const operationResult = compactForConnector(operationName, value, args);
  const publicResult = slimCompactPublicResult(publicName, action, operationResult);
  const resultWithWorkflow = value?.workflow && publicResult && typeof publicResult === 'object'
    ? { ...publicResult, workflow: value.workflow }
    : publicResult;
  return withTaskIdentity(resultWithWorkflow, workId);
}

function compactForConnector(name, value, args = {}) {
  if (!value || typeof value !== 'object') return value;
  switch (name) {
    case 'relai_read': {
      if (!Array.isArray(value.items)) return value;
      const items = value.items.map(item => {
        if (!item || typeof item !== 'object') return item;
        const guidance = item.writeGuidance;
        const next = { ...item };
        delete next.cacheHit;
        if (String(args.guidanceMode || '').toLowerCase() !== 'full') {
          delete next.writeGuidance;
          if (guidance?.recommendedMode === 'exact-replace') {
            next.writeHint = 'Large or interpolation-heavy file - prefer relai_edit with oldText/newText over a full rewrite.';
          }
        }
        return next;
      });
      return { ...value, items };
    }
    case 'relai_status': {
      const workspace = value.workspace && typeof value.workspace === 'object'
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
        workspace,
        state: workspace && value.workspace ? policySentence(value.workspace.policy) : null,
        workspaceCount: value.workspaceCount,
        workspaceAliases: value.workspaceAliases
      });
    }
    case 'relai_diff':
      return pruneEmpty({ ...compactRepositoryState(value), staged: value.staged, path: value.path, reviewScope: value.reviewScope || value.reviewedScope, reviewedScope: value.reviewedScope, reviewHash: value.reviewHash, reviewedFiles: value.reviewedFiles, excludedWorkspaceFiles: value.excludedWorkspaceFiles, diff: value.diff });
    case 'relai_run_checks':
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        level: value.level,
        checks: value.checks,
        results: Array.isArray(value.results) ? value.results.map(compactCommandResult) : value.results,
        skippedChecks: value.skippedChecks,
        completedUnits: value.completedUnits,
        executedUnits: value.executedUnits,
        reusedUnits: value.reusedUnits,
        reusedChecks: value.reusedChecks,
        totalUnits: value.totalUnits,
        failedCheck: value.failedCheck,
        cancelled: value.cancelled,
        validated: value.validated,
        validationStatus: value.validationStatus,
        completionKnown: value.completionKnown,
        endReason: value.endReason,
        completionSource: value.completionSource,
        summary: value.summary,
        validationAt: value.validationAt,
        planId: value.planId,
        planSelection: value.planSelection,
        planCreatedAt: value.planCreatedAt,
        changedFiles: value.completionKnown === true ? value.changedFiles : undefined,
        message: value.message,
        nextAction: value.nextAction,
        fullOutput: value.fullOutput
      });
    case 'relai_exec':
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        command: value.command,
        shell: value.shell,
        cwd: value.cwd && value.cwd !== '.' ? value.cwd : undefined,
        exitCode: value.exitCode,
        durationMs: value.durationMs,
        stdout: value.stdout || undefined,
        stderr: value.stderr || undefined,
        stdoutBytes: value.stdoutBytes || undefined,
        stderrBytes: value.stderrBytes || undefined,
        stdoutTruncated: value.stdoutTruncated === true ? true : undefined,
        stderrTruncated: value.stderrTruncated === true ? true : undefined,
        timedOut: value.timedOut === true ? true : undefined,
        signal: value.signal || undefined,
        error: value.error || undefined,
        environmentKeys: value.environmentKeys?.length ? value.environmentKeys : undefined,
        changedFiles: value.changedFiles?.length ? value.changedFiles : undefined,
        changedFilesTruncated: value.changedFilesTruncated === true ? true : undefined,
        mutationTracking: value.changedFiles?.length ? value.mutationTracking : undefined
      });
    case 'relai_process_list':
      return pruneEmpty({
        ok: value.ok,
        processes: Array.isArray(value.processes) ? value.processes.map(compactProcessMetadata) : value.processes,
        count: value.count
      });
    case 'relai_process_read':
      return pruneEmpty({ ...compactProcessMetadata(value), stdout: value.stdout, stderr: value.stderr });
    case 'relai_repo_snapshot': {
      const files = boundedStringArray(value.files, 12 * 1024);
      return pruneEmpty({
        ok: value.ok,
        workspace: value.workspace,
        manifests: value.manifests,
        discoveredCommands: value.discoveredCommands,
        projectInstructions: value.projectInstructions,
        fileCount: value.fileCount,
        files: files.values,
        returnedFileCount: files.count,
        omittedFiles: files.omitted,
        skippedCount: Array.isArray(value.skipped) ? value.skipped.length : undefined,
        truncated: value.truncated === true || files.omitted > 0,
        next: files.omitted > 0 ? 'Use relai_search or targeted relai_read calls for omitted repository paths.' : undefined,
        hints: value.hints,
        git: value.git,
        recommendedFlow: value.recommendedFlow
      });
    }
    default:
      return value;
  }
}

export { compactForConnector, policySentence, serializeConnectorResult };
