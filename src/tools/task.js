
import * as crypto from 'node:crypto';
import { getCurrentToolActivityContext, getToolActivity, taskError } from '../toolActivity.js';
import { readTaskHistorySessionRecord } from '../taskHistoryStore.js';
import { principalFingerprint } from '../mcp/principal.js';
import { isTerminalTaskStatus } from '../taskState.js';
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
    nextAction: 'Use the bootstrap context to choose the next tool. Pass this work_id on every subsequent work-scoped Rel.AI call; the bound workspace may be omitted.'
  };
}

function taskBootstrapFromSnapshot(snapshot, mode = 'compact') {
  const common = {
    mode,
    manifests: snapshot.manifests,
    discoveredCommands: snapshot.discoveredCommands,
    projectInstructions: snapshot.projectInstructions,
    fileCount: snapshot.fileCount,
    files: snapshot.files,
    truncated: snapshot.truncated,
    hints: snapshot.hints,
    git: snapshot.git,
    recommendedFlow: snapshot.recommendedFlow
  };
  if (mode !== 'full') return common;
  return {
    ...common,
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
    throw taskError('TASK_NOT_FOUND', 'The supplied work_id is unknown or expired. Start a new work session with relai_begin_work.');
  }
  const expectedPrincipal = String(session.principalFingerprint || '');
  const actualPrincipal = principalFingerprint(principal || 'anonymous');
  if (!expectedPrincipal || !safeEqual(expectedPrincipal, actualPrincipal)) {
    throw taskError('TASK_NOT_FOUND', 'The supplied work_id is unknown or expired. Start a new work session with relai_begin_work.');
  }
  if (session.status === 'cancelled' && toolName === 'relai_cancel_work') return session;
  if (session.status === 'completed' && toolName === 'relai_finish_work') return session;
  if (isTerminalTaskStatus(session.status)) {
    throw taskError('INVALID_TASK_STATE', `This work session is already ${session.status}. Start a new work session instead of reusing its work_id.`);
  }
  const requestedWorkspace = String(workspace || '').trim();
  const ownedWorkspace = String(session.workspace || '').trim();
  if (requestedWorkspace && ownedWorkspace && requestedWorkspace !== ownedWorkspace) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The supplied work_id belongs to a different workspace.');
  }
  return session;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function taskAuditContext(context, activity, requestedTaskId, toolName, ok, value = null) {
  const duplicateCompletion = toolName === 'relai_finish_work' && value?.duplicate === true;
  const duplicateCancellation = toolName === 'relai_cancel_work' && value?.duplicate === true;
  const taskId = activity?.taskId || requestedTaskId || '';
  const taskHistoryEligible = Boolean(taskId && (requestedTaskId || toolName === 'relai_begin_work'));
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
    eventType: toolName === 'relai_begin_work'
      ? (ok ? 'task.started' : 'task.start.rejected')
      : toolName === 'relai_finish_work'
        ? (ok ? (duplicateCompletion ? 'task.completion.duplicate' : 'task.completion.committed') : 'task.completion.rejected')
        : toolName === 'relai_cancel_work'
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

export { startTask, taskBootstrapFromSnapshot, assertKnownTask, taskAuditContext, withTaskIdentity };
