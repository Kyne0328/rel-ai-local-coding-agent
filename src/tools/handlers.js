// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolHandler} ToolHandler */

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

/** @type {Readonly<Record<string, ToolHandler>>} */
const HANDLERS = Object.freeze({
  repoSnapshot: inWorkspace((workspace, config, args) => repoSnapshot(workspace, config, args)),
  read: inWorkspace((workspace, config, args) => relaiRead(workspace, config, args)),
  write: inWorkspace((workspace, config, args) => relaiWrite(workspace, config, args)),
  replace: inWorkspace((workspace, config, args) => relaiReplace(workspace, config, args)),
  clearFiles: inWorkspace((workspace, config, args) => relaiClear(workspace, config, args)),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  applyUpdate: inWorkspace((workspace, config, args) => relaiApplyPatch(workspace, config, mapCheckArgs({ ...args, patch: args.updateText || args.patch || args.diff }))),
  applyBundle: inWorkspace((workspace, config, args) => relaiApplyArchive(workspace, config, mapCheckArgs({ ...args, archivePath: args.archivePath || args.bundlePath || args.path, bundlePath: args.bundlePath || args.archivePath || args.path, deleteMissing: args.clearMissing }))),
  packageSnapshot: inWorkspace((workspace, config, args) => relaiSnapshotArchive(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args) => relaiVerify(workspace, config, mapCheckArgs(args))),
  browser: inWorkspace((workspace, config, args) => relaiBrowser(workspace, config, { ...args, command: args.command || args.check })),
  diff: inWorkspace((workspace, config, args) => relaiDiff(workspace, config, args)),
  restore: inWorkspace((workspace, config, args) => relaiReset(workspace, config, args)),
  status: (config, args) => relaiStatus(config, args),
  featureProbe: (config, args) => relaiFeatureProbe(config, args),
  gitStatus: inWorkspace((workspace, config, args) => relaiGitStatus(workspace, config, args)),
  gitFetch: inWorkspace((workspace, config, args) => relaiGitFetch(workspace, config, args)),
  gitCommit: inWorkspace((workspace, config, args) => relaiGitCommit(workspace, config, args)),
  gitPush: inWorkspace((workspace, config, args) => relaiGitPush(workspace, config, args)),
  gitMergeBranch: inWorkspace((workspace, config, args) => relaiGitMergeBranch(workspace, config, args)),
  gitMergeRemoteBranchesPlan: inWorkspace((workspace, config, args) => relaiGitMergeRemoteBranchesPlan(workspace, config, args)),
  gitAbortMerge: inWorkspace((workspace, config) => relaiGitAbortMerge(workspace, config)),
  gitCreatePr: inWorkspace((workspace, config, args) => relaiGitCreatePr(workspace, config, args)),
  removeFile: inWorkspace((workspace, config, args) => relaiRemoveFile(workspace, config, args)),
  refactorAudit: inWorkspace((workspace, config, args) => relaiRefactorAudit(workspace, config, args)),
  edit: inWorkspace((workspace, config, args) => planEdit(workspace, config, args)),
  setPolicy: inWorkspace(handleSetPolicy),
  sessionSummary: inWorkspace(handleSessionSummary)
});

function inWorkspace(handler) {
  return (config, args = {}) => {
    const workspace = resolveWorkspace(config, args.workspace);
    return handler(workspace, config, args);
  };
}

function handleSetPolicy(workspace, config, args) {
  if (args.clear) {
    const { cleared } = clearSessionPolicy(config, workspace.alias);
    const policy = resolvePolicy(workspace, config);
    return { ok: true, workspace: workspace.alias, operation: "clear", cleared, policy };
  }
  writeSessionPolicy(config, workspace.alias, { taskHint: args.taskHint, workspaceRoot: workspace.path });
  const policy = resolvePolicy(workspace, config);
  return { ok: true, workspace: workspace.alias, operation: "set", policy };
}

function handleSessionSummary(workspace, config, args) {
  const policy = resolvePolicy(workspace, config);
  const { entries } = readAudit(config, { limit: Math.min(Number(args.limit || 50), 200) });
  const summary = buildSessionSummary(entries || [], workspace.alias, policy);
  return { ok: true, workspace: workspace.alias, ...summary, policy };
}

function mapCheckArgs(args = {}) {
  return {
    ...args,
    command: args.command || args.check,
    commands: args.commands || args.checks,
    commandsText: args.commandsText || args.checksText
  };
}

function getHandler(handlerName) {
  return HANDLERS[handlerName] || null;
}

module.exports = { HANDLERS, getHandler };
