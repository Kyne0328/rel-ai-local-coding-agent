import * as path from 'node:path';

import { resolveWorkspace } from '../config.js';
import { fallbackExecutionStatus } from '../mcp/fallbackExecutions.js';
import { addSpanEvent, runSpan, setSpanAttributes } from '../telemetry.js';
import { claimTaskChangedFiles } from '../taskIntegrity.js';
import { runWithToolActivity, updateCurrentToolActivity } from '../toolActivity.js';
import { runWorkspaceOperation } from '../workspaceOperationQueue.js';
import { maybeStartSession } from './session.js';
import { OPERATION_IDS as OP } from './operationIds.js';

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
      const workspace = effectiveArgs?.workspace ? resolveWorkspace(config, effectiveArgs.workspace) : null;
      const branchChange = isExplicitBranchChange(executionName, effectiveArgs);
      const readOnlyExec = executionName === OP.EXEC && isClearlyReadOnlyExec(effectiveArgs);
      const queueMode = definition?.annotations?.readOnlyHint === true || readOnlyExec ? 'read' : 'write';
      const queueScope = requiresWorkspaceWriteLock(executionName, effectiveArgs, definition, branchChange, readOnlyExec)
        ? 'workspace'
        : 'task';

      const invokeHandler = async (args) => {
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
          mutationTrackingRequired: executionName !== OP.EXEC || !readOnlyExec
        });
        if (workspace
          && taskId
          && effectiveArgs?.dryRun !== true
          && (executionName === OP.EDIT || executionName === OP.EXEC)
          && Array.isArray(handled?.changedFiles)
          && handled.changedFiles.length) {
          claimTaskChangedFiles(config, taskId, workspace.alias, handled.changedFiles);
        }
        if (handled && typeof handled === 'object' && !Array.isArray(handled) && handled.ok === false && handled.error?.code === 'CANCELLED') {
          context?.cancel?.throwIfCancelled?.();
        }
        return handled;
      };

      const result = await runWorkspaceOperation(
        executionName === OP.WORK_CANCEL || backgroundStatusMode ? '' : effectiveArgs?.workspace,
        async () => {
          sessionStart = await maybeStartSession(config, executionName, effectiveArgs || {}, { taskId });
          const handled = await invokeHandler(effectiveArgs);
          setSpanAttributes({
            'relai.tool.ok': handled?.ok !== false,
            'relai.tool.duration_ms': Date.now() - started,
            'relai.tool.long_running': definition?.behavior?.longRunning === true
          });
          return handled;
        },
        queueOptions(queueMode, queueScope, taskId, context?.signal)
      );

      return result;
    }, { carrier: context?.requestHeaders || {} }
  ));
  return { value, sessionStart };
}

function requiresWorkspaceWriteLock(executionName, args, definition, branchChange, readOnlyExec) {
  if (branchChange) return true;
  if (executionName === OP.EXEC) return !readOnlyExec;
  if (executionName === OP.EDIT) return true;
  if (executionName === OP.VALIDATE_CHECKS && args?.complete === true) return true;
  return definition?.behavior?.concurrencyScope === 'workspace';
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
    return optionTokens.length === 0 || optionTokens.every(value => ['--show-current', '--list', '-a', '-r'].includes(value));
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
