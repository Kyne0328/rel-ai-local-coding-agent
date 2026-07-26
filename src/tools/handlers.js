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

/** @type {Readonly<Record<string, ToolHandler>>} */
const HANDLERS = Object.freeze({
  startTask: inWorkspace((workspace) => startTask(workspace)),
  repoSnapshot: inWorkspace((workspace, config, args) => repoSnapshot(workspace, config, args)),
  read: inWorkspace((workspace, config, args, context) => relaiRead(workspace, config, args, context)),
  search: inWorkspace((workspace, config, args) => relaiSearch(workspace, config, args)),
  codeInspect: inWorkspace((workspace, config, args) => relaiCodeInspect(workspace, config, args)),
  exec: inWorkspace((workspace, config, args) => relaiExec(workspace, config, args)),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args) => relaiVerify(workspace, config, mapCheckArgs(args))),
  httpProbe: inWorkspace((workspace, config, args) => relaiHttpProbe(workspace, config, args)),
  uiCheck: inWorkspace((workspace, config, args) => relaiUiCheck(workspace, config, args)),
  diff: inWorkspace((workspace, config, args) => relaiDiff(workspace, config, args)),
  restorePaths: inWorkspace((workspace, config, args) => relaiRestorePaths(workspace, config, args)),
  resetWorkspace: inWorkspace((workspace, config, args) => relaiResetWorkspace(workspace, config, args)),
  status: (config, args) => relaiStatus(config, args),
  gitCommit: inWorkspace((workspace, config, args) => relaiGitCommit(workspace, config, args)),
  gitPush: inWorkspace((workspace, config, args) => relaiGitPush(workspace, config, args)),
  gitDraftPr: inWorkspace((workspace, config, args) => relaiGitDraftPr(workspace, config, args)),
  edit: inWorkspace((workspace, config, args) => planEdit(workspace, config, args)),
  completeTask: (config, args) => completeTask(config, args)
});

/**
 * @param {(workspace: any, config: unknown, args: Record<string, any>, context: { connector?: boolean }) => any} handler
 */
function inWorkspace(handler) {
  /**
   * @param {unknown} config
   * @param {Record<string, any>} [args]
   * @param {{ connector?: boolean }} [context]
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
function getHandler(handlerName) {
  return HANDLERS[handlerName] || null;
}

module.exports = { HANDLERS, getHandler };
