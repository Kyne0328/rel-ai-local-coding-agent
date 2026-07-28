// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolHandler} ToolHandler */

const { resolveWorkspace } = require('../config');
const {
  repoSnapshot,
  relaiRead,
  workspaceTidyPlan,
  workspaceTidyRun,
  relaiVerify,
  relaiHttpProbe,
  relaiUiCheck,
  relaiDiff,
  relaiRestorePaths,
  relaiResetWorkspace,
  relaiGitCommit,
  relaiGitPush,
  relaiGitDraftPr
} = require('../localRepoBridge');
const { planEdit } = require('../executionPlanner');
const { relaiStatus } = require('./status');
const { completeTask } = require('./completion');
const { relaiSearch } = require('../bridge/search');
const { relaiCodeInspect } = require('../bridge/codeIntelligence');
const { relaiExec } = require('../bridge/exec');
const { startTask } = require('./task');
const {
  startManagedProcess,
  readManagedProcess,
  writeManagedProcess,
  stopManagedProcess,
  listManagedProcesses
} = require('../processManager');
const {
  createManagedWorktree,
  listManagedWorktrees,
  removeManagedWorktree
} = require('../worktreeManager');
const { relaiSemanticSearch } = require('../bridge/semanticSearch');
const { relaiDiagnosticsRun } = require('../bridge/diagnosticsRunner');
const { createValidationPlan } = require('../bridge/validationPlan');
const { getDeferredOperation, cancelDeferredOperation } = require('./operationTaskHandlers');

/** @type {ToolHandler} */
const statusHandler = (config, args, context) => relaiStatus(config, args, context);

/** @type {ToolHandler} */
const completeTaskHandler = (config, args) => completeTask(config, args);

const HANDLERS = Object.freeze({
  startTask: inWorkspace((workspace, _config, args) => startTask(workspace, args)),
  repoSnapshot: inWorkspace((workspace, config, args) => repoSnapshot(workspace, config, args)),
  read: inWorkspace((workspace, config, args, context) => relaiRead(workspace, config, args, context)),
  search: inWorkspace((workspace, config, args) => relaiSearch(workspace, config, args)),
  codeInspect: inWorkspace((workspace, config, args) => relaiCodeInspect(workspace, config, args)),
  exec: inWorkspace((workspace, config, args) => relaiExec(workspace, config, args)),
  processStart: inWorkspace((workspace, config, args, context) => startManagedProcess(workspace, config, args, context)),
  processRead: (config, args) => readManagedProcess(config, args),
  processWrite: (config, args) => writeManagedProcess(config, args),
  processStop: (config, args) => stopManagedProcess(config, args),
  processList: (config, args) => listManagedProcesses(config, args),
  worktreeCreate: inWorkspace((workspace, config, args, context) => createManagedWorktree(workspace, config, args, context)),
  worktreeList: (config, args) => listManagedWorktrees(config, args),
  worktreeRemove: inWorkspace((workspace, config, args) => removeManagedWorktree(workspace, config, args)),
  semanticSearch: inWorkspace((workspace, config, args) => relaiSemanticSearch(workspace, config, args)),
  diagnosticsRun: inWorkspace((workspace, config, args) => relaiDiagnosticsRun(workspace, config, args)),
  validationPlan: inWorkspace((workspace, config, args) => createValidationPlan(workspace, config, args)),
  operationTaskGet: (config, args, context) => getDeferredOperation(config, args, context),
  operationTaskCancel: (config, args, context) => cancelDeferredOperation(config, args, context),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args) => relaiVerify(workspace, config, mapCheckArgs(args))),
  httpProbe: inWorkspace((workspace, config, args) => relaiHttpProbe(workspace, config, args)),
  uiCheck: inWorkspace((workspace, config, args) => relaiUiCheck(workspace, config, args)),
  diff: inWorkspace((workspace, config, args) => relaiDiff(workspace, config, args)),
  restorePaths: inWorkspace((workspace, config, args) => relaiRestorePaths(workspace, config, args)),
  resetWorkspace: inWorkspace((workspace, config, args) => relaiResetWorkspace(workspace, config, args)),
  status: statusHandler,
  gitCommit: inWorkspace((workspace, config, args) => relaiGitCommit(workspace, config, args)),
  gitPush: inWorkspace((workspace, config, args) => relaiGitPush(workspace, config, args)),
  gitDraftPr: inWorkspace((workspace, config, args) => relaiGitDraftPr(workspace, config, args)),
  edit: inWorkspace((workspace, config, args) => planEdit(workspace, config, args)),
  completeTask: completeTaskHandler
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
module.exports = { HANDLERS };
