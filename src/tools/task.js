
import * as crypto from 'node:crypto';
import { getCurrentToolActivityContext, getToolActivity, taskError } from '../toolActivity.js';
import { readTaskHistorySessionRecord } from '../taskHistoryStore.js';
import { principalFingerprint } from '../mcp/principal.js';
import { isTerminalTaskStatus } from '../taskState.js';
import { classifyTaskIntent } from '../workflow/intent.js';
import { OPERATION_IDS as OP } from './operationIds.js';

const TERMINAL_REFERENCE_OPERATIONS = new Set([OP.PROCESS_LIST, OP.PROCESS_READ, OP.WORK_STATUS]);
function startTask(workspace, args = {}) {
  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Rel.AI could not create a work session for this request.');
  }
  return {
    ok: true,
    workspace: workspace.alias,
    work_id: context.taskId,
    status: 'planning',
    identity: 'work_session',
    workspaceBinding: { alias: workspace.alias },
    title: String(args.title || context.title || '').trim() || undefined,
    objective: String(args.objective || context.objective || '').trim() || undefined,
    intent: classifyTaskIntent(args.objective || context.objective),
    nextAction: 'Use the bootstrap context for the first action, then use each returned workflow recommendation as the default calibration. Pass this work_id on every work-scoped Rel.AI call; hard runtime errors remain authoritative.'
  };
}

function taskBootstrapFromSnapshot(snapshot, mode = 'compact') {
  const common = {
    mode,
    manifests: snapshot.manifests,
    discoveredCommands: snapshot.discoveredCommands,
    projectInstructions: snapshot.projectInstructions,
    truncated: snapshot.truncated,
    hints: snapshot.hints,
    git: snapshot.git,
    recommendedFlow: snapshot.recommendedFlow
  };
  if (mode !== 'full') {
    return {
      ...common,
      ...(snapshot.truncated ? {} : { fileCount: snapshot.fileCount })
    };
  }
  return {
    ...common,
    fileCount: snapshot.fileCount,
    files: snapshot.files,
    manifestContents: snapshot.manifestContents,
    skipped: snapshot.skipped,
    writeGuidance: snapshot.writeGuidance,
    operationJournal: snapshot.operationJournal
  };
}

function assertKnownTask(config, taskId, workspace, toolName, principal) {
  const activeTaskIds = new Set(getToolActivity().tasks.map(task => String(task.id || task.taskId || '')).filter(Boolean));
  const session = readTaskHistorySessionRecord(config, taskId, {
    reconcileInactive: true,
    activeTaskIds
  });
  if (!session) {
    throw taskError('TASK_NOT_FOUND', 'The supplied work_id is unknown or expired. Start a new work session with relai_work action "begin".');
  }
  const expectedPrincipal = String(session.principalFingerprint || '');
  const actualPrincipal = principalFingerprint(principal || 'anonymous');
  if (!expectedPrincipal || !safeEqual(expectedPrincipal, actualPrincipal)) {
    throw taskError('TASK_NOT_FOUND', 'The supplied work_id is unknown or expired. Start a new work session with relai_work action "begin".');
  }
  if (session.status === 'cancelled' && toolName === OP.WORK_CANCEL) return session;
  if (session.status === 'completed' && toolName === OP.WORK_FINISH) return session;
  if (isTerminalTaskReference(session, toolName)) return session;
  if (isTerminalTaskStatus(session.status)) {
    throw taskError('INVALID_TASK_STATE', `This work session is already ${session.status}. Start a new work session instead of reusing its work_id.`);
  }
  assertTaskWorkspaceOwnership(session, workspace);
  return session;
}

function assertTaskWorkspaceOwnership(session, workspace) {
  const requestedWorkspace = String(workspace || '').trim();
  const ownedWorkspace = String(session?.workspace || '').trim();
  if (requestedWorkspace && ownedWorkspace && requestedWorkspace !== ownedWorkspace) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The supplied work_id belongs to a different workspace.');
  }
}

function isTerminalTaskReference(session, toolName) {
  return isTerminalTaskStatus(session?.status) && TERMINAL_REFERENCE_OPERATIONS.has(String(toolName || ''));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function taskAuditContext(context, activity, requestedTaskId, toolName, ok, value = null) {
  const duplicateCompletion = toolName === OP.WORK_FINISH && value?.duplicate === true;
  const duplicateCancellation = toolName === OP.WORK_CANCEL && value?.duplicate === true;
  const taskId = activity?.taskId || requestedTaskId || '';
  const taskHistoryEligible = Boolean(taskId && (requestedTaskId || toolName === OP.WORK_BEGIN));
  return {
    taskId,
    scopeId: activity?.scopeId || '',
    operationId: activity?.operationId || '',
    requestId: context?.requestId == null ? '' : String(context.requestId),
    serverInstanceId: String(context?.serverInstanceId || ''),
    transportType: String(context?.transportType || ''),
    transportSessionId: String(context?.transportSessionId || ''),
    clientName: String(context?.clientName || ''),
    clientVersion: String(context?.clientVersion || ''),
    initializationRequestId: context?.initializationRequestId == null ? '' : String(context.initializationRequestId),
    taskIdentityVersion: taskHistoryEligible ? 2 : 0,
    taskIdExplicit: taskHistoryEligible,
    taskHistoryEligible,
    duplicateRequest: duplicateCompletion || duplicateCancellation,
    eventType: toolName === OP.WORK_BEGIN
      ? (ok ? 'task.started' : 'task.start.rejected')
      : toolName === OP.WORK_FINISH
        ? (ok ? (duplicateCompletion ? 'task.completion.duplicate' : 'task.completion.committed') : 'task.completion.rejected')
        : toolName === OP.WORK_CANCEL
          ? (ok ? (duplicateCancellation ? 'task.cancellation.duplicate' : 'task.cancellation.committed') : 'task.cancellation.rejected')
          : 'tool.call.completed'
  };
}

function withTaskIdentity(value, taskId) {
  const identity = String(taskId || '').trim();
  if (!identity) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value, work_id: identity };
  return { ok: true, value, work_id: identity };
}

export { startTask, taskBootstrapFromSnapshot, assertKnownTask, assertTaskWorkspaceOwnership, isTerminalTaskReference, taskAuditContext, withTaskIdentity };
