import { safeLogAudit } from '../audit.js';
import { createValidationFingerprint } from '../bridge/validationPlan.js';
import { readConfig, resolveWorkspace, resolveWorkspaceInput } from '../config.js';
import { principalFingerprint, principalForContext } from '../mcp/principal.js';
import { assertAuthorizedToolCall } from '../mcp/authorizationPolicy.js';
import { clearSessionPolicy } from '../policyResolver.js';
import { readTaskIntegrity } from '../taskIntegrity.js';
import { activeProcessesForWorkSession } from '../processManager.js';
import { bindTaskHistoryActivityPersistence, readRecentWorkflowEvidence, readTaskHistorySessionRecord, recordVolatileWorkflowEvidence, recordWorkflowEvidence, recordWorkflowState } from '../taskHistoryStore.js';
import { buildToolActivityDetails, workflowActivityMetadata } from '../taskObservability.js';
import { beginConnectorToolCall, normalizeTaskId, onToolActivity, taskError } from '../toolActivity.js';
import { serializeConnectorResult } from './connector.js';
import { enhanceToolError } from './errors.js';
import { executeToolCall } from './execution.js';
import { repositoryIntelligence } from '../repository/intelligence/service.js';
import { codeIntelligence } from '../codeIntelligence/service.js';
import { describeToolOperation } from './operation.js';
import { resolveExecutableToolCall, validateExecutableOperationInput } from './runtimeRegistry.js';
import { getToolNames, isToolCallable } from './schema.js';
import { applyCautionAudit, buildExtraAudit, invalidateSessionCacheForCall } from './session.js';
import { assertKnownTask, assertTaskWorkspaceOwnership, isTerminalTaskReference, taskAuditContext, withTaskIdentity } from './task.js';
import { deterministicActionId, stableJson } from '../workflow/contracts.js';
import { recordLocalToolOutcome } from '../localAnalytics.js';
import { buildWorkflowEvidenceReceipt } from '../workflow/evidence.js';
import { buildWorkflowSnapshot } from '../workflow/runtime.js';
import { invalidateRepositoryTopology } from '../workflow/topology.js';
import { OPERATION_IDS as OP } from './operationIds.js';
import { observeRepeatCall } from './repeatCallGuard.js';

bindTaskHistoryActivityPersistence(onToolActivity, readConfig);

const WORKFLOW_PASSIVE_OPERATIONS = new Set([
  OP.WORK_STATUS,
  OP.SNAPSHOT,
  OP.READ,
  OP.SEARCH_TEXT,
  OP.SEARCH_SEMANTIC,
  OP.INSPECT
]);

async function callTool(name, args = {}, context = {}) {
  const config = readConfig();
  const started = Date.now();
  const connector = Boolean(context?.publicHttpOnly);
  const publicArgs = args || {};
  let requestedTaskId = '';
  let effectiveArgs = publicArgs;
  let operationName = String(name || '');
  let workspaceResolution, knownTask = null;
  let requestTaskContext = null;
  let finishActivity = null;
  let activityResult = { ok: true };
  let analyticsFailureCode = '';
  let sessionStart;
  let resolvedAction = '';
  try {
    if (!isToolCallable(name, config)) {
      throw new Error(`Unknown tool '${name}'. Available tools: ${getToolNames(config).join(', ')}. Removed direct operation names are not callable; restart or reconnect if discovery is stale.`);
    }
    const resolved = resolveExecutableToolCall(name, publicArgs, config);
    if (!resolved) throw new Error(`Unknown tool '${name}'.`);
    const definition = resolved.executionDefinition;
    operationName = resolved.operationName;
    resolvedAction = resolved.action || '';
    effectiveArgs = resolved.operationArgs;
    const taskScope = definition?.behavior?.taskScope || 'required';
    const taskScoped = taskScope === 'required';
    const taskAware = taskScoped || taskScope === 'optional';
    const effectivePrincipal = principalForContext(context, connector);
    requestedTaskId = normalizeTaskId(effectiveArgs?.work_id);
    if (taskScoped && !requestedTaskId) {
      throw taskError('TASK_ID_REQUIRED', `${name} requires the work_id returned by relai_work action begin.`);
    }
    if (requestedTaskId && operationName !== OP.WORK_BEGIN) {
      knownTask = assertKnownTask(config, requestedTaskId, '', operationName, effectivePrincipal, effectiveArgs);
      if (taskAware && !String(effectiveArgs?.workspace || '').trim()) effectiveArgs = { ...effectiveArgs, workspace: knownTask.workspace };
    }
    workspaceResolution = resolveConfiguredWorkspaceArgument(config, effectiveArgs?.workspace);
    if (workspaceResolution?.alias) effectiveArgs = { ...effectiveArgs, workspace: workspaceResolution.alias };
    assertAuthorizedToolCall({
      principal: effectivePrincipal,
      operationName,
      workspace: workspaceResolution?.alias || effectiveArgs?.workspace || knownTask?.workspace || ''
    });
    if (knownTask) {
      // The task record/principal/state was already validated above. Workspace
      // resolution cannot change that record, so validate ownership against the
      // resolved alias without re-reading task history a second time.
      assertTaskWorkspaceOwnership(knownTask, effectiveArgs?.workspace);
      const integrity = readTaskIntegrity(config, requestedTaskId, effectiveArgs?.workspace);
      if (!integrity) {
        throw taskError(
          'TASK_INTEGRITY_STATE_MISSING',
          'Authoritative integrity state is missing for this logical task. Start a new logical task; no task-scoped operation was executed.',
          { retryable: false }
        );
      }
      requestTaskContext = {
        taskId: requestedTaskId,
        session: knownTask,
        integrity,
        recentEvidence: null,
        workflowContextEvidence: null,
        topology: null
      };
    }
    await validateExecutableOperationInput(operationName, effectiveArgs, {
      publicLabel: resolved.action ? `${name} action '${resolved.action}'` : name
    });
    const repeatCall = observeRepeatCall({
      connector,
      taskId: requestedTaskId,
      operationName,
      args: effectiveArgs,
      mutationGeneration: requestTaskContext?.integrity?.mutationGeneration
    });
    const duplicateTerminalCancellation = operationName === OP.WORK_CANCEL && knownTask?.status === 'cancelled';
    const terminalTaskReference = isTerminalTaskReference(knownTask, operationName, effectiveArgs);
    finishActivity = beginConnectorToolCall({
      tool: name,
      internalOperation: operationName,
      workspace: effectiveArgs?.workspace,
      scopeId: requestedTaskId ? `task:${requestedTaskId}` : (connector ? 'mcp:request' : 'local:default'),
      taskId: requestedTaskId,
      createTask: operationName === OP.WORK_BEGIN,
      trackTask: context?.trackTaskActivity !== false
        && operationName !== OP.WORK_STATUS
        && !duplicateTerminalCancellation
        && !terminalTaskReference
        && (operationName === OP.WORK_BEGIN || Boolean(requestedTaskId)),
      connector,
      operation: describeToolOperation(operationName, effectiveArgs || {}),
      title: effectiveArgs?.title,
      objective: effectiveArgs?.objective,
      contextSummary: effectiveArgs?.contextSummary,
      resumeTask: knownTask,
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
      config, name, executionName: operationName, effectiveArgs, context, requestTaskContext, finishActivity, definition, started
    });
    const value = execution.value;
    sessionStart = execution.sessionStart;
    const valueOk = value?.ok !== false;
    if (!valueOk) analyticsFailureCode = analyticsErrorCodeFromValue(value);
    activityResult = { ok: valueOk, ...(valueOk ? {} : { error: String(value?.error || value?.message || `${name} returned ok:false`) }) };
    if (sessionStart.started && !hasWorkspaceChanges(value)) clearSessionPolicy(config, sessionStart.alias, finishActivity?.taskId);
    const extraAudit = {
      ...buildExtraAudit(operationName, value, effectiveArgs || {}),
      ...(repeatCall ? { repeatCallCount: repeatCall.count, repeatCallWarning: true } : {})
    };
    activityResult.activity = buildToolActivityDetails(operationName, effectiveArgs || {}, value, valueOk ? null : activityResult.error, {
      operation: finishActivity?.operation,
      phase: 'complete',
      metadata: { ...extraAudit, internalOperation: operationName, publicAction: resolved.action || undefined }
    });
    applyCautionAudit(extraAudit, operationName, effectiveArgs || {}, value, config);
    invalidateSessionCacheForCall(config, operationName, effectiveArgs || {});
    signalRepositoryIntelligenceMutation(config, operationName, effectiveArgs || {}, value);
    const workId = finishActivity?.taskId || requestedTaskId;
    const evidenceDraft = workId ? buildWorkflowEvidenceReceipt({
      tool: operationName,
      args: { ...(effectiveArgs || {}), action: resolved.action || effectiveArgs?.action },
      result: value || {},
      auditEntry: {},
      repositoryFingerprint: String(value?.validationFingerprint || ''),
      commandId: workflowCommandId(operationName, resolved.action, effectiveArgs)
    }) : null;
    const auditEntry = await safeLogAudit(config, {
      ...activityResult.activity,
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
    refreshRequestTaskIntegrity(requestTaskContext, auditEntry);
    const workflowReceipt = workId && evidenceDraft && auditEntry
      ? await persistWorkflowEvidence(config, effectiveArgs, operationName, resolved.action, value || {}, auditEntry, workId, evidenceDraft)
      : null;
    const workflowState = workId
      ? await buildAndPersistWorkflow(config, effectiveArgs, operationName, value || {}, workId, workflowReceipt, requestTaskContext)
      : null;
    const workflow = workflowState?.workflow || null;
    if (workflow && activityResult.activity) {
      activityResult.activity.metadata = {
        ...(activityResult.activity.metadata || {}),
        ...workflowActivityMetadata(workflow)
      };
    }
    const responseWorkflow = workflowState?.unchanged ? compactUnchangedWorkflow(workflow) : workflow;
    const valueWithWorkflow = responseWorkflow && value && typeof value === 'object'
      ? { ...value, workflow: responseWorkflow }
      : value;
    const responseValue = connector && resolved.compact
      ? serializeConnectorResult({
        publicName: name,
        action: resolved.action,
        operationName,
        value: valueWithWorkflow,
        args: effectiveArgs || {},
        workId
      })
      : withTaskIdentity(valueWithWorkflow, workId);
    const responseWithRepeatWarning = repeatCall && responseValue && typeof responseValue === 'object'
      ? { ...responseValue, warning: repeatCall.warning }
      : responseValue;
    return ok(responseWithRepeatWarning);
  } catch (error) {
    const enhanced = enhanceToolError(operationName, error);
    analyticsFailureCode = String(enhanced.code || '');
    activityResult = {
      ok: false,
      error: enhanced.message,
      activity: buildToolActivityDetails(operationName, effectiveArgs || {}, null, enhanced, {
        operation: finishActivity?.operation,
        phase: 'complete',
        metadata: { errorCode: enhanced.code, retryable: enhanced.retryable === true, publicTool: name }
      })
    };
    const failedWorkId = finishActivity?.taskId || requestedTaskId;
    if (failedWorkId) enhanced.taskId = failedWorkId;
    const failedValue = { ok: false, errorCode: enhanced.code || '', commandSummary: effectiveArgs?.command || '' };
    const failedDraft = failedWorkId ? buildWorkflowEvidenceReceipt({
      tool: operationName,
      args: { ...(effectiveArgs || {}), action: resolvedAction || effectiveArgs?.action },
      result: failedValue,
      auditEntry: {},
      repositoryFingerprint: '',
      commandId: workflowCommandId(operationName, resolvedAction, effectiveArgs)
    }) : null;
    if (!/^TASK_INTEGRITY_/.test(String(enhanced.code || ''))) {
      const failedAuditEntry = await safeLogAudit(config, {
        ...activityResult.activity,
        ...taskAuditContext(context, finishActivity, requestedTaskId, operationName, false),
        tool: operationName,
        publicTool: name,
        internalOperation: operationName === name ? undefined : operationName,
        action: resolvedAction || undefined,
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
      if (failedWorkId && failedDraft && failedAuditEntry) {
        await persistWorkflowEvidence(config, effectiveArgs, operationName, resolvedAction, failedValue, failedAuditEntry, failedWorkId, failedDraft, { persist: true });
      }
    }
    throw enhanced;
  } finally {
    recordLocalToolOutcome(config, {
      tool: name,
      operationName,
      workspace: workspaceResolution?.alias || knownTask?.workspace || '',
      ok: activityResult.ok === true,
      durationMs: Date.now() - started,
      errorCode: analyticsFailureCode,
      errorMessage: activityResult.error || ''
    });
    finishActivity?.(activityResult);
  }
}

function analyticsErrorCodeFromValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  if (typeof value.errorCode === 'string') return value.errorCode;
  if (typeof value.code === 'string') return value.code;
  if (value.error && typeof value.error === 'object' && typeof value.error.code === 'string') return value.error.code;
  return '';
}

async function persistWorkflowEvidence(config, args, operationName, action, value, auditEntry, workId, draft, options = {}) {
  try {
    const workspace = resolveWorkspace(config, args?.workspace);
    let repositoryFingerprint = String(value?.validationFingerprint || draft?.repositoryFingerprint || '');
    if (draft?.kind === 'check' && !repositoryFingerprint) {
      repositoryFingerprint = String((await createValidationFingerprint(workspace, config))?.fingerprint || '');
    }
    const receipt = buildWorkflowEvidenceReceipt({
      tool: operationName,
      args: { ...(args || {}), action: action || args?.action },
      result: value || {},
      auditEntry,
      repositoryFingerprint,
      commandId: workflowCommandId(operationName, action, args)
    });
    if (receipt && options.persist === true) recordWorkflowEvidence(config, workId, receipt, { defer: true });
    return receipt;
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] workflow evidence:', error);
    return null;
  }
}

async function buildAndPersistWorkflow(config, args, operationName, value, workId, receipt = null, requestState = null) {
  try {
    const workspace = resolveWorkspace(config, args?.workspace);
    const integrity = requestState?.integrity || readTaskIntegrity(config, workId, workspace.alias);
    if (!integrity) return null;
    const session = requestState?.session || readTaskHistorySessionRecord(config, workId) || {};
    if (requestState && !requestState.session) requestState.session = session;
    if (canReuseWorkflowSnapshot(session, integrity, operationName, value)) {
      if (receipt) recordVolatileWorkflowEvidence(workId, receipt);
      return { workflow: session.workflow, unchanged: true, reused: true };
    }
    const recentEvidence = requestState?.recentEvidence
      ? [...requestState.recentEvidence]
      : readRecentWorkflowEvidence(config, workId, 100);
    if (receipt) recentEvidence.push(receipt);
    if (requestState) requestState.recentEvidence = recentEvidence.slice(-100);
    const processes = activeProcessesForWorkSession(config, workspace.alias, workId).map(item => ({
      processId: item.processId,
      status: item.status,
      workSessionId: item.workSessionId || '',
      reused: value?.reused === true && value?.processId === item.processId,
      matchesCurrent: Boolean(value?.processId && value.processId === item.processId && item.workSessionId === workId)
    }));
    const workflow = await buildWorkflowSnapshot({
      workspace,
      taskId: workId,
      taskIntegrity: integrity,
      topology: requestState?.topology || undefined,
      objective: session.objective || args?.objective || '',
      intent: session.intent || '',
      recentEvidence,
      currentResult: value,
      impactedPaths: Array.isArray(value?.impactedPaths) ? value.impactedPaths : [],
      affectedTests: Array.isArray(value?.affectedTests) ? value.affectedTests : [],
      processes,
      operation: { kind: operationName === OP.VALIDATE_CHECKS && args?.migration === true ? 'migration' : '' }
    });
    const unchanged = Boolean(session.workflow && stableJson(session.workflow) === stableJson(workflow));
    recordWorkflowState(config, workId, { receipt, workflow: unchanged ? null : workflow }, { defer: true });
    return { workflow, unchanged };
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] workflow snapshot:', error);
    return null;
  }
}

function canReuseWorkflowSnapshot(session, integrity, operationName, value) {
  const workflow = session?.workflow;
  if (!workflow || !WORKFLOW_PASSIVE_OPERATIONS.has(operationName)) return false;
  if (Array.isArray(value?.changedFiles) && value.changedFiles.length) return false;
  if (Array.isArray(value?.impactedPaths) && value.impactedPaths.length) return false;
  if (Array.isArray(value?.affectedTests) && value.affectedTests.length) return false;
  const evidence = workflow.evidence || {};
  return Number(evidence.lastMutationGeneration || 0) === Number(integrity.mutationGeneration || 0)
    && Number(evidence.lastValidatedMutationGeneration || 0) === Number(integrity.latestValidatedMutationGeneration || 0);
}

function refreshRequestTaskIntegrity(requestState, auditEntry) {
  if (!requestState?.integrity || !auditEntry) return;
  const currentMutation = Number(requestState.integrity.mutationGeneration || 0);
  const currentValidated = Number(requestState.integrity.latestValidatedMutationGeneration || 0);
  const nextMutation = Number(auditEntry.taskMutationGeneration ?? currentMutation);
  const nextValidated = Number(auditEntry.taskValidatedMutationGeneration ?? currentValidated);
  if (nextMutation !== currentMutation || nextValidated !== currentValidated) requestState.integrity = null;
}

function compactUnchangedWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') return workflow;
  return {
    version: workflow.version,
    stage: workflow.stage,
    intent: workflow.intent,
    unchanged: true,
    recommendedActions: workflow.recommendedActions,
    completion: workflow.completion
  };
}

function workflowCommandId(operationName, action, args = {}) {
  return deterministicActionId({
    tool: operationName,
    action: action || args?.action || operationName,
    args: {
      command: args?.command || (args?.executable ? [args.executable, ...(Array.isArray(args?.argv) ? args.argv : [])].join(' ') : ''),
      check: args?.check || '',
      checks: Array.isArray(args?.checks) ? args.checks.slice(0, 10) : [],
      cwd: args?.cwd || '.'
    }
  });
}
function resolveConfiguredWorkspaceArgument(config, input) {
  if (input == null || String(input).trim() === '') return null;
  const resolution = resolveWorkspaceInput(config, input);
  if (resolution.source === 'configured_path') return resolution;
  if (resolution.source === 'path_unavailable' || resolution.source === 'unmatched_path') resolveWorkspace(config, input);
  return resolution;
}

function signalRepositoryIntelligenceMutation(config, operationName, args, value) {
  const alias = String(args?.workspace || value?.workspace || '').trim();
  if (!alias || args?.dryRun === true) return;
  const changedFiles = Array.isArray(value?.changedFiles)
    ? [...new Set(value.changedFiles.map(item => String(item || '').trim().replaceAll('\\', '/')).filter(Boolean))]
    : [];
  const broadMutation = operationName === OP.CHANGES_RESET && value?.ok !== false;
  const targetedMutation = changedFiles.length > 0
    && [OP.EDIT, OP.EXEC, OP.CHANGES_TIDY_RUN].includes(operationName);
  const restoreMutation = operationName === OP.CHANGES_RESTORE && value?.ok !== false
    ? [...new Set((Array.isArray(args?.paths) ? args.paths : []).map(item => String(item || '').trim().replaceAll('\\', '/')).filter(Boolean))]
    : [];
  if (!broadMutation && !targetedMutation && !restoreMutation.length) return;
  try {
    const workspace = resolveWorkspace(config, alias);
    const mutationPaths = broadMutation ? [] : (changedFiles.length ? changedFiles : restoreMutation);
    repositoryIntelligence.noteMutation(workspace, config, mutationPaths);
    codeIntelligence.noteMutation(workspace, mutationPaths);
    invalidateRepositoryTopology(workspace.path, mutationPaths);
  } catch {}
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
