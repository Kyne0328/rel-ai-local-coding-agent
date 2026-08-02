import { safeLogAudit } from '../audit.js';
import { readConfig, resolveWorkspace, resolveWorkspaceInput } from '../config.js';
import { principalFingerprint, principalForContext } from '../mcp/principal.js';
import { clearSessionPolicy } from '../policyResolver.js';
import { assertRuntimeCompatibility } from '../runtimeCompatibility.js';
import { readTaskIntegrity } from '../taskIntegrity.js';
import { bindTaskHistoryActivityPersistence } from '../taskHistoryStore.js';
import { buildToolActivityDetails } from '../taskObservability.js';
import { beginConnectorToolCall, getToolActivity, normalizeTaskId, onToolActivity, taskError } from '../toolActivity.js';
import { slimCompactPublicResult } from './compactResult.js';
import { compactForConnector } from './connector.js';
import { enhanceToolError } from './errors.js';
import { executeToolCall } from './execution.js';
import { describeToolOperation } from './operation.js';
import { getLegacyExecutableToolDefinition, resolveExecutableToolCall } from './runtimeRegistry.js';
import { getToolNames, isToolCallable } from './schema.js';
import { applyCautionAudit, buildExtraAudit, invalidateSessionCacheForCall } from './session.js';
import { assertKnownTask, taskAuditContext, withTaskIdentity } from './task.js';

bindTaskHistoryActivityPersistence(onToolActivity, readConfig);

async function callTool(name, args = {}, context = {}) {
  const config = readConfig();
  const started = Date.now();
  const connector = Boolean(context?.publicHttpOnly);
  const publicArgs = args || {};
  let requestedTaskId = '';
  let effectiveArgs = publicArgs;
  let operationName = String(name || '');
  let workspaceResolution, knownTask = null;
  let finishActivity = null;
  let activityResult = { ok: true };
  let sessionStart;
  try {
    const publicCallable = isToolCallable(name, config);
    const internalLegacy = getLegacyExecutableToolDefinition(name);
    if (!publicCallable && !internalLegacy) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${getToolNames(config).join(', ')}. Restart or reconnect if discovery is stale.`);
    }
    const resolved = resolveExecutableToolCall(name, publicArgs, config);
    if (!resolved) throw new Error(`Unknown tool '${name}'.`);
    const definition = resolved.executionDefinition;
    operationName = resolved.operationName;
    effectiveArgs = resolved.operationArgs;
    const taskScope = definition?.behavior?.taskScope || 'required';
    const taskScoped = taskScope === 'required';
    const taskAware = taskScoped || taskScope === 'optional';
    const effectivePrincipal = principalForContext(context, connector);
    requestedTaskId = normalizeTaskId(effectiveArgs?.work_id);
    if (taskScoped && !requestedTaskId) {
      throw taskError('TASK_ID_REQUIRED', `${name} requires the work_id returned by relai_work action begin.`);
    }
    if (requestedTaskId && operationName !== 'relai_begin_work') {
      knownTask = assertKnownTask(config, requestedTaskId, '', operationName, effectivePrincipal);
      if (taskAware && !String(effectiveArgs?.workspace || '').trim()) effectiveArgs = { ...effectiveArgs, workspace: knownTask.workspace };
    }
    workspaceResolution = resolveConfiguredWorkspaceArgument(config, effectiveArgs?.workspace);
    if (workspaceResolution?.alias) effectiveArgs = { ...effectiveArgs, workspace: workspaceResolution.alias };
    if (knownTask) {
      assertKnownTask(config, requestedTaskId, effectiveArgs?.workspace, operationName, effectivePrincipal);
      if (!readTaskIntegrity(config, requestedTaskId, effectiveArgs?.workspace)) {
        throw taskError(
          'TASK_INTEGRITY_STATE_MISSING',
          'Authoritative integrity state is missing for this logical task. Start a new logical task; no task-scoped operation was executed.',
          { retryable: false }
        );
      }
    }
    assertRuntimeCompatibility(config, operationName, effectiveArgs, { activeTaskCount: getToolActivity().activeTaskCount });
    const duplicateTerminalCancellation = operationName === 'relai_cancel_work' && knownTask?.status === 'cancelled';
    finishActivity = beginConnectorToolCall({
      tool: name,
      workspace: effectiveArgs?.workspace,
      scopeId: requestedTaskId ? `task:${requestedTaskId}` : (connector ? 'mcp:request' : 'local:default'),
      taskId: requestedTaskId,
      createTask: operationName === 'relai_begin_work',
      trackTask: !duplicateTerminalCancellation && (operationName === 'relai_begin_work' || Boolean(requestedTaskId)),
      connector,
      operation: describeToolOperation(operationName, effectiveArgs || {}),
      title: effectiveArgs?.title,
      objective: effectiveArgs?.objective,
      correlation: {
        requestId: context?.requestId,
        traceId: context?.traceId,
        workspaceId: effectiveArgs?.workspace,
        conversationId: context?.conversationId
      },
      input: publicArgs,
      principalFingerprint: principalFingerprint(effectivePrincipal)
    });
    const execution = await executeToolCall({
      config, name, executionName: operationName, effectiveArgs, context, finishActivity, definition, started
    });
    const value = execution.value;
    sessionStart = execution.sessionStart;
    const valueOk = value?.ok !== false;
    activityResult = { ok: valueOk, ...(valueOk ? {} : { error: String(value?.error || value?.message || `${name} returned ok:false`) }) };
    if (sessionStart.started && !hasWorkspaceChanges(value)) clearSessionPolicy(config, sessionStart.alias, finishActivity?.taskId);
    const extraAudit = buildExtraAudit(operationName, value, effectiveArgs || {});
    activityResult.activity = buildToolActivityDetails(operationName, effectiveArgs || {}, value, valueOk ? null : activityResult.error, {
      operation: finishActivity?.operation,
      phase: 'complete',
      metadata: { ...extraAudit, publicTool: name, action: resolved.action || undefined }
    });
    applyCautionAudit(extraAudit, operationName, effectiveArgs || {}, value, config);
    invalidateSessionCacheForCall(config, operationName, effectiveArgs || {});
    safeLogAudit(config, {
      ...taskAuditContext(context, finishActivity, requestedTaskId, operationName, valueOk, value),
      tool: operationName,
      publicTool: name,
      internalOperation: operationName === name ? undefined : operationName,
      action: resolved.action || undefined,
      operation: finishActivity?.operation,
      ok: valueOk,
      workspace: effectiveArgs?.workspace,
      ...(workspaceResolution?.source === 'configured_path' ? {
        workspaceInput: workspaceResolution.input,
        workspaceInputSource: 'configured_path',
        workspaceMatchStatus: 'matched_configured_path',
        workspaceResolvedAlias: workspaceResolution.alias
      } : {}),
      ms: Date.now() - started,
      ...extraAudit,
      ...(valueOk ? {} : { error: activityResult.error })
    }, { strictIntegrity: true });
    const connectorValue = connector ? compactForConnector(operationName, value, effectiveArgs || {}) : value;
    const responseValue = connector && resolved.compact
      ? slimCompactPublicResult(name, resolved.action, connectorValue)
      : connectorValue;
    return ok(withTaskIdentity(responseValue, finishActivity?.taskId || requestedTaskId));
  } catch (error) {
    const enhanced = enhanceToolError(operationName, error);
    activityResult = {
      ok: false,
      error: enhanced.message,
      activity: buildToolActivityDetails(operationName, effectiveArgs || {}, null, enhanced, {
        operation: finishActivity?.operation,
        phase: 'complete',
        metadata: { errorCode: enhanced.code, retryable: enhanced.retryable === true, publicTool: name }
      })
    };
    if (finishActivity?.taskId || requestedTaskId) enhanced.taskId = finishActivity?.taskId || requestedTaskId;
    if (!/^TASK_INTEGRITY_/.test(String(enhanced.code || ''))) safeLogAudit(config, {
      ...taskAuditContext(context, finishActivity, requestedTaskId, operationName, false),
      tool: operationName,
      publicTool: name,
      internalOperation: operationName === name ? undefined : operationName,
      operation: finishActivity?.operation,
      ok: false,
      workspace: effectiveArgs?.workspace,
      workspaceInput: publicArgs?.workspace == null ? '' : String(publicArgs.workspace),
      workspaceInputSource: 'tool_argument',
      workspaceMatchStatus: enhanced.workspaceMatchStatus || undefined,
      workspaceResolutionFailure: enhanced.workspaceResolutionFailure || undefined,
      configuredWorkspaceAliases: enhanced.configuredWorkspaceAliases || undefined,
      protocolVersion: context?.protocolVersion || undefined,
      clientName: context?.clientName || undefined,
      clientVersion: context?.clientVersion || undefined,
      ms: Date.now() - started,
      error: enhanced.message,
      errorCode: enhanced.code || undefined
    });
    throw enhanced;
  } finally {
    finishActivity?.(activityResult);
  }
}

function resolveConfiguredWorkspaceArgument(config, input) {
  if (input == null || String(input).trim() === '') return null;
  const resolution = resolveWorkspaceInput(config, input);
  if (resolution.source === 'configured_path') return resolution;
  if (resolution.source === 'path_unavailable' || resolution.source === 'unmatched_path') resolveWorkspace(config, input);
  return resolution;
}

function hasWorkspaceChanges(value) {
  return Boolean(value && typeof value === 'object' && (value.changed === true
    || (Array.isArray(value.changedFiles) && value.changedFiles.length > 0)
    || (Array.isArray(value.statusAfter?.sessionChangedFiles) && value.statusAfter.sessionChangedFiles.length > 0)));
}

function ok(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'ok') ? value : { ok: true, ...value };
}

export { callTool };
