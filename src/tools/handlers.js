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
import { runUiAction } from '../webAutomationManager.js';
import { relaiSemanticSearch } from '../bridge/semanticSearch.js';
import { repositoryIntelligence } from '../repository/intelligence/service.js';
import { relaiDiagnosticsRun } from '../bridge/diagnosticsRunner.js';
import { taskOwnedChangedFiles } from '../taskIntegrity.js';
import { readRecentWorkflowEvidence, readTaskHistorySessionRecord } from '../taskHistoryStore.js';
import { discoverRepositoryTopology, packageForPath } from '../workflow/topology.js';
const startTaskHandler = inWorkspace(async (workspace, config, args) => {
  const task = startTask(workspace, args);
  const bootstrapMode = String(args.bootstrap || 'compact').toLowerCase();
  if (bootstrapMode === 'none') return task;
  const snapshot = await repoSnapshot(workspace, config, {
    maxEntries: bootstrapMode === 'full' ? undefined : 600,
    includeFiles: true,
    instructionPath: args.instructionPath
  });
  const bootstrap = taskBootstrapFromSnapshot(snapshot, bootstrapMode);
  const cachedIntelligence = await repositoryIntelligence.cachedContext(workspace, config, { maxResults: 10 });
  if (cachedIntelligence) bootstrap.repositoryIntelligence = cachedIntelligence;
  return {
    ...task,
    bootstrap
  };
});

function scheduleIntelligenceWarmup(workspace, config) {
  void Promise.resolve()
    .then(() => repositoryIntelligence.ensure(workspace, config, { watch: false }))
    .catch(() => {});
}

const HANDLERS = Object.freeze({
  startTask: startTaskHandler,
  repoSnapshot: inWorkspace((workspace, config, args) => {
    scheduleIntelligenceWarmup(workspace, config);
    return repoSnapshot(workspace, config, args);
  }),
  read: inWorkspace((workspace, config, args, context) => relaiRead(workspace, config, args, context)),
  search: inWorkspace((workspace, config, args, context) => {
    scheduleIntelligenceWarmup(workspace, config);
    return relaiSearch(workspace, config, withWorkflowTaskContext(config, workspace, args, context), context);
  }),
  codeInspect: inWorkspace((workspace, config, args, context) => relaiCodeInspect(workspace, config, withWorkflowTaskContext(config, workspace, args, context), context)),
  exec: inWorkspace((workspace, config, args, context) => relaiExec(workspace, config, args, context)),
  processStart: inWorkspace((workspace, config, args, context) => startManagedProcess(workspace, config, args, context)),
  processRead: (config, args, context) => readManagedProcess(config, args, context),
  processWrite: (config, args, context) => writeManagedProcess(config, args, context),
  processStop: (config, args, context) => stopManagedProcess(config, args, context),
  processList: (config, args, context) => listManagedProcesses(config, args, context),
  ui: inWorkspace((workspace, config, args, context) => runUiAction(workspace, config, args, context)),
  semanticSearch: inWorkspace((workspace, config, args, context) => relaiSemanticSearch(workspace, config, args, context)),
  diagnosticsRun: inWorkspace((workspace, config, args, context) => relaiDiagnosticsRun(workspace, config, args, context)),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args, context) => relaiVerify(workspace, config, mapCheckArgs(args), context)),
  httpProbe: inWorkspace((workspace, config, args) => relaiHttpProbe(workspace, config, args)),
  diff: inWorkspace((workspace, config, args, context) => relaiDiff(workspace, config, withTaskOwnedReviewContext(config, workspace, args, context))),
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

function withWorkflowTaskContext(config, workspace, args, context = {}) {
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (!taskId) return args;
  let owned = [];
  let packagePaths = [];
  let impactedPaths = [];
  let readEvidence = [];
  try {
    owned = taskOwnedChangedFiles(config, taskId, workspace.alias);
    const topology = discoverRepositoryTopology(workspace.path);
    packagePaths = [...new Set(owned.map(file => packageForPath(topology, file)?.path).filter(value => value && value !== '.'))];
  } catch {}
  try {
    const session = readTaskHistorySessionRecord(config, taskId, { reconcileInactive: false });
    impactedPaths = Array.isArray(session?.workflow?.boundary?.impactedPaths)
      ? session.workflow.boundary.impactedPaths
      : Array.isArray(session?.workflow?.impactedPaths) ? session.workflow.impactedPaths : [];
  } catch {}
  try {
    readEvidence = readRecentWorkflowEvidence(config, taskId, 30)
      .flatMap(receipt => Array.isArray(receipt?.metadata?.reads) ? receipt.metadata.reads : [])
      .slice(-100);
  } catch {}
  return { ...args, _workflowContext: { taskOwnedPaths: owned, packagePaths, impactedPaths, readEvidence } };
}

function withTaskOwnedReviewContext(config, workspace, args, context = {}) {
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (!taskId) return args;
  return {
    ...args,
    _taskOwnedPaths: taskOwnedChangedFiles(config, taskId, workspace.alias)
  };
}
/**
 * @param {(workspace: any, config: Record<string, any>, args: Record<string, any>, context: { connector?: boolean, taskId?: string, requestHeaders?: Record<string, string> }) => any} handler
 */
function inWorkspace(handler) {
  /**
   * @param {Record<string, any>} config
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
