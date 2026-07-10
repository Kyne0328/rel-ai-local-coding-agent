const { readAudit } = require("../audit");
const { resolveWorkspace } = require("../config");
const {
  repoSnapshot, relaiRead, relaiWrite, relaiReplace, relaiClear,
  workspaceTidyPlan, workspaceTidyRun, relaiApplyPatch, relaiApplyArchive,
  relaiSnapshotArchive, relaiVerify, relaiBrowser, relaiDiff, relaiReset,
  relaiGitStatus, relaiGitFetch, relaiGitCommit, relaiGitPush,
  relaiGitMergeBranch, relaiGitMergeRemoteBranchesPlan, relaiGitAbortMerge,
  relaiGitCreatePr, relaiRemoveFile, relaiRefactorAudit
} = require("../localRepoBridge");
const { planEdit } = require("../executionPlanner");
const { resolvePolicy, writeSessionPolicy, clearSessionPolicy } = require("../policyResolver");
const { relaiStatus, relaiFeatureProbe, buildSessionSummary } = require("./status");

async function dispatchTool(config, name, args) {
  switch (name) {
    case "relai_repo_snapshot":
      return withWorkspace(config, args, (workspace) => repoSnapshot(workspace, config, args));
    case "relai_read":
      return withWorkspace(config, args, (workspace) => relaiRead(workspace, config, args));
    case "relai_write":
      return withWorkspace(config, args, (workspace) => relaiWrite(workspace, config, args));
    case "relai_replace":
      return withWorkspace(config, args, (workspace) => relaiReplace(workspace, config, args));
    case "relai_clear_files":
      return withWorkspace(config, args, (workspace) => relaiClear(workspace, config, args));
    case "relai_tidy_plan":
      return withWorkspace(config, args, (workspace) => workspaceTidyPlan(workspace, config, args));
    case "relai_tidy_run":
      return withWorkspace(config, args, (workspace) => workspaceTidyRun(workspace, config, args));
    case "relai_apply_update":
      return withWorkspace(config, args, (workspace) => relaiApplyPatch(workspace, config, mapCheckArgs({ ...args, patch: args.updateText || args.patch || args.diff })));
    case "relai_apply_bundle":
      return withWorkspace(config, args, (workspace) => relaiApplyArchive(workspace, config, mapCheckArgs({ ...args, archivePath: args.archivePath || args.bundlePath || args.path, bundlePath: args.bundlePath || args.archivePath || args.path, deleteMissing: args.clearMissing })));
    case "relai_package_snapshot":
      return withWorkspace(config, args, (workspace) => relaiSnapshotArchive(workspace, config, args));
    case "relai_run_checks":
      return withWorkspace(config, args, (workspace) => relaiVerify(workspace, config, mapCheckArgs(args)));
    case "relai_browser":
      return withWorkspace(config, args, (workspace) => relaiBrowser(workspace, config, { ...args, command: args.command || args.check }));
    case "relai_diff":
      return withWorkspace(config, args, (workspace) => relaiDiff(workspace, config, args));
    case "relai_restore_changes":
      return withWorkspace(config, args, (workspace) => relaiReset(workspace, config, args));
    case "relai_status":
      return relaiStatus(config, args);
    case "relai_feature_probe":
      return relaiFeatureProbe(config, args);
    case "relai_git_status":
      return withWorkspace(config, args, (workspace) => relaiGitStatus(workspace, config, args));
    case "relai_git_fetch":
      return withWorkspace(config, args, (workspace) => relaiGitFetch(workspace, config, args));
    case "relai_git_commit":
      return withWorkspace(config, args, (workspace) => relaiGitCommit(workspace, config, args));
    case "relai_git_push":
      return withWorkspace(config, args, (workspace) => relaiGitPush(workspace, config, args));
    case "relai_git_merge_branch":
      return withWorkspace(config, args, (workspace) => relaiGitMergeBranch(workspace, config, args));
    case "relai_git_merge_remote_branches_plan":
      return withWorkspace(config, args, (workspace) => relaiGitMergeRemoteBranchesPlan(workspace, config, args));
    case "relai_git_abort_merge":
      return withWorkspace(config, args, (workspace) => relaiGitAbortMerge(workspace, config));
    case "relai_git_create_pr":
      return withWorkspace(config, args, (workspace) => relaiGitCreatePr(workspace, config, args));
    case "relai_remove_file":
      return withWorkspace(config, args, (workspace) => relaiRemoveFile(workspace, config, args));
    case "relai_refactor_audit":
      return withWorkspace(config, args, (workspace) => relaiRefactorAudit(workspace, config, args));
    case "relai_edit":
      return withWorkspace(config, args, (workspace) => planEdit(workspace, config, args));
    case "relai_set_policy":
      return withWorkspace(config, args, (workspace) => {
        if (args.clear) {
          const { cleared } = clearSessionPolicy(config, workspace.alias);
          const policy = resolvePolicy(workspace, config);
          return { ok: true, workspace: workspace.alias, operation: "clear", cleared, policy };
        }
        writeSessionPolicy(config, workspace.alias, { taskHint: args.taskHint, workspaceRoot: workspace.path });
        const policy = resolvePolicy(workspace, config);
        return { ok: true, workspace: workspace.alias, operation: "set", policy };
      });
    case "relai_session_summary":
      return withWorkspace(config, args, (workspace) => {
        const policy = resolvePolicy(workspace, config);
        const { entries } = readAudit(config, { limit: Math.min(Number(args.limit || 50), 200) });
        const summary = buildSessionSummary(entries || [], workspace.alias, policy);
        return { ok: true, workspace: workspace.alias, ...summary, policy };
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function mapCheckArgs(args = {}) {
  return {
    ...args,
    command: args.command || args.check,
    commands: args.commands || args.checks,
    commandsText: args.commandsText || args.checksText
  };
}

async function withWorkspace(config, request, fn) {
  const alias = request?.workspace;
  const workspace = resolveWorkspace(config, alias);
  return fn(workspace);
}

module.exports = { dispatchTool };
