import { readConfig, resolveWorkspace, resolveWorkspaceInput } from "./config.js";
import { logAudit } from "./audit.js";
import { toolSchemas, getToolSchemas, getToolMetadata, getToolGroups, getToolSurfaceManifest, isToolCallable, TOOL_NAMES } from './tools/schema.js';
import { getExecutableToolDefinition, getExecutableToolDefinitions } from './tools/runtimeRegistry.js';
import { compactForConnector, policySentence } from "./tools/connector.js";
import { enhanceToolError } from "./tools/errors.js";
import { buildExtraAudit, applyCautionAudit, invalidateSessionCacheForCall } from "./tools/session.js";
import { beginConnectorToolCall, normalizeTaskId, onToolActivity } from "./toolActivity.js";
import { buildToolActivityDetails } from "./taskObservability.js";
import { bindTaskHistoryActivityPersistence } from "./taskHistoryStore.js";
import { assertKnownTask, taskAuditContext, withTaskIdentity } from "./tools/task.js";
import { clearSessionPolicy } from "./policyResolver.js";
import { describeToolOperation } from "./tools/operation.js";
import { executeToolCall } from "./tools/execution.js";

bindTaskHistoryActivityPersistence(onToolActivity, readConfig);

async function callTool(name, args = {}, context = {}) {
  const config = readConfig();
  const started = Date.now();
  const connector = Boolean(context?.publicHttpOnly);
  let requestedTaskId = '';
  let effectiveArgs = args || {};
  let workspaceResolution;
  let finishActivity = null;
  let activityResult = { ok: true };
  let sessionStart;
  try {
    if (!isToolCallable(name)) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${TOOL_NAMES.join(', ')}. Restart/reconnect ChatGPT if the tool list looks stale.`);
    }
    workspaceResolution = resolveConfiguredWorkspaceArgument(config, args?.workspace);
    if (workspaceResolution?.alias) effectiveArgs = { ...args, workspace: workspaceResolution.alias };
    requestedTaskId = normalizeTaskId(effectiveArgs?.task_id || effectiveArgs?.taskId);
    if (requestedTaskId && name !== 'relai_start_task') {
      assertKnownTask(config, requestedTaskId, effectiveArgs?.workspace, name);
    }
    finishActivity = beginConnectorToolCall({
      tool: name,
      workspace: effectiveArgs?.workspace,
      scopeId: requestedTaskId ? `task:${requestedTaskId}` : (connector ? 'mcp:request' : 'local:default'),
      taskId: requestedTaskId,
      createTask: name === 'relai_start_task',
      trackTask: name === 'relai_start_task' || Boolean(requestedTaskId),
      connector,
      operation: describeToolOperation(name, effectiveArgs || {}),
      title: effectiveArgs?.title,
      objective: effectiveArgs?.objective,
      correlation: { requestId: context?.requestId, traceId: context?.traceId,
        workspaceId: effectiveArgs?.workspace, conversationId: context?.conversationId },
      input: effectiveArgs || {}
    });
    const definition = getExecutableToolDefinition(name);
    const execution = await executeToolCall({ config, name, effectiveArgs, context, finishActivity, definition, started });
    const value = execution.value;
    sessionStart = execution.sessionStart;
    const valueOk = value?.ok !== false;
    activityResult = {
      ok: valueOk,
      ...(valueOk ? {} : { error: String(value?.error || value?.message || `${name} returned ok:false`) })
    };
    if (sessionStart.started && !hasWorkspaceChanges(value)) clearSessionPolicy(config, sessionStart.alias, finishActivity?.taskId);
    const extraAudit = buildExtraAudit(name, value, effectiveArgs || {});
    activityResult.activity = buildToolActivityDetails(name, effectiveArgs || {}, value, valueOk ? null : activityResult.error, {
      operation: finishActivity?.operation,
      phase: 'complete',
      metadata: extraAudit
    });
    applyCautionAudit(extraAudit, name, effectiveArgs || {}, value, config);
    invalidateSessionCacheForCall(config, name, effectiveArgs || {});
    safeLogAudit(config, {
      ...taskAuditContext(context, finishActivity, requestedTaskId, name, valueOk, value),
      tool: name,
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
    });
    const responseValue = connector ? compactForConnector(name, value, effectiveArgs || {}) : value;
    return ok(withTaskIdentity(responseValue, finishActivity?.taskId));
  } catch (error) {
    const enhanced = enhanceToolError(name, error);
    activityResult = {
      ok: false,
      error: enhanced.message,
      activity: buildToolActivityDetails(name, effectiveArgs || {}, null, enhanced, {
        operation: finishActivity?.operation,
        phase: 'complete',
        metadata: { errorCode: enhanced.code, retryable: enhanced.retryable === true }
      })
    };
    if (finishActivity?.taskId || requestedTaskId) enhanced.taskId = finishActivity?.taskId || requestedTaskId;
    safeLogAudit(config, {
      ...taskAuditContext(context, finishActivity, requestedTaskId, name, false),
      tool: name,
      operation: finishActivity?.operation,
      ok: false,
      workspace: effectiveArgs?.workspace,
      workspaceInput: args?.workspace == null ? '' : String(args.workspace),
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
  if (resolution.source === 'path_unavailable' || resolution.source === 'unmatched_path') {
    // Produce the same structured validation error before task ownership checks.
    resolveWorkspace(config, input);
  }
  return resolution;
}

function safeLogAudit(config, event) {
  try {
    logAudit(config, event);
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] audit write:', error);
  }
}

function hasWorkspaceChanges(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.changed === true) return true;
  if (Array.isArray(value.changedFiles) && value.changedFiles.length > 0) return true;
  if (Array.isArray(value.statusAfter?.sessionChangedFiles) && value.statusAfter.sessionChangedFiles.length > 0) return true;
  return false;
}

function ok(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'ok')
    ? value
    : { ok: true, ...value };
}

const getToolDefinition = getExecutableToolDefinition;
const getToolDefinitions = getExecutableToolDefinitions;

export { toolSchemas, getToolSchemas, getToolMetadata, getToolDefinition, getToolDefinitions, getToolGroups, getToolSurfaceManifest, TOOL_NAMES, callTool, enhanceToolError, compactForConnector, policySentence };
