import * as path from 'node:path';

import { createValidationFingerprint } from '../bridge/validationPlan.js';
import { resolveWorkspace } from '../config.js';
import { fallbackExecutionStatus } from '../mcp/fallbackExecutions.js';
import {
  finalizeTaskSandbox,
  findTaskSandbox,
  hasRecoverableTaskSandboxes,
  prepareTaskExecutionWorkspace,
  promoteTaskSandbox,
  reconcileRecoverableTaskSandboxes,
  resolveTaskSandboxWorkspace,
  shouldPromoteTaskSandbox
} from '../parallelTaskSandbox.js';
import { addSpanEvent, runSpan, setSpanAttributes } from '../telemetry.js';
import { readTaskHistorySessionRecord } from '../taskHistoryStore.js';
import { getToolActivity, runWithToolActivity, taskError, updateCurrentToolActivity } from '../toolActivity.js';
import { hasPendingTaskWriter, runWorkspaceOperation } from '../workspaceOperationQueue.js';
import { finalizeValidationResult } from './completion.js';
import { invalidateSessionCacheForCall, maybeStartSession } from './session.js';
import { OPERATION_IDS as OP } from './operationIds.js';

const SANDBOX_CREATE_OPERATIONS = new Set([OP.EDIT, OP.EXEC]);
const RECOVERABLE_SANDBOX_RECONCILIATION_OPERATIONS = new Set([OP.WORK_BEGIN, OP.EDIT, OP.EXEC]);
const STABLE_READ_DURING_TASK_WRITE_OPERATIONS = new Set([
  OP.SNAPSHOT,
  OP.READ,
  OP.SEARCH_TEXT,
  OP.SEARCH_SEMANTIC,
  OP.INSPECT
]);
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
      const backgroundStatusMode = executionName === OP.WORK_STATUS
        && Boolean(taskId)
        && fallbackExecutionStatus(taskId)?.status === 'running';
      const sourceWorkspace = effectiveArgs?.workspace ? resolveWorkspace(config, effectiveArgs.workspace) : null;
      const branchChange = isExplicitBranchChange(executionName, effectiveArgs);
      const activeTasks = sourceWorkspace ? getToolActivity().tasks : [];
      if (sourceWorkspace
        && taskId
        && shouldReconcileRecoverableSandboxes(executionName, effectiveArgs)
        && hasRecoverableTaskSandboxes(config, sourceWorkspace.alias, activeTasks, taskId)) {
        await runWorkspaceOperation(sourceWorkspace.alias, () =>
          reconcileRecoverableTaskSandboxes(sourceWorkspace, config, getToolActivity().tasks, taskId),
        queueOptions('write', 'workspace', taskId, context?.signal));
      }
      const existingSandbox = sourceWorkspace && taskId
        ? findTaskSandbox(config, sourceWorkspace.alias, taskId)
        : null;
      const hadSandbox = Boolean(existingSandbox);
      const stableSourceRead = shouldReadStableSourceDuringTaskWrite(executionName, definition, existingSandbox, taskId);
      let executionWorkspace = sourceWorkspace;

      if (stableSourceRead) {
        addSpanEvent('workspace.queue.stable_source_read', {
          'relai.workspace': sourceWorkspace.alias,
          'relai.task_id': taskId,
          'relai.operation': executionName
        });
        updateCurrentToolActivity({
          currentStage: 'Reading stable visible workspace',
          currentActivity: 'A private task operation is still writing. This inspection is reading the synchronized visible workspace instead of waiting on the mutating sandbox.',
          metadata: { stableSourceRead: true, operation: executionName }
        });
      } else if (sourceWorkspace && taskId && shouldPrepareSandbox(config, sourceWorkspace.alias, taskId, executionName, effectiveArgs)) {
        executionWorkspace = await runWorkspaceOperation(sourceWorkspace.alias, async () => {
          if (branchChange && findTaskSandbox(config, sourceWorkspace.alias, taskId)) {
            await finalizeTaskSandbox(sourceWorkspace, config, taskId);
            return sourceWorkspace;
          }
          return prepareTaskExecutionWorkspace(sourceWorkspace, config, taskId, executionName, {
            activeTasks: getToolActivity().tasks,
            forceSource: branchChange
          });
        }, queueOptions('write', 'workspace', taskId, context?.signal));
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
      if (executionWorkspace?.taskSandbox === true && executionName === OP.EXEC) {
        assertSandboxExecDoesNotMutateSharedRefs(handlerArgs);
      }
      const invokeHandler = async (args, baselineEntry = sandboxEntry) => {
        if (typeof definition?.handler !== 'function') throw new Error(`Tool '${name}' has no executable handler.`);
        const handled = await definition.handler(config, args || {}, {
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
          backgroundStatusMode,
          mutationBaselineCommit: baselineEntry?.syncCommit || '',
          mutationTrackingRequired: executionName !== OP.EXEC || !isClearlyReadOnlyExec(args || {})
        });
        if (handled && typeof handled === 'object' && !Array.isArray(handled) && handled.ok === false && handled.error?.code === 'CANCELLED') {
          context?.cancel?.throwIfCancelled?.();
        }
        return handled;
      };

      let result;
      try {
        result = await runWorkspaceOperation(
          executionName === OP.WORK_CANCEL || backgroundStatusMode ? '' : handlerArgs?.workspace,
          async () => {
          sessionStart = await maybeStartSession(config, executionName, effectiveArgs || {}, { taskId });
          const handled = await invokeHandler(handlerArgs);
          setSpanAttributes({
            'relai.tool.ok': handled?.ok !== false,
            'relai.tool.duration_ms': Date.now() - started,
            'relai.tool.long_running': definition?.behavior?.longRunning === true
          });
            return handled;
          },
          queueOptions(
            definition?.annotations?.readOnlyHint === true ? 'read' : 'write',
            branchChange
              ? 'workspace'
              : hadSandbox && executionName === OP.WORK_FINISH
                ? 'workspace'
                : definition?.behavior?.concurrencyScope === 'workspace' ? 'workspace' : 'task',
            taskId,
            context?.signal
          )
        );
      } catch (error) {
        if (executionWorkspace?.taskSandbox === true
          && !deferSandboxCompletion
          && SANDBOX_CREATE_OPERATIONS.has(executionName)
          && !isTaskCancelled(config, taskId)
          && !isRequestAbort(error, context)) {
          await runWorkspaceOperation(sourceWorkspace.alias, () => isTaskCancelled(config, taskId)
            ? { promoted: false, changedFiles: [] }
            : promoteTaskSandbox(sourceWorkspace, config, taskId),
          queueOptions('write', 'workspace', taskId));
        }
        throw error;
      }

      if (executionWorkspace?.taskSandbox === true) {
        invalidateSessionCacheForCall(config, executionName, handlerArgs || {});
      }

      if (executionWorkspace?.taskSandbox === true
        && !deferSandboxCompletion
        && shouldPromoteTaskSandbox(executionName, result)
        && !isTaskCancelled(config, taskId)) {
        await runWorkspaceOperation(sourceWorkspace.alias, () => isTaskCancelled(config, taskId)
          ? { promoted: false, changedFiles: [] }
          : promoteTaskSandbox(sourceWorkspace, config, taskId, {
              changedFiles: Array.isArray(result?.changedFiles) ? result.changedFiles : []
            }), queueOptions('write', 'workspace', taskId));
      }

      const visibleResult = mapVisibleWorkspace(result, executionWorkspace, sourceWorkspace);
      if (!deferSandboxCompletion || result?.ok !== true) return visibleResult;

      return runWorkspaceOperation(sourceWorkspace.alias, async () => {
        await promoteTaskSandbox(sourceWorkspace, config, taskId);
        const current = findTaskSandbox(config, sourceWorkspace.alias, taskId);
        const sandboxWorkspace = current ? resolveTaskSandboxWorkspace(config, current.alias) : null;
        let completionResult = result;
        let needsLockedRevalidation = current == null;
        if (sandboxWorkspace) {
          const currentFingerprint = await createValidationFingerprint(sandboxWorkspace, config, {
            paths: Array.isArray(completionResult.validationScope) ? completionResult.validationScope : []
          });
          needsLockedRevalidation = currentFingerprint.fingerprint !== String(completionResult.validationFingerprint || '');
        }
        if (needsLockedRevalidation) {
          addSpanEvent('relai.validation.atomic_revalidate', {
            'relai.workspace': sourceWorkspace.alias,
            'relai.task_id': taskId
          });
          updateCurrentToolActivity({
            status: 'validating',
            currentStage: 'Revalidating synchronized changes',
            currentActivity: 'Relevant concurrent changes arrived during validation. Rechecking once against the visible synchronized workspace.'
          });
          completionResult = await invokeHandler({ ...handlerArgs, workspace: sourceWorkspace.alias, complete: false }, null);
          if (completionResult?.ok !== true) return completionResult;
        }
        if (current) await finalizeTaskSandbox(sourceWorkspace, config, taskId);
        invalidateSessionCacheForCall(config, executionName, { ...effectiveArgs, workspace: sourceWorkspace.alias });
        const completionVisibleResult = sandboxWorkspace
          ? mapVisibleWorkspace(completionResult, sandboxWorkspace, sourceWorkspace)
          : completionResult;
        return finalizeValidationResult(config, sourceWorkspace, completionVisibleResult, effectiveArgs.summary);
      }, queueOptions('write', 'workspace', taskId));
    }, { carrier: context?.requestHeaders || {} }
  ));
  return { value, sessionStart };
}

function shouldReadStableSourceDuringTaskWrite(executionName, definition, sandboxEntry, taskId) {
  if (!sandboxEntry || definition?.annotations?.readOnlyHint !== true) return false;
  if (!STABLE_READ_DURING_TASK_WRITE_OPERATIONS.has(executionName)) return false;
  return hasPendingTaskWriter(sandboxEntry.alias, taskId);
}

function isRequestAbort(error) {
  // Only the queue's pre-execution abort means the handler never ran. A process
  // or native-task AbortError can happen after repository side effects already
  // occurred, so the existing sandbox recovery/promotion path must still run.
  return error?.code === 'WORKSPACE_OPERATION_ABORTED';
}

function isTaskCancelled(config, taskId) {
  return readTaskHistorySessionRecord(config, taskId)?.status === 'cancelled';
}

function shouldPrepareSandbox(config, workspaceAlias, taskId, executionName, args = {}) {
  if ([OP.WORK_CANCEL, OP.WORK_STATUS, OP.CHANGES_DIFF].includes(executionName)) return false;
  if (findTaskSandbox(config, workspaceAlias, taskId)) return true;
  if (!SANDBOX_CREATE_OPERATIONS.has(executionName)) return false;
  return executionName !== OP.EXEC || !isClearlyReadOnlyExec(args);
}

function shouldReconcileRecoverableSandboxes(executionName, args = {}) {
  if (!RECOVERABLE_SANDBOX_RECONCILIATION_OPERATIONS.has(executionName)) return false;
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

function assertSandboxExecDoesNotMutateSharedRefs(args = {}) {
  const executable = path.basename(String(args.executable || '')).toLowerCase();
  const argv = Array.isArray(args.argv) ? args.argv.map(value => String(value || '')) : [];
  const directGit = executable === 'git' || executable === 'git.exe';
  const shellCommand = String(args.command || '');
  if ((directGit && mutatesSharedGitRefs(argv)) || (shellCommand && shellMutatesSharedGitRefs(shellCommand))) {
    throw taskError(
      'TASK_SANDBOX_SHARED_REF_MUTATION_BLOCKED',
      'A private task sandbox cannot mutate shared Git refs or create hidden Git history. Use relai_publish for commits/publishing, or use an explicit branch switch so Rel.AI can reconcile the visible workspace safely.',
      { retryable: false }
    );
  }
}

function mutatesSharedGitRefs(argv = []) {
  const tokens = argv.map(value => String(value || ''));
  const lower = tokens.map(value => value.toLowerCase());
  const commandIndex = gitSubcommandIndex(tokens);
  const command = commandIndex >= 0 ? lower[commandIndex] : '';
  const tail = commandIndex >= 0 ? lower.slice(commandIndex + 1) : [];
  if (['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'stash'].includes(command)) return true;
  if (command === 'update-ref') return true;
  if (command === 'symbolic-ref') {
    const operands = tokens.slice(commandIndex + 1).filter(value => !value.startsWith('-'));
    if (operands.length >= 2) return true;
  }
  if (command === 'branch') {
    if (tail.some(value => ['-f', '--force', '-m', '-M', '-c', '-C', '-d', '-D', '--delete', '--move', '--copy'].includes(value))) return true;
    const listMode = tail.some(value => ['--list', '-l', '--show-current', '-a', '--all', '-r', '--remotes'].includes(value));
    if (!listMode && tail.some(value => value && !value.startsWith('-'))) return true;
  }
  if (command === 'worktree' && String(tail[0] || '') !== 'list') return true;
  if (command === 'tag') {
    const listMode = tail.length === 0 || tail.some(value => ['--list', '-l'].includes(value));
    if (!listMode || tail.some(value => ['-d', '--delete', '-f', '--force'].includes(value))) return true;
  }
  return false;
}

function gitSubcommandIndex(argv = []) {
  const tokens = argv.map(value => String(value || ''));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'].includes(lower)) {
      index += 1;
      continue;
    }
    if (/^--(?:git-dir|work-tree|namespace|super-prefix|config-env)=/i.test(token)) continue;
    if (token.startsWith('-')) continue;
    return index;
  }
  return -1;
}

function shellMutatesSharedGitRefs(command) {
  const text = String(command || '');
  if (!/\bgit(?:\.exe)?\b/i.test(text)) return false;
  return /(?:^|[\r\n;&|])\s*git(?:\.exe)?(?:\s+(?:-C|-c)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+))*\s+(?:commit|merge|rebase|cherry-pick|revert|am|stash)\b/i.test(text)
    || /\bgit(?:\.exe)?\b[^\r\n;&|]*\bupdate-ref\b/i.test(text)
    || /\bgit(?:\.exe)?\b[^\r\n;&|]*\bsymbolic-ref\b[^\r\n;&|]+\s+refs\//i.test(text)
    || /\bgit(?:\.exe)?\b[^\r\n;&|]*\bbranch\b[^\r\n;&|]*(?:\s-f\b|\s--force\b|\s-[mMcCdD]\b|\s--(?:delete|move|copy)\b)/i.test(text)
    || /\bgit(?:\.exe)?\b[^\r\n;&|]*\bworktree\s+(?:add|remove|move|lock|unlock|prune|repair)\b/i.test(text)
    || /\bgit(?:\.exe)?\b[^\r\n;&|]*\btag\b[^\r\n;&|]*(?:\s-d\b|\s--delete\b|\s-f\b|\s--force\b)/i.test(text);
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
    const argv = Array.isArray(args.argv) ? args.argv.map(value => String(value || '')) : [];
    const commandIndex = gitSubcommandIndex(argv);
    const command = commandIndex >= 0 ? argv[commandIndex].toLowerCase() : '';
    if (command === 'switch') return true;
    if (command !== 'checkout') return false;
    const tail = argv.slice(commandIndex + 1);
    if (tail.includes('--')) return false;
    if (tail.some(value => ['-b', '-B', '--detach', '--orphan'].includes(value))) return true;
    return tail.filter(value => value && !value.startsWith('-')).length === 1;
  }
  const command = String(args.command || '');
  if (/\bgit(?:\.exe)?\b[^\r\n;&|]*\bswitch\b/i.test(command)) return true;
  return /\bgit(?:\.exe)?\b[^\r\n;&|]*\bcheckout\b(?![^\r\n;&|]*\s--(?:\s|$))/i.test(command);
}

function queueOptions(mode, scope, taskId, signal) {
  return {
    mode,
    scope,
    taskId,
    ...(signal ? { signal } : {}),
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

export { executeToolCall, isClearlyReadOnlyExec };
