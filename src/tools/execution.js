import * as path from 'node:path';

import { createValidationFingerprint } from '../bridge/validationPlan.js';
import { resolveWorkspace } from '../config.js';
import {
  finalizeTaskSandbox,
  findTaskSandbox,
  prepareTaskExecutionWorkspace,
  promoteTaskSandbox,
  resolveTaskSandboxWorkspace,
  shouldPromoteTaskSandbox
} from '../parallelTaskSandbox.js';
import { addSpanEvent, runSpan, setSpanAttributes } from '../telemetry.js';
import { getToolActivity, runWithToolActivity, taskError, updateCurrentToolActivity } from '../toolActivity.js';
import { runWorkspaceOperation } from '../workspaceOperationQueue.js';
import { finalizeValidationResult } from './completion.js';
import { invalidateSessionCacheForCall, maybeStartSession } from './session.js';

const SANDBOX_CREATE_OPERATIONS = new Set(['relai_edit', 'relai_exec']);

async function executeToolCall({ config, name, executionName = name, effectiveArgs, context, finishActivity, definition, started }) {
  let sessionStart = { started: false, alias: '' };
  const value = await runWithToolActivity(finishActivity, () => runSpan(config,
    executionName === 'relai_begin_work' ? 'relai.logical_task.start' : 'relai.tool.call',
    spanAttributes(name, effectiveArgs, context, finishActivity),
    async () => {
      const taskId = String(finishActivity?.taskId || effectiveArgs?.work_id || '').trim();
      const sourceWorkspace = effectiveArgs?.workspace ? resolveWorkspace(config, effectiveArgs.workspace) : null;
      const branchChange = isExplicitBranchChange(executionName, effectiveArgs);
      const hadSandbox = Boolean(sourceWorkspace && taskId && findTaskSandbox(config, sourceWorkspace.alias, taskId));
      let executionWorkspace = sourceWorkspace;

      if (sourceWorkspace && taskId && shouldPrepareSandbox(config, sourceWorkspace.alias, taskId, executionName)) {
        executionWorkspace = await runWorkspaceOperation(sourceWorkspace.alias, async () => {
          if (branchChange && findTaskSandbox(config, sourceWorkspace.alias, taskId)) {
            await finalizeTaskSandbox(sourceWorkspace, config, taskId);
            return sourceWorkspace;
          }
          return prepareTaskExecutionWorkspace(sourceWorkspace, config, taskId, executionName, {
            activeTasks: getToolActivity().tasks,
            forceSource: branchChange
          });
        }, queueOptions('write', 'workspace', taskId));
      }

      const sandboxEntry = executionWorkspace?.taskSandbox === true && sourceWorkspace
        ? findTaskSandbox(config, sourceWorkspace.alias, taskId)
        : null;
      const physicalArgs = executionWorkspace?.taskSandbox === true
        ? { ...effectiveArgs, workspace: executionWorkspace.alias }
        : effectiveArgs;
      const deferSandboxCompletion = executionWorkspace?.taskSandbox === true
        && executionName === 'relai_run_checks'
        && effectiveArgs?.complete === true;
      const handlerArgs = deferSandboxCompletion ? { ...physicalArgs, complete: false } : physicalArgs;

      const result = await runWorkspaceOperation(
        executionName === 'relai_cancel_work' ? '' : handlerArgs?.workspace,
        async () => {
          sessionStart = await maybeStartSession(config, executionName, effectiveArgs || {}, { taskId });
          if (typeof definition?.handler !== 'function') throw new Error(`Tool '${name}' has no executable handler.`);
          const handled = await definition.handler(config, handlerArgs || {}, {
            connector: Boolean(context?.publicHttpOnly),
            taskId,
            requestHeaders: context?.requestHeaders || {},
            mcp: context?.mcp || {},
            signal: context?.signal,
            principal: context?.principal,
            nativeTaskId: context?.nativeTaskId,
            transportType: context?.transportType,
            executionMode: context?.executionMode || '',
            cancel: context?.cancel || null,
            mutationBaselineCommit: sandboxEntry?.syncCommit || ''
          });
          if (handled && typeof handled === 'object' && !Array.isArray(handled) && handled.ok === false && handled.error?.code === 'CANCELLED') {
            context?.cancel?.throwIfCancelled?.();
          }
          setSpanAttributes({
            'relai.tool.ok': handled?.ok !== false,
            'relai.tool.duration_ms': Date.now() - started,
            'relai.tool.long_running': definition?.behavior?.longRunning === true
          });
          return handled;
        },
        queueOptions(
          definition?.annotations?.readOnlyHint === true ? 'read' : 'write',
          hadSandbox && executionName === 'relai_finish_work'
            ? 'workspace'
            : definition?.behavior?.concurrencyScope === 'workspace' ? 'workspace' : 'task',
          taskId
        )
      );

      if (executionWorkspace?.taskSandbox === true) {
        invalidateSessionCacheForCall(config, executionName, handlerArgs || {});
      }

      if (executionWorkspace?.taskSandbox === true && shouldPromoteTaskSandbox(executionName, result)) {
        await runWorkspaceOperation(sourceWorkspace.alias, () => promoteTaskSandbox(sourceWorkspace, config, taskId),
          queueOptions('write', 'workspace', taskId));
      }

      const visibleResult = mapVisibleWorkspace(result, executionWorkspace, sourceWorkspace);
      if (!deferSandboxCompletion || result?.ok !== true) return visibleResult;

      return runWorkspaceOperation(sourceWorkspace.alias, async () => {
        await promoteTaskSandbox(sourceWorkspace, config, taskId);
        const current = findTaskSandbox(config, sourceWorkspace.alias, taskId);
        if (!current) throw staleSandboxValidationError();
        const sandboxWorkspace = resolveTaskSandboxWorkspace(config, current.alias);
        const currentFingerprint = await createValidationFingerprint(sandboxWorkspace, config);
        if (currentFingerprint.fingerprint !== String(result.validationFingerprint || '')) {
          throw staleSandboxValidationError();
        }
        await finalizeTaskSandbox(sourceWorkspace, config, taskId);
        invalidateSessionCacheForCall(config, executionName, { ...effectiveArgs, workspace: sourceWorkspace.alias });
        return finalizeValidationResult(config, sourceWorkspace, visibleResult, effectiveArgs.summary);
      }, queueOptions('write', 'workspace', taskId));
    }, { carrier: context?.requestHeaders || {} }
  ));
  return { value, sessionStart };
}

function shouldPrepareSandbox(config, workspaceAlias, taskId, executionName) {
  if (executionName === 'relai_cancel_work') return false;
  return SANDBOX_CREATE_OPERATIONS.has(executionName)
    || Boolean(findTaskSandbox(config, workspaceAlias, taskId));
}

function mapVisibleWorkspace(result, executionWorkspace, sourceWorkspace) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (executionWorkspace?.taskSandbox !== true || !sourceWorkspace) return result;
  return result.workspace === executionWorkspace.alias
    ? { ...result, workspace: sourceWorkspace.alias }
    : result;
}

function isExplicitBranchChange(executionName, args = {}) {
  if (executionName !== 'relai_exec') return false;
  const executable = path.basename(String(args.executable || '')).toLowerCase();
  if (executable === 'git' || executable === 'git.exe') {
    return (Array.isArray(args.argv) ? args.argv : []).some(token => ['switch', 'checkout'].includes(String(token).toLowerCase()));
  }
  return /\bgit(?:\.exe)?\b[^\n;&|]*\b(?:switch|checkout)\b/i.test(String(args.command || ''));
}

function staleSandboxValidationError() {
  return taskError(
    'TASK_REVALIDATION_REQUIRED',
    'The visible workspace changed while this parallel task was validating. Its safe changes remain visible, but final validation must run again against the synchronized task state.',
    {
      retryable: true,
      allowedAlternatives: [
        'Run relai_validate with action "checks" again using the same work_id.',
        'Cancel the task only when the remaining work should not be completed.'
      ]
    }
  );
}

function queueOptions(mode, scope, taskId) {
  return {
    mode,
    scope,
    taskId,
    onWait: (waitMs, details) => {
      addSpanEvent('workspace.queue.admitted', {
        'relai.workspace': details.workspace,
        'relai.queue.mode': details.mode,
        'relai.queue.scope': details.scope,
        ...(details.taskId ? { 'relai.queue.work_id': details.taskId } : {}),
        'relai.queue.wait_ms': waitMs,
        'relai.queue.pending': details.queued
      });
      if (waitMs > 0) {
        updateCurrentToolActivity({
          currentStage: 'Workspace queue admitted',
          currentActivity: `Waited ${formatWait(waitMs)} for the workspace execution queue.`,
          metadata: { waitMs, queueMode: details.mode, queueScope: details.scope, queued: details.queued }
        });
      }
    }
  };
}

function spanAttributes(name, args, context, activity) {
  return {
    'relai.tool.name': name,
    'relai.workspace': String(args?.workspace || ''),
    'relai.task.id': String(activity?.taskId || args?.work_id || args?.taskId || ''),
    'relai.transport': String(context?.transportType || ''),
    'relai.client.name': String(context?.clientName || ''),
    'relai.client.version': String(context?.clientVersion || '')
  };
}

function formatWait(waitMs) {
  return waitMs < 1000 ? `${Math.max(0, Math.round(waitMs))} ms` : `${(waitMs / 1000).toFixed(1)} seconds`;
}

export { executeToolCall };
