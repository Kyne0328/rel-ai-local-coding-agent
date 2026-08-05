// @ts-check


import { resolveWorkspace } from '../config.js';
import { repoSnapshot, relaiRead, workspaceTidyPlan, workspaceTidyRun, relaiVerify, relaiHttpProbe, relaiDiff, relaiRestorePaths, relaiResetWorkspace, relaiGitCommit, relaiGitPush, relaiGitDraftPr } from '../localRepoBridge.js';
import { planEdit } from '../executionPlanner.js';
import { relaiStatus } from './status.js';
import { completeTask } from './completion.js';
import { cancelTask } from './cancellation.js';
import { relaiSearch } from '../bridge/search.js';
import { relaiCodeInspect } from '../bridge/codeIntelligence.js';
import { relaiExec } from '../bridge/exec.js';
import { startTask, taskBootstrapFromSnapshot } from './task.js';
import { startManagedProcess, readManagedProcess, writeManagedProcess, stopManagedProcess, listManagedProcesses } from '../processManager.js';
import { createManagedWorktree, listManagedWorktrees, removeManagedWorktree } from '../worktreeManager.js';
import { relaiSemanticSearch } from '../bridge/semanticSearch.js';
import { relaiDiagnosticsRun } from '../bridge/diagnosticsRunner.js';
const startTaskHandler = inWorkspace(async (workspace, config, args) => {
  const task = startTask(workspace, args);
  const bootstrapMode = String(args.bootstrap || 'compact').toLowerCase();
  if (bootstrapMode === 'none') return task;
  const snapshot = await repoSnapshot(workspace, config, {
    maxEntries: bootstrapMode === 'full' ? undefined : 600,
    includeFiles: true,
    instructionPath: args.instructionPath
  });
  return {
    ...task,
    bootstrap: taskBootstrapFromSnapshot(snapshot, bootstrapMode)
  };
});

const HANDLERS = Object.freeze({
  startTask: startTaskHandler,
  repoSnapshot: inWorkspace((workspace, config, args) => repoSnapshot(workspace, config, args)),
  read: inWorkspace((workspace, config, args, context) => relaiRead(workspace, config, args, context)),
  search: inWorkspace((workspace, config, args) => relaiSearch(workspace, config, args)),
  codeInspect: inWorkspace((workspace, config, args) => relaiCodeInspect(workspace, config, args)),
  exec: inWorkspace((workspace, config, args, context) => relaiExec(workspace, config, args, context)),
  processStart: inWorkspace((workspace, config, args, context) => startManagedProcess(workspace, config, args, context)),
  processRead: (config, args, context) => readManagedProcess(config, args, context),
  processWrite: (config, args, context) => writeManagedProcess(config, args, context),
  processStop: (config, args, context) => stopManagedProcess(config, args, context),
  processList: (config, args, context) => listManagedProcesses(config, args, context),
  worktreeCreate: inWorkspace((workspace, config, args, context) => createManagedWorktree(workspace, config, args, context)),
  worktreeList: (config, args, context) => listManagedWorktrees(config, args, context),
  worktreeRemove: inWorkspace((workspace, config, args, context) => removeManagedWorktree(workspace, config, args, context)),
  semanticSearch: inWorkspace((workspace, config, args) => relaiSemanticSearch(workspace, config, args)),
  diagnosticsRun: inWorkspace((workspace, config, args, context) => relaiDiagnosticsRun(workspace, config, args, context)),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args, context) => relaiVerify(workspace, config, mapCheckArgs(args), context)),
  httpProbe: inWorkspace((workspace, config, args) => relaiHttpProbe(workspace, config, args)),
  diff: inWorkspace((workspace, config, args) => relaiDiff(workspace, config, args)),
  restorePaths: inWorkspace((workspace, config, args) => relaiRestorePaths(workspace, config, args)),
  resetWorkspace: inWorkspace((workspace, config, args) => relaiResetWorkspace(workspace, config, args)),
  status: relaiStatus,
  gitCommit: inWorkspace((workspace, config, args) => relaiGitCommit(workspace, config, args)),
  gitPush: inWorkspace((workspace, config, args) => relaiGitPush(workspace, config, args)),
  gitDraftPr: inWorkspace((workspace, config, args) => relaiGitDraftPr(workspace, config, args)),
  edit: inWorkspace((workspace, config, args) => planEdit(workspace, config, args)),
  cancelTask,
  completeTask
});

/**
 * @param {(workspace: any, config: unknown, args: Record<string, any>, context: { connector?: boolean, taskId?: string, requestHeaders?: Record<string, string> }) => any} handler
 */
function inWorkspace(handler) {
  /**
   * @param {unknown} config
   * @param {Record<string, any>} [args]
   * @param {{ connector?: boolean, taskId?: string, requestHeaders?: Record<string, string> }} [context]
   */
  return (config, args = {}, context = {}) => {
    const workspace = resolveWorkspace(config, args.workspace);
    return handler(workspace, config, args, context);
  };
}

/**
 * @param {Record<string, any> & { command?: string, check?: string, commands?: string[], checks?: string[], commandsText?: string, checksText?: string }} [args]
 */
function mapCheckArgs(args = {}) {
  return {
    ...args,
    command: args.command || args.check,
    commands: args.commands || args.checks,
    commandsText: args.commandsText || args.checksText
  };
}

/**
 * @param {string} handlerName
 */
export { HANDLERS };
