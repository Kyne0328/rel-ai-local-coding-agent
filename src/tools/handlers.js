import { setTimeout as setNodeTimeout } from 'node:timers';

// @ts-check


import { resolveWorkspace } from '../config.js';
import { repoSnapshot, relaiReadAsync, workspaceTidyPlan, workspaceTidyRun, relaiVerify, relaiHttpProbe, relaiDiff, relaiRestorePaths, relaiResetWorkspace, relaiGitCommit, relaiGitPush, relaiGitDraftPr } from '../localRepoBridge.js';
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
import { releaseTaskChangedFiles, taskCommitOwnership, taskOwnedChangedFiles } from '../taskIntegrity.js';
import { readRecentWorkflowEvidence, readRelevantTaskEpisodes, readTaskHistorySessionRecord } from '../taskHistoryStore.js';
import { selectRelevantSkills } from '../skillDiscovery.js';
import { buildTaskContinuity, rankBootstrapGroups } from '../context/taskContinuity.js';
import { knowledgeSettings } from '../knowledgeStore.js';
import { discoverRepositoryTopology, packageForPath } from '../workflow/topology.js';
import { createReviewCheckpoint, replayReviewCheckpoint } from '../reviewCheckpoints.js';
const startTaskHandler = inWorkspace(async (workspace, config, args, context) => {
  const task = startTask(workspace, args);
  const bootstrapMode = String(args.bootstrap || 'compact').toLowerCase();
  if (bootstrapMode === 'none') {
    scheduleIntelligenceWarmup(workspace, config);
    return task;
  }
  const snapshot = await repoSnapshot(workspace, config, {
    maxEntries: bootstrapMode === 'full' ? undefined : 64,
    includeFiles: bootstrapMode === 'full',
    instructionPath: args.instructionPath
  });
  const taskQuery = [task.objective, task.title].filter(Boolean).join(' ');
  const hostContextSummary = String(args.contextSummary || '').trim().slice(0, 3000);
  const suggestedSkills = selectRelevantSkills(snapshot.skills, taskQuery, { limit: 3 });
  const relatedTasks = readRelevantTaskEpisodes(config, workspace.alias, taskQuery, { excludeTaskId: task.work_id, limit: 3 });
  const continuity = buildTaskContinuity(config, {
    workspace: workspace.alias,
    query: taskQuery,
    excludeTaskId: task.work_id,
    conversationId: context?.conversationId
  });
  const supplemental = rankBootstrapGroups(taskQuery, {
    suggestedSkills,
    relatedTasks,
    ...continuity
  }, knowledgeSettings(config).maxBootstrapBytes);
  const baseBootstrap = taskBootstrapFromSnapshot(snapshot, bootstrapMode);
  let cachedIntelligence = null;
  try {
    cachedIntelligence = bootstrapMode === 'full'
      ? await repositoryIntelligence.cachedContext(workspace, config, { maxResults: 10 })
      : await repositoryIntelligence.cachedSummary(workspace, config);
  } catch {}
  const bootstrap = {
    ...baseBootstrap,
    ...supplemental,
    ...(hostContextSummary ? { hostContextSummary } : {}),
    ...(cachedIntelligence ? { repositoryIntelligence: cachedIntelligence } : {})
  };
  if (bootstrapMode === 'full') {
    const result = { ...task, bootstrap };
    scheduleIntelligenceWarmup(workspace, config);
    return result;
  }
  const result = { ...task, bootstrap };
  scheduleIntelligenceWarmup(workspace, config);
  return result;
});

function scheduleIntelligenceWarmup(workspace, config) {
  if (process.env.REL_AI_REDUCED_BACKGROUND_WORK === '1') return;
  const timer = setNodeTimeout(() => {
    void repositoryIntelligence.ensure(workspace, config, { watch: false }).catch(() => {});
  }, 0);
  timer.unref();
}

const HANDLERS = Object.freeze({
  startTask: startTaskHandler,
  repoSnapshot: inWorkspace(async (workspace, config, args) => {
    const result = await repoSnapshot(workspace, config, args);
    scheduleIntelligenceWarmup(workspace, config);
    return result;
  }),
  read: inWorkspace((workspace, config, args, context) => relaiReadAsync(workspace, config, args, context)),
  search: inWorkspace(async (workspace, config, args, context) => {
    const result = await relaiSearch(workspace, config, withWorkflowTaskContext(config, workspace, args, context), context);
    scheduleIntelligenceWarmup(workspace, config);
    return result;
  }),
  codeInspect: inWorkspace((workspace, config, args, context) => relaiCodeInspect(workspace, config, withWorkflowTaskContext(config, workspace, args, context), context)),
  exec: inWorkspace((workspace, config, args, context) => relaiExec(workspace, config, args, context)),
  processStart: inWorkspace((workspace, config, args, context) => startManagedProcess(workspace, config, args, context)),
  processRead: (config, args, context) => readManagedProcess(config, args, context),
  processWrite: (config, args, context) => writeManagedProcess(config, args, context),
  processStop: (config, args, context) => stopManagedProcess(config, args, context),
  processList: (config, args, context) => listManagedProcesses(config, args, context),
  ui: inWorkspace((workspace, config, args, context) => runUiAction(workspace, config, args, context)),
  semanticSearch: inWorkspace((workspace, config, args, context) => relaiSemanticSearch(workspace, config, withWorkflowTaskContext(config, workspace, args, context), context)),
  diagnosticsRun: inWorkspace((workspace, config, args, context) => relaiDiagnosticsRun(workspace, config, args, context)),
  tidyPlan: inWorkspace((workspace, config, args) => workspaceTidyPlan(workspace, config, args)),
  tidyRun: inWorkspace((workspace, config, args) => workspaceTidyRun(workspace, config, args)),
  runChecks: inWorkspace((workspace, config, args, context) => relaiVerify(workspace, config, mapCheckArgs(args), context)),
  httpProbe: inWorkspace((workspace, config, args) => relaiHttpProbe(workspace, config, args)),
  diff: inWorkspace((workspace, config, args, context) => relaiDiff(workspace, config, withTaskOwnedReviewContext(config, workspace, args, context))),
  reviewCheckpoint: inWorkspace(async (workspace, config, args, context) => {
    const review = await relaiDiff(workspace, config, withTaskOwnedReviewContext(config, workspace, args, context));
    return createReviewCheckpoint(workspace, config, review);
  }),
  reviewReplay: inWorkspace((workspace, config, args) => replayReviewCheckpoint(workspace, config, args.checkpointId)),
  restorePaths: inWorkspace((workspace, config, args) => relaiRestorePaths(workspace, config, args)),
  resetWorkspace: inWorkspace((workspace, config, args) => relaiResetWorkspace(workspace, config, args)),
  status: relaiStatus,
  gitCommit: inWorkspace(async (workspace, config, args, context) => {
    const commitArgs = withTaskOwnedCommitContext(config, workspace, args, context);
    const result = await relaiGitCommit(workspace, config, commitArgs);
    if (result?.ok === true && commitArgs._taskId && Array.isArray(result.paths) && result.paths.length) {
      releaseTaskChangedFiles(config, commitArgs._taskId, workspace.alias, result.paths);
    }
    return result;
  }),
  gitPush: inWorkspace((workspace, config, args) => relaiGitPush(workspace, config, args)),
  gitDraftPr: inWorkspace((workspace, config, args) => relaiGitDraftPr(workspace, config, args)),
  edit: inWorkspace((workspace, config, args, context) => planEdit(workspace, config, args, context)),
  cancelTask,
  completeTask
});

function withWorkflowTaskContext(config, workspace, args, context = {}) {
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (!taskId) return args;
  const requestState = requestTaskState(context, taskId);
  let owned = Array.isArray(requestState?.integrity?.taskOwnedChangedFiles)
    ? [...requestState.integrity.taskOwnedChangedFiles]
    : [];
  let packagePaths = [];
  let impactedPaths = [];
  let readEvidence = [];
  try {
    if (!requestState?.integrity) owned = taskOwnedChangedFiles(config, taskId, workspace.alias);
    const topology = requestState?.topology || discoverRepositoryTopology(workspace.path);
    if (requestState && !requestState.topology) requestState.topology = topology;
    packagePaths = [...new Set(owned.map(file => packageForPath(topology, file)?.path).filter(value => value && value !== '.'))];
  } catch {}
  try {
    const session = requestState?.session || readTaskHistorySessionRecord(config, taskId, { reconcileInactive: false });
    if (requestState && !requestState.session) requestState.session = session;
    impactedPaths = Array.isArray(session?.workflow?.boundary?.impactedPaths)
      ? session.workflow.boundary.impactedPaths
      : Array.isArray(session?.workflow?.impactedPaths) ? session.workflow.impactedPaths : [];
  } catch {}
  try {
    const evidence = requestState?.workflowContextEvidence || readRecentWorkflowEvidence(config, taskId, 30);
    if (requestState && !requestState.workflowContextEvidence) requestState.workflowContextEvidence = evidence;
    readEvidence = evidence
      .flatMap(receipt => Array.isArray(receipt?.metadata?.reads) ? receipt.metadata.reads : [])
      .slice(-100);
  } catch {}
  return { ...args, _workflowContext: { taskOwnedPaths: owned, packagePaths, impactedPaths, readEvidence } };
}

function withTaskOwnedReviewContext(config, workspace, args, context = {}) {
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (!taskId) return args;
  const requestState = requestTaskState(context, taskId);
  if (Array.isArray(requestState?.integrity?.taskOwnedChangedFiles)) {
    return { ...args, _taskOwnedPaths: [...requestState.integrity.taskOwnedChangedFiles] };
  }
  try {
    return { ...args, _taskOwnedPaths: taskOwnedChangedFiles(config, taskId, workspace.alias) };
  } catch {
    return args;
  }
}

function withTaskOwnedCommitContext(config, workspace, args, context = {}) {
  const taskId = String(context.taskId || args.work_id || '').trim();
  if (!taskId) return args;
  const ownership = taskCommitOwnership(config, taskId, workspace.alias);
  return {
    ...args,
    _taskId: taskId,
    _taskOwnedPaths: ownership.ownedFiles,
    _taskConflictingPaths: ownership.conflictingFiles
  };
}

function requestTaskState(context, taskId) {
  const state = context?.requestTaskContext;
  return state && state.taskId === taskId ? state : null;
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
