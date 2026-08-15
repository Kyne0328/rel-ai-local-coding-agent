import { resolveWorkspace } from '../config.js';
import { clearSessionPolicy, resolvePolicy } from '../policyResolver.js';
import { finalizeTaskSandbox, findTaskSandbox, resolveTaskSandboxWorkspace } from '../parallelTaskSandbox.js';
import { readTaskHistorySession } from '../taskHistoryStore.js';
import { readTaskIntegrity, readWorkspaceIntegrity } from '../taskIntegrity.js';
import { createValidationFingerprint } from '../bridge/validationPlan.js';
import { sanitizeCompletionSummary } from '../taskObservability.js';
import { getCurrentToolActivityContext, requestCurrentTaskCompletion, taskError, normalizeTaskId } from '../toolActivity.js';

const WORK_FINISH_SOURCE = 'relai_work:finish';
const VALIDATE_CHECKS_SOURCE = 'relai_validate:checks';

async function completeTask(config, args = {}) {
  const workspace = resolveWorkspace(config, args.workspace);
  const requestedTaskId = normalizeTaskId(args.work_id);
  if (!requestedTaskId) {
    throw taskError('TASK_ID_REQUIRED', 'relai_work with action "finish" requires the work_id returned by relai_work with action "begin".');
  }
  const context = requireMatchingTaskContext(requestedTaskId);
  const previous = readTaskHistorySession(config, requestedTaskId);
  if (previous?.completionKnown === true || previous?.status === 'completed') {
    return finalizeDuplicateCompletion(config, workspace, context, previous);
  }
  if (previous?.status === 'cancelled' || previous?.status === 'failed') {
    throw taskError(
      'INVALID_TASK_STATE',
      `Cannot complete a work session whose terminal status is '${previous.status}'. Start a new work session for additional work.`,
      { retryable: false }
    );
  }

  const summary = normalizeCompletionSummary(args.summary);
  const authority = readTaskIntegrity(config, requestedTaskId, workspace.alias);
  if (!authority) {
    throw taskError(
      'TASK_INTEGRITY_STATE_MISSING',
      'Cannot complete this logical task because its authoritative integrity state is missing. Start a new logical task; do not reconstruct completion safety from audit history.',
      { retryable: false }
    );
  }
  const mutationGeneration = Number(authority.mutationGeneration || 0);
  const validatedMutationGeneration = Number(authority.latestValidatedMutationGeneration || 0);
  if (mutationGeneration > 0 && authority.hasPassedValidation === true && validatedMutationGeneration !== mutationGeneration) {
    throw taskError(
      'TASK_REVALIDATION_REQUIRED',
      'Work-session completion is paused because code changed after the last passed validation. Run relai_validate with action "checks" with complete:true, summary, and the same work_id to validate and close the work session atomically.',
      {
        retryable: true,
        allowedAlternatives: [
          'Run relai_validate with action "checks" with complete:true, summary, and the same work_id.',
          'Cancel the task only when the remaining changes should not be completed.'
        ]
      }
    );
  }

  if (mutationGeneration > 0 && authority.validationResult !== 'passed') {
    throw taskError(
      'TASK_VALIDATION_REQUIRED',
      'Work-session completion is paused because no successful final validation is recorded for this exact work_id. Run relai_validate with action "checks" with complete:true, summary, and the same work_id to validate and close the work session atomically.',
      {
        retryable: true,
        allowedAlternatives: [
          'Run relai_validate with action "checks" with complete:true, summary, and the same work_id.',
          'Cancel the task only when the unvalidated changes should not be completed.'
        ]
      }
    );
  }

  if (authority.validationResult === 'passed') {
    const workspaceState = readWorkspaceIntegrity(config, workspace.alias);
    const validatedWorkspaceGeneration = Number(authority.validatedWorkspaceGeneration || 0);
    if (Number(workspaceState.generation || 0) > validatedWorkspaceGeneration) {
      const error = taskError(
        'TASK_PERSISTENCE_CONFLICT',
        'Work-session completion is paused because another work session changed the shared workspace after this work session was validated. Re-run validation for this work_id against the current workspace state.',
        {
          retryable: true,
          allowedAlternatives: [
            'Run relai_validate with action "checks" with complete:true, summary, and this work_id against the current workspace state.',
            'Cancel this task only when it should not be completed against the shared workspace.'
          ]
        }
      );
      error.conflictingTaskCount = workspaceState.lastMutation?.taskId && workspaceState.lastMutation.taskId !== requestedTaskId ? 1 : 0;
      throw error;
    }
    const validatedFingerprint = String(authority.validatedRepositoryFingerprint || authority.validationFingerprint || '');
    if (validatedFingerprint) {
      const sandbox = findTaskSandbox(config, workspace.alias, requestedTaskId);
      const validationWorkspace = sandbox ? resolveTaskSandboxWorkspace(config, sandbox.alias) : workspace;
      const currentFingerprint = await createValidationFingerprint(validationWorkspace, config);
      if (currentFingerprint.fingerprint !== validatedFingerprint) {
        throw taskError(
          'TASK_REVALIDATION_REQUIRED',
          'Work-session completion is paused because relevant workspace content changed after the last passed validation. Re-run validation with the same work_id against the current content.',
          {
            retryable: true,
            allowedAlternatives: [
              'Run relai_validate with action "checks" with complete:true, summary, and the same work_id.',
              'Cancel the task only when the changed workspace should not be completed.'
            ]
          }
        );
      }
    }
  }

  if (findTaskSandbox(config, workspace.alias, requestedTaskId)) {
    await finalizeTaskSandbox(workspace, config, requestedTaskId);
  }

  return finalizeValidatedTask(config, workspace, {
    summary,
    validationStatus: authority.validationResult === 'passed' ? 'passed' : 'not_required',
    validationLevel: authority.validationLevel || '',
    validationAt: authority.validationAt || '',
    validationFingerprint: authority.validatedRepositoryFingerprint || authority.validationFingerprint || '',
    changedFiles: authority.taskOwnedChangedFiles || [],
    completionSource: WORK_FINISH_SOURCE
  });
}

function finalizeValidatedTask(config, workspace, options = {}) {
  const summary = normalizeCompletionSummary(options.summary);
  const context = getCurrentToolActivityContext();
  if (!context?.taskId) {
    throw taskError('CONNECTION_CONTEXT_UNAVAILABLE', 'Work-session completion requires an active Rel.AI tool invocation.');
  }
  const taskId = normalizeTaskId(context.taskId);
  if (!taskId) {
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The active invocation has no valid logical task identity.');
  }
  const changedFiles = Array.isArray(options.changedFiles)
    ? unique(options.changedFiles.map(String).filter(Boolean))
    : changedFilesForTask(config, workspace.alias, taskId);
  const completionSource = String(options.completionSource || WORK_FINISH_SOURCE);
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
    work_id: completion.taskId,
    duplicate: completion.duplicate === true,
    completionKnown: true,
    endReason: 'explicit_completion',
    completionSource,
    summary,
    validationStatus,
    validationLevel: String(options.validationLevel || ''),
    validationAt: String(options.validationAt || ''),
    validationFingerprint: String(options.validationFingerprint || ''),
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
    validationFingerprint: validationResult.validationFingerprint,
    completionSource: VALIDATE_CHECKS_SOURCE
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
    work_id: context.taskId,
    duplicate: true,
    completionKnown: true,
    endReason: 'explicit_completion',
    completionSource: WORK_FINISH_SOURCE,
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
    throw taskError('TASK_OWNERSHIP_MISMATCH', 'The supplied work_id does not match the logical task bound to this invocation.');
  }
  return context;
}

function completionMessage(source, duplicate) {
  if (duplicate) return 'Duplicate work-session completion request accepted idempotently.';
  if (source === VALIDATE_CHECKS_SOURCE) {
    return 'Validation passed and this work session was completed in the same Rel.AI call. Other work sessions remain unchanged.';
  }
  return 'Work-session completion accepted for this work_id. Other work sessions remain active and unchanged.';
}

function normalizeCompletionSummary(value) {
  return sanitizeCompletionSummary(value, 2000);
}

function changedFilesForTask(config, workspaceAlias, taskId) {
  return readTaskIntegrity(config, taskId, workspaceAlias)?.taskOwnedChangedFiles || [];
}

function unique(values) {
  return [...new Set(values)];
}

export { completeTask,  finalizeValidationResult, normalizeCompletionSummary,   };
