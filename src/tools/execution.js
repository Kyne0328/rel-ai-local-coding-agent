

import { resolveWorkspace } from "../config.js";
import { runWithToolActivity, updateCurrentToolActivity } from "../toolActivity.js";
import { taskExecutionWorkspace } from "../worktreeManager.js";
import { runWorkspaceOperation } from "../workspaceOperationQueue.js";
import { maybeStartSession } from "./session.js";
import { runSpan, addSpanEvent, setSpanAttributes } from "../telemetry.js";

async function executeToolCall({ config, name, executionName = name, effectiveArgs, context, finishActivity, definition, started }) {
  let sessionStart = { started: false, alias: '' };
  let executionArgs = effectiveArgs;
  const integratesTask = executionName === 'relai_finish_work'
    || (executionName === 'relai_run_checks' && effectiveArgs?.complete === true);
  const value = await runWithToolActivity(finishActivity, () => runSpan(config,
    executionName === 'relai_begin_work' ? 'relai.logical_task.start' : 'relai.tool.call',
    spanAttributes(name, effectiveArgs, context, finishActivity),
    () => runWorkspaceOperation(executionName === 'relai_cancel_work' ? '' : effectiveArgs?.workspace, async () => {
      const logicalWorkspace = effectiveArgs?.workspace ? resolveWorkspace(config, effectiveArgs.workspace) : null;
      const runtimeWorkspace = logicalWorkspace
        ? await taskExecutionWorkspace(logicalWorkspace, config, finishActivity?.taskId, executionName)
        : null;
      executionArgs = runtimeWorkspace && runtimeWorkspace.alias !== logicalWorkspace?.alias
        ? { ...(effectiveArgs || {}), workspace: runtimeWorkspace.alias }
        : effectiveArgs;
      sessionStart = maybeStartSession(config, executionName, executionArgs || {}, { taskId: finishActivity?.taskId });
      if (typeof definition?.handler !== 'function') throw new Error(`Tool '${name}' has no executable handler.`);
      const result = await definition.handler(config, executionArgs || {}, {
        connector: Boolean(context?.publicHttpOnly),
        taskId: finishActivity?.taskId,
        requestHeaders: context?.requestHeaders || {},
        mcp: context?.mcp || {},
        signal: context?.signal,
        principal: context?.principal,
        nativeTaskId: context?.nativeTaskId,
        transportType: context?.transportType
      });
      setSpanAttributes({
        'relai.tool.ok': result?.ok !== false,
        'relai.tool.duration_ms': Date.now() - started,
        'relai.tool.long_running': definition?.behavior?.longRunning === true
      });
      return result;
    }, {
      mode: integratesTask ? 'write' : (definition?.annotations?.readOnlyHint === true ? 'read' : 'write'),
      scope: integratesTask || definition?.behavior?.concurrencyScope === 'workspace' ? 'workspace' : 'task',
      taskId: finishActivity?.taskId,
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
    }), { carrier: context?.requestHeaders || {} }));
  return { value, sessionStart, executionArgs };
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
