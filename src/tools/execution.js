'use strict';

const { runWithToolActivity, updateCurrentToolActivity } = require('../toolActivity');
const { runWorkspaceOperation } = require('../workspaceOperationQueue');
const { maybeStartSession } = require('./session');
const { runSpan, addSpanEvent, setSpanAttributes } = require('../telemetry');

async function executeToolCall({ config, name, effectiveArgs, context, finishActivity, definition, started }) {
  let sessionStart = { started: false, alias: '' };
  const value = await runWithToolActivity(finishActivity, () => runSpan(config,
    name === 'relai_start_task' ? 'relai.logical_task.start' : 'relai.tool.call',
    spanAttributes(name, effectiveArgs, context, finishActivity),
    () => runWorkspaceOperation(name === 'relai_cancel_task' ? '' : effectiveArgs?.workspace, async () => {
      sessionStart = maybeStartSession(config, name, effectiveArgs || {}, { taskId: finishActivity?.taskId });
      if (typeof definition?.handler !== 'function') throw new Error(`Tool '${name}' has no executable handler.`);
      const result = await definition.handler(config, effectiveArgs || {}, {
        connector: Boolean(context?.publicHttpOnly),
        taskId: finishActivity?.taskId,
        requestHeaders: context?.requestHeaders || {},
        mcp: context?.mcp || {}
      });
      setSpanAttributes({
        'relai.tool.ok': result?.ok !== false,
        'relai.tool.duration_ms': Date.now() - started,
        'relai.tool.long_running': definition?.behavior?.longRunning === true
      });
      return result;
    }, {
      mode: definition?.annotations?.readOnlyHint === true ? 'read' : 'write',
      onWait: (waitMs, details) => {
        addSpanEvent('workspace.queue.admitted', {
          'relai.workspace': details.workspace,
          'relai.queue.mode': details.mode,
          'relai.queue.wait_ms': waitMs,
          'relai.queue.pending': details.queued
        });
        if (waitMs > 0) {
          updateCurrentToolActivity({
            currentStage: 'Workspace queue admitted',
            currentActivity: `Waited ${formatWait(waitMs)} for the workspace execution queue.`,
            metadata: { waitMs, queueMode: details.mode, queued: details.queued }
          });
        }
      }
    }), { carrier: context?.requestHeaders || {} }));
  return { value, sessionStart };
}

function spanAttributes(name, args, context, activity) {
  return {
    'relai.tool.name': name,
    'relai.workspace': String(args?.workspace || ''),
    'relai.task.id': String(activity?.taskId || args?.task_id || args?.taskId || ''),
    'relai.transport': String(context?.transportType || ''),
    'relai.client.name': String(context?.clientName || ''),
    'relai.client.version': String(context?.clientVersion || '')
  };
}

function formatWait(waitMs) {
  return waitMs < 1000 ? `${Math.max(0, Math.round(waitMs))} ms` : `${(waitMs / 1000).toFixed(1)} seconds`;
}

module.exports = { executeToolCall };
