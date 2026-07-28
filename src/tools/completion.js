
import { readAudit } from '../audit.js';
import { resolveWorkspace } from '../config.js';
import { clearSessionPolicy, resolvePolicy } from '../policyResolver.js';
import { readTaskHistorySession } from '../taskHistoryStore.js';
import { sanitizeCompletionSummary } from '../taskObservability.js';
import { getCurrentToolActivityContext, requestCurrentTaskCompletion, taskError, normalizeTaskId } from '../toolActivity.js';
const CODE_MUTATING_TOOLS = new Set([
  'relai_edit',
  'relai_tidy_run',
  'relai_restore_paths',
  'relai_reset_workspace'
]);
function completeTask(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const requestedTaskId = normalizeTaskId(args.task_id || args.taskId);
  if (!requestedTaskId) {
    throw taskError('TASK_ID_REQUIRED', 'relai_complete_task requires the task_id returned by relai_start_task.');
  }
  const context = requireMatchingTaskContext(requestedTaskId);
  const previous = readTaskHistorySession(config, requestedTaskId);
  if (previous?.completionKnown === true || previous?.status === 'completed') {
    return finalizeDuplicateCompletion(config, workspace, context, previous);
  }

  const summary = normalizeCompletionSummary(args.summary);
  const taskEvents = readAudit(config, {
    limit: 10000,
    workspace: workspace.alias,
    taskId: requestedTaskId
  }).entries
    .filter(entry => entry && String(entry.taskId || '') === requestedTaskId)
    .sort((left, right) => eventTime(left) - eventTime(right));
  const mutationEvents = taskEvents.filter(entry => entry.ok !== false && eventMutatedCode(entry));
  const validation = findLatestPassedValidation(taskEvents);
  if (mutationEvents.length && !validation) {
    throw taskError(
      'INVALID_TASK_STATE',
      'Cannot complete this task: no successful final validation is recorded for this exact task_id. Run relai_run_checks with the same task_id, then retry completion.',
      { retryable: true }
    );
  }

  if (validation) {
    const validationAtMs = eventTime(validation);
    const workspaceEvents = readAudit(config, {
      limit: 10000,
      workspace: workspace.alias
    }).entries
      .filter(entry => entry && (!entry.workspace || entry.workspace === workspace.alias))
      .sort((left, right) => eventTime(left) - eventTime(right));
    const changedAfterValidation = mutationEvents.filter(entry => eventTime(entry) > validationAtMs);
    if (changedAfterValidation.length) {
      const tools = [...new Set(changedAfterValidation.map(entry => String(entry.tool || 'edit')))];
      throw taskError(
        'INVALID_TASK_STATE',
        `Cannot complete this task: its code changed after the last passed validation (${tools.join(', ')}). Run final validation again with the same task_id.`,
        { retryable: true }
      );
    }

    const conflictingWorkspaceChanges = workspaceEvents.filter(entry =>
      eventTime(entry) > validationAtMs &&
      entry.ok !== false &&
      String(entry.taskId || '') !== requestedTaskId &&
      eventMutatedCode(entry)
    );
    if (conflictingWorkspaceChanges.length) {
      const conflictingTaskIds = unique(conflictingWorkspaceChanges.map(entry => String(entry.taskId || '')).filter(Boolean));
      const error = taskError(
        'TASK_PERSISTENCE_CONFLICT',
        'Cannot complete this task: another logical task changed the shared workspace after this task was validated. Re-run validation for this task_id against the current workspace state.',
        { retryable: true }
      );
      error.conflictingTaskCount = conflictingTaskIds.length;
      throw error;
    }
  }

  const changedFiles = unique(taskEvents.flatMap(eventChangedFiles));
  return finalizeValidatedTask(config, workspace, {
    summary,
    validationStatus: validation ? 'passed' : 'not_required',
    validationLevel: validation?.validationLevel || '',
    validationAt: validation?.ts || '',
    changedFiles,
    completionSource: 'relai_complete_task'
  });
}

function finalizeValidatedTask(config, workspace, options = {}) {
  const summary = normalizeCompletionSummary(options.summary);
  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Task completion requires an active Rel.AI tool invocation.');
  }
  const taskId = normalizeTaskId(context.taskId);
  if (!taskId) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The active invocation has no valid logical task identity.');
  }
  const changedFiles = Array.isArray(options.changedFiles)
    ? unique(options.changedFiles.map(String).filter(Boolean))
    : changedFilesForTask(config, workspace.alias, taskId);
  const completionSource = String(options.completionSource || 'relai_complete_task');
  const validationStatus = String(options.validationStatus || 'passed');
  const completion = requestCurrentTaskCompletion({
    summary,
    validationStatus,
    validationLevel: String(options.validationLevel || ''),
    validationAt: String(options.validationAt || ''),
    changedFiles
  });
  clearSessionPolicy(config, workspace.alias, taskId);
  return {
    ok: true,
    workspace: workspace.alias,
    taskId: completion.taskId,
    task_id: completion.taskId,
    duplicate: completion.duplicate === true,
    completionKnown: true,
    endReason: 'explicit_completion',
    completionSource,
    summary,
    validationStatus,
    validationLevel: String(options.validationLevel || ''),
    validationAt: String(options.validationAt || ''),
    changedFiles,
    message: completionMessage(completionSource, completion.duplicate === true)
  };
}

function finalizeValidationResult(config, workspace, validationResult, summary) {
  const completion = finalizeValidatedTask(config, workspace, {
    summary,
    validationStatus: 'passed',
    validationLevel: validationResult.validationLevel,
    validationAt: new Date().toISOString(),
    completionSource: 'relai_run_checks'
  });
  return {
    ...validationResult,
    ...completion,
    policy: resolvePolicy(workspace, config),
    nextAction: 'Validation passed and explicit task completion was accepted. Do not call another Rel.AI tool for this completed task.'
  };
}

function finalizeDuplicateCompletion(config, workspace, context, previous) {
  const summary = String(previous.summary || '').trim() || 'Task already completed.';
  const completion = requestCurrentTaskCompletion({
    summary,
    validationStatus: previous.validation || 'passed',
    validationLevel: previous.validationLevel || '',
    validationAt: previous.validationAt || previous.completedAt || '',
    changedFiles: Array.isArray(previous.changedFiles) ? previous.changedFiles : []
  });
  clearSessionPolicy(config, workspace.alias, context.taskId);
  return {
    ok: true,
    workspace: workspace.alias,
    taskId: context.taskId,
    task_id: context.taskId,
    duplicate: true,
    completionKnown: true,
    endReason: 'explicit_completion',
    completionSource: 'relai_complete_task',
    summary,
    validationStatus: previous.validation || 'passed',
    validationLevel: previous.validationLevel || '',
    validationAt: previous.validationAt || previous.completedAt || '',
    changedFiles: Array.isArray(previous.changedFiles) ? previous.changedFiles : [],
    message: completion.duplicate === true
      ? 'Duplicate task completion request accepted; the task was already completing.'
      : 'Task was already completed. The original completion result is returned idempotently.'
  };
}

function requireMatchingTaskContext(taskId) {
  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Task completion requires an active Rel.AI tool invocation.');
  }
  if (context.taskId !== taskId) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The supplied task_id does not match the logical task bound to this invocation.');
  }
  return context;
}

function completionMessage(source, duplicate) {
  if (duplicate) return 'Duplicate task completion request accepted idempotently.';
  if (source === 'relai_run_checks') {
    return 'Validation passed and this logical task was completed in the same Rel.AI call. Other tasks remain unchanged.';
  }
  return 'Task completion accepted for this task_id. Other logical tasks remain active and unchanged.';
}

function normalizeCompletionSummary(value) {
  return sanitizeCompletionSummary(value, 2000);
}

function changedFilesForTask(config, workspaceAlias, taskId) {
  const events = readAudit(config, { limit: 10000, workspace: workspaceAlias, taskId }).entries
    .filter(entry => String(entry?.taskId || '') === taskId);
  return unique(events.flatMap(eventChangedFiles));
}

function eventMutatedCode(entry) {
  const tool = String(entry?.tool || '');
  if (tool === 'relai_exec') {
    return eventChangedFiles(entry).length > 0 || entry?.mutationTracking !== 'git';
  }
  return CODE_MUTATING_TOOLS.has(tool);
}

function findLatestPassedValidation(events) {
  return [...events].reverse().find(entry =>
    entry.tool === 'relai_run_checks' &&
    entry.ok !== false &&
    entry.validationStatus === 'passed'
  ) || null;
}

function eventChangedFiles(entry) {
  const values = [];
  if (Array.isArray(entry.changedFiles)) values.push(...entry.changedFiles);
  if (Array.isArray(entry.sessionChangedFiles)) values.push(...entry.sessionChangedFiles);
  if (entry.filePath) values.push(entry.filePath);
  return values.map(String).filter(Boolean);
}

function eventTime(entry) {
  const value = Date.parse(entry?.ts || entry?.at || entry?.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function unique(values) {
  return [...new Set(values)];
}

export { completeTask, finalizeValidatedTask, finalizeValidationResult, normalizeCompletionSummary, CODE_MUTATING_TOOLS, eventMutatedCode };
