// @ts-check
'use strict';

/** @typedef {import('../../types/boundaries').ToolHandler} ToolHandler */

const { resolveWorkspace } = require('../config');
const {
  repoSnapshot,
  relaiRead,
  relaiWrite,
  relaiReplace,
  workspaceTidyPlan,
  workspaceTidyRun,
  relaiVerify,
  relaiBrowser,
  relaiDiff,
  relaiReset,
  relaiGitStatus,
  relaiGitCommit,
  relaiGitPush,
  relaiGitCreatePr
} = require('../localRepoBridge');
const { planEdit } = require('../executionPlanner');
const { relaiStatus } = require('./status');
const { completeTask } = require('./completion');

/** @type {Readonly<Record<string, ToolHandler>>} */
const HANDLERS = Object.freeze({
  repoSnapshot: inWorkspace((workspace, config, args) => repoSnapshot(workspace, config, args)),
  read: inWorkspace((workspace, config, args, context) => relaiRead(workspace, config, args, context)),
  write: inWorkspace((workspace, config, args) => relaiWrite(workspace, config, args)),
  replace: inWorkspace((workspace, config, args) => relaiReplace(workspace, config, args)),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args) => relaiVerify(workspace, config, mapCheckArgs(args))),
  browser: inWorkspace((workspace, config, args) => relaiBrowser(workspace, config, { ...args, command: /** @type {{ command?: string, check?: string }} */ (args).command || /** @type {{ command?: string, check?: string }} */ (args).check })),
  diff: inWorkspace((workspace, config, args) => relaiDiff(workspace, config, args)),
  restore: inWorkspace((workspace, config, args) => relaiReset(workspace, config, args)),
  status: (config, args) => relaiStatus(config, args),
  gitStatus: inWorkspace((workspace, config, args) => relaiGitStatus(workspace, config, args)),
  gitCommit: inWorkspace((workspace, config, args) => relaiGitCommit(workspace, config, args)),
  gitPush: inWorkspace((workspace, config, args) => relaiGitPush(workspace, config, args)),
  gitCreatePr: inWorkspace((workspace, config, args) => relaiGitCreatePr(workspace, config, args)),
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
