import * as path from 'node:path';

import { createValidationFingerprint } from '../bridge/validationPlan.js';
import { resolveWorkspace } from '../config.js';
import {
  finalizeTaskSandbox,
  findTaskSandbox,
  hasInactiveTaskSandboxes,
  prepareTaskExecutionWorkspace,
  promoteTaskSandbox,
  reconcileInactiveTaskSandboxes,
  resolveTaskSandboxWorkspace
} from '../parallelTaskSandbox.js';
import { addSpanEvent, runSpan, setSpanAttributes } from '../telemetry.js';
import { getToolActivity, runWithToolActivity, taskError, updateCurrentToolActivity } from '../toolActivity.js';
import { runWorkspaceOperation } from '../workspaceOperationQueue.js';
import { finalizeValidationResult } from './completion.js';
import { invalidateSessionCacheForCall, maybeStartSession } from './session.js';
import { OPERATION_IDS as OP } from './operationIds.js';

const SANDBOX_CREATE_OPERATIONS = new Set([OP.EDIT, OP.EXEC]);
const INACTIVE_RECONCILIATION_OPERATIONS = new Set([OP.WORK_BEGIN, OP.EDIT, OP.EXEC]);
const UNSAFE_READ_ONLY_GIT_OPTIONS = new Set([
  '--ext-diff', '--textconv', '--filters', '--open-files-in-pager'
]);

async function executeToolCall({ config, name, executionName = name, effectiveArgs, context, requestTaskContext = null, finishActivity, definition, started }) {
  let sessionStart = { started: false, alias: '' };
  const value = await runWithToolActivity(finishActivity, () => runSpan(config,
    executionName === OP.WORK_BEGIN ? 'relai.logical_task.start' : 'relai.tool.call',
    spanAttributes(name, effectiveArgs, context, finishActivity),
    async () => {
      const taskId = String(finishActivity?.taskId || effectiveArgs?.work_id || '').trim();
      const sourceWorkspace = effectiveArgs?.workspace ? resolveWorkspace(config, effectiveArgs.workspace) : null;
      const branchChange = isExplicitBranchChange(executionName, effectiveArgs);
      const activeTasks = sourceWorkspace ? getToolActivity().tasks : [];
      if (sourceWorkspace
        && taskId
        && shouldReconcileInactiveSandboxes(executionName, effectiveArgs)
        && hasInactiveTaskSandboxes(config, sourceWorkspace.alias, activeTasks, taskId)) {
        await runWorkspaceOperation(sourceWorkspace.alias, () =>
          reconcileInactiveTaskSandboxes(sourceWorkspace, config, getToolActivity().tasks, taskId),
        queueOptions('write', 'workspace', taskId));
      }
      const hadSandbox = Boolean(sourceWorkspace && taskId && findTaskSandbox(config, sourceWorkspace.alias, taskId));
      let executionWorkspace = sourceWorkspace;

      if (sourceWorkspace && taskId && shouldPrepareSandbox(config, sourceWorkspace.alias, taskId, executionName, effectiveArgs)) {
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
        && executionName === OP.VALIDATE_CHECKS
        && effectiveArgs?.complete === true;
      const handlerArgs = deferSandboxCompletion ? { ...physicalArgs, complete: false } : physicalArgs;

      let result;
      try {
        result = await runWorkspaceOperation(
          executionName === OP.WORK_CANCEL ? '' : handlerArgs?.workspace,
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
            requestTaskContext,
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
            hadSandbox && executionName === OP.WORK_FINISH
              ? 'workspace'
              : definition?.behavior?.concurrencyScope === 'workspace' ? 'workspace' : 'task',
            taskId
          )
        );
      } catch (error) {
        if (executionWorkspace?.taskSandbox === true
          && !deferSandboxCompletion
          && SANDBOX_CREATE_OPERATIONS.has(executionName)) {
          await runWorkspaceOperation(sourceWorkspace.alias, () => finalizeTaskSandbox(sourceWorkspace, config, taskId),
            queueOptions('write', 'workspace', taskId));
        }
        throw error;
      }

      if (executionWorkspace?.taskSandbox === true) {
        invalidateSessionCacheForCall(config, executionName, handlerArgs || {});
      }

      if (executionWorkspace?.taskSandbox === true
        && !deferSandboxCompletion
        && SANDBOX_CREATE_OPERATIONS.has(executionName)) {
        await runWorkspaceOperation(sourceWorkspace.alias, () => finalizeTaskSandbox(sourceWorkspace, config, taskId),
          queueOptions('write', 'workspace', taskId));
      }

      const visibleResult = mapVisibleWorkspace(result, executionWorkspace, sourceWorkspace);
      if (!deferSandboxCompletion || result?.ok !== true) return visibleResult;

      return runWorkspaceOperation(sourceWorkspace.alias, async () => {
        await promoteTaskSandbox(sourceWorkspace, config, taskId);
        const current = findTaskSandbox(config, sourceWorkspace.alias, taskId);
        if (!current) throw staleSandboxValidationError();
        const sandboxWorkspace = resolveTaskSandboxWorkspace(config, current.alias);
        const currentFingerprint = await createValidationFingerprint(sandboxWorkspace, config, {
          paths: Array.isArray(result.validationScope) ? result.validationScope : []
        });
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

function shouldPrepareSandbox(config, workspaceAlias, taskId, executionName, args = {}) {
  if (executionName === OP.WORK_CANCEL || executionName === OP.WORK_STATUS) return false;
  if (findTaskSandbox(config, workspaceAlias, taskId)) return true;
  if (!SANDBOX_CREATE_OPERATIONS.has(executionName)) return false;
  return executionName !== OP.EXEC || !isClearlyReadOnlyExec(args);
}

function shouldReconcileInactiveSandboxes(executionName, args = {}) {
  if (!INACTIVE_RECONCILIATION_OPERATIONS.has(executionName)) return false;
  return executionName !== OP.EXEC || !isClearlyReadOnlyExec(args);
}

function isClearlyReadOnlyExec(args = {}) {
  if (String(args.command || '').trim()) return false;
  if (String(args.input || '').length > 0) return false;
  if (args.env && typeof args.env === 'object' && Object.keys(args.env).length > 0) return false;
  const executable = path.basename(String(args.executable || '')).toLowerCase();
  const argv = Array.isArray(args.argv) ? args.argv.map(value => String(value || '')) : [];
  if (!argv.length) return false;
  if (executable === 'node' || executable === 'node.exe') {
    const first = argv[0].toLowerCase();
    if (['--version', '-v', '--help', '-h'].includes(first)) return argv.length === 1;
    return ['--check', '-c'].includes(first) && argv.length === 2 && !argv[1].startsWith('-');
  }
  if (executable !== 'git' && executable !== 'git.exe') return false;
  if (argv[0].startsWith('-')) return false;
  const optionTokens = argv.slice(1).map(value => value.toLowerCase());
  if (optionTokens.some(value => UNSAFE_READ_ONLY_GIT_OPTIONS.has(value)
    || value === '--output'
    || value.startsWith('--output='))) return false;
  const command = argv[0].toLowerCase();
  if (new Set([
    'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree',
    'cat-file', 'grep', 'blame', 'shortlog', 'describe', 'merge-base', 'name-rev'
  ]).has(command)) return true;
  if (command === 'branch') {
    const options = optionTokens;
    return options.length === 0 || options.every(value => ['--show-current', '--list', '-a', '-r'].includes(value));
  }
  if (command === 'worktree') return argv.length === 2 && argv[1]?.toLowerCase() === 'list';
  if (command === 'remote') return argv.length === 1 || optionTokens.every(value => value === '-v' || value === '--verbose');
  if (command === 'config') {
    const mode = String(argv[1] || '').toLowerCase();
    if (!['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(mode)) return false;
    return argv.slice(2).every(value => !String(value).startsWith('-'));
  }
  return false;
}

function mapVisibleWorkspace(result, executionWorkspace, sourceWorkspace) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (executionWorkspace?.taskSandbox !== true || !sourceWorkspace) return result;
  return result.workspace === executionWorkspace.alias
    ? { ...result, workspace: sourceWorkspace.alias }
    : result;
}

function isExplicitBranchChange(executionName, args = {}) {
  if (executionName !== OP.EXEC) return false;
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
