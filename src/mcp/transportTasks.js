import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
  fromJsonSchema
} from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { combineAbortSignals } from '../abortSignals.js';
import {
  DEFAULT_FALLBACK_GRACE_MS,
  fallbackSignature,
  startFallbackExecution
} from './fallbackExecutions.js';
import {
  acknowledgeNativeTaskCancellation,
  cancelNativeTask,
  getNativeTask,
  retryNativeTaskOperation,
  updateNativeTaskInputs
} from './nativeTaskService.js';
import {
  DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS,
  EXECUTION_ABORTED_CODE,
  SYNCHRONOUS_EXECUTION_LIMIT_CODE,
  TASK_ELIGIBILITY,
  selectExecutionMode
} from './executionMode.js';
import {
  MCP_PROTOCOL_VERSION,
  TASK_EXECUTION_MODE,
  TASK_METHODS,
  createInvalidTasksCapabilityError,
  createMissingTasksCapabilityError,
  negotiateTasksCapability,
  validateJsonRpcRequestEnvelope,
  validJsonRpcId
} from './protocol.js';
import {
  completeNativeToolTask,
  createNativeToolTask,
  failNativeToolTask,
  nativeToolTaskSignal
} from './nativeToolTasks.js';
import { createRelaiRequestStateCodec } from './context.js';
import { toolResult } from './results.js';
import { catalogApprovalRequirement, resolveToolOperation } from '../tools/actionCatalog.js';
import { getToolSchemas } from '../tools/schema.js';
import { validateToolOutput } from '../tools/outputValidation.js';
import { principalIdentity } from './principal.js';
import { MCP_SERVER_INFO } from '../mcpServer.js';

const TRANSPORT_CLEANUP_GRACE_MS = 5000;
const TRANSPORT_TOOL_VALIDATORS = new Map(getToolSchemas().map(tool => [
  tool.name,
  fromJsonSchema(tool.inputSchema)['~standard']
]));

async function handleTransportTaskRequest(config, message, options = {}) {
  if (!isTransportTaskRequestCandidate(config, message)) return null;
  const envelope = validateJsonRpcRequestEnvelope(message);
  if (!envelope.ok) return errorResponse(null, envelope.code, envelope.error, envelope.data);
  const method = String(message.method || '');
  const capabilities = clientCapabilities(message);

  if (TASK_METHODS.includes(method)) {
    if (message.id == null) return notificationHandled();
    return handleTaskProtocolRequest(config, message, options.principal, capabilities);
  }
  if (method !== 'tools/call' || message.id == null) return null;

  const name = String(message.params?.name || '');
  const definition = transportToolDefinition(name, message.params?.arguments || {});
  if (!shouldInterceptTool(definition, message.params?.arguments)) return null;

  const validated = await validateToolArguments(config, name, message.params?.arguments);
  if (!validated.ok) return errorResponse(message.id, -32602, validated.error);

  const bounds = options.synchronousBounds || DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS;
  const execute = typeof options.executeToolResult === 'function'
    ? options.executeToolResult
    : executeToolResult;
  const estimate = synchronousEstimate(name, validated.value, bounds, options);
  const selection = selectExecutionMode({
    clientCapabilities: capabilities,
    taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
    canCompleteSynchronously: estimate.safe,
    estimatedDurationMs: estimate.durationMs,
    synchronousBounds: bounds,
    abortSignals: options.signal ? [options.signal] : []
  });
  if (!selection.ok) {
    if (selection.capability.valid
      && !selection.capability.supported
      && selection.error?.reason === 'native_tasks_required') {
      return runFallbackToolExecution(config, message, validated.value, {
        ...options,
        capabilities,
        execute
      });
    }
    return errorFromPolicy(message.id, selection.error);
  }

  if (selection.mode === TASK_EXECUTION_MODE.NATIVE_TASKS) {
    return startNativeToolExecution(config, message, validated.value, {
      ...options,
      capabilities,
      bounds: selection.bounds,
      message
    });
  }

  const bounded = await runBoundedExecution(
    signal => execute(config, name, validated.value, {
      ...options,
      capabilities,
      signal,
      requestId: message.id,
      message
    }),
    { bounds: selection.bounds, signal: selection.signal }
  );
  if (!bounded.ok) return toolExecutionErrorResponse(message.id, bounded.error);
  return successResponse(message.id, bounded.value);
}

function shouldInterceptTool(definition, args = {}) {
  // Eligibility is intentionally broader than current client support. Interception
  // keeps short bounded calls synchronous and detaches only calls that do not fit
  // the safe response window when the client has not advertised Native Tasks.
  return definition?.behavior?.executionClass === 'native_task_eligible'
    && definition?.behavior?.longRunning === true
    && !catalogApprovalRequirement(definition.name, args || {});
}

function transportToolDefinition(name, args = {}) {
  const resolution = resolveToolOperation(name, args);
  if (!resolution) return null;
  return {
    name: String(name || ''),
    behavior: resolution.catalogEntry?.behavior || resolution.definition?.behavior || null
  };
}

function isTransportTaskRequestCandidate(config, message) {
  if (!isModernRequest(message)) return false;
  const method = String(message?.method || '');
  if (TASK_METHODS.includes(method)) return true;
  if (method !== 'tools/call') return false;
  const name = String(message?.params?.name || '');
  try {
    const definition = transportToolDefinition(name, message?.params?.arguments || {});
    return shouldInterceptTool(definition, message?.params?.arguments);
  } catch {
    // Invalid tool arguments belong to the SDK's normal schema-validation path.
    // Interception must never terminate the transport while probing eligibility.
    return false;
  }
}

function synchronousEstimate(_name, args, bounds, options = {}) {
  const timeoutMs = Number(args?.timeoutMs);
  const explicitBound = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const directDurationLimit = Math.min(bounds.maxDurationMs, 10_000);
  const commandCount = Array.isArray(args?.checks)
    ? args.checks.length
    : Array.isArray(args?.commands)
      ? args.commands.length
      : args?.check || args?.command
        ? 1
        : Number.POSITIVE_INFINITY;
  const safe = options.synchronousFallback !== false
    && explicitBound
    && timeoutMs <= directDurationLimit
    && commandCount <= 1;
  return {
    safe,
    durationMs: explicitBound ? timeoutMs : undefined
  };
}

async function runFallbackToolExecution(config, message, args, options = {}) {
  const name = String(message.params?.name || '');
  const workId = String(args.work_id || '').trim();
  const graceMs = Math.max(0, Number(options.synchronousFallbackGraceMs ?? DEFAULT_FALLBACK_GRACE_MS));
  let started;
  try {
    started = startFallbackExecution({
      workId,
      tool: name,
      workspace: String(args.workspace || ''),
      signature: fallbackSignature(name, args),
      run: () => options.execute(config, name, args, {
        ...options,
        signal: undefined,
        requestId: `fallback:${workId}`,
        message
      })
    });
  } catch (error) {
    return successResponse(message.id, toolResult({
      ok: false,
      work_id: workId,
      error: error instanceof Error ? error.message : String(error),
      errorCode: String(error?.code || 'TASK_OPERATION_IN_PROGRESS'),
      nextAction: `Call relai_work with action "status" and work_id "${workId}" before starting another long operation.`
    }, false));
  }

  if (!started.reused && graceMs > 0) {
    const settled = await waitForFallbackGrace(started.record.promise, graceMs);
    if (settled.kind === 'settled') {
      if (settled.value.ok) return successResponse(message.id, settled.value.result);
      return successResponse(message.id, toolResult({
        ok: false,
        work_id: workId,
        error: settled.value.error instanceof Error ? settled.value.error.message : String(settled.value.error || 'Long-running operation failed.'),
        errorCode: 'TOOL_EXECUTION_FAILED'
      }, true));
    }
  }

  return successResponse(message.id, toolResult({
    ok: true,
    workspace: String(args.workspace || ''),
    work_id: workId,
    status: 'running',
    message: `${name} is still running safely after this request returns.`,
    nextAction: `Call relai_work with action "status" and work_id "${workId}" to get the result.`
  }, false));
}

async function waitForFallbackGrace(execution, graceMs) {
  let timer;
  try {
    return await Promise.race([
      execution.then(value => ({ kind: 'settled', value })),
      new Promise(resolve => {
        timer = setTimeout(() => resolve({ kind: 'pending' }), graceMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleTaskProtocolRequest(config, message, principal, capabilities) {
  const capability = negotiateTasksCapability(capabilities);
  if (!capability.valid) {
    const error = createInvalidTasksCapabilityError(capability);
    return errorResponse(message.id, error.code, error.message, error.data);
  }
  if (!capability.supported) {
    const error = createMissingTasksCapabilityError();
    return errorResponse(message.id, error.code, error.message, error.data);
  }
  try {
    const taskId = String(message.params?.taskId || '');
    if (message.method === 'tasks/get') {
      const task = await retryNativeTaskOperation(() => getNativeTask(config, taskId, { principal }));
      return successResponse(message.id, { resultType: 'complete', ...task });
    }
    if (message.method === 'tasks/update') {
      await retryNativeTaskOperation(() => updateNativeTaskInputs(config, taskId, message.params?.inputResponses, { principal }));
      return successResponse(message.id, { resultType: 'complete' });
    }
    await retryNativeTaskOperation(() => cancelNativeTask(config, taskId, {
      principal,
      statusMessage: 'Native MCP task cancellation requested by the client.'
    }));
    return successResponse(message.id, { resultType: 'complete' });
  } catch (error) {
    return nativeTaskErrorResponse(message.id, error);
  }
}

async function startNativeToolExecution(config, message, args, options) {
  const name = String(message.params?.name || '');
  const operation = createNativeToolTask(config, {
    principal: options.principal,
    method: 'tools/call',
    name,
    logicalTaskId: String(args.work_id || ''),
    workspace: String(args.workspace || ''),
    message: `${name} is running as a native MCP task.`
  });
  const taskId = operation.taskId;
  const signal = nativeToolTaskSignal(taskId);
  queueMicrotask(() => {
    void executeToolResult(config, name, {
      ...args,
      _operationTaskId: taskId
    }, {
      ...options,
      signal,
      requestId: message.id,
      nativeTaskId: taskId
    }).then(async result => {
      if (signal?.aborted) {
        await retryNativeTaskOperation(() => acknowledgeNativeTaskCancellation(config, taskId, {
          principal: options.principal,
          executionStopped: true,
          statusMessage: 'Native MCP task cancelled.'
        }));
        return;
      }
      await completeNativeToolTask(config, taskId, result);
    }).catch(async error => {
      try {
        if (signal?.aborted) {
          await retryNativeTaskOperation(() => acknowledgeNativeTaskCancellation(config, taskId, {
            principal: options.principal,
            executionStopped: true,
            statusMessage: 'Native MCP task cancelled.'
          }));
          return;
        }
        await failNativeToolTask(config, taskId, error);
      } catch (settlementError) {
        if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] native task settlement failure:', settlementError);
      }
    });
  });
  const task = await retryNativeTaskOperation(() => getNativeTask(config, taskId, { principal: options.principal }));
  return successResponse(message.id, {
    resultType: 'task',
    ...task
  });
}

async function executeToolResult(config, name, args, options = {}) {
  const { invokeRelaiTool } = await import('./toolInvocation.js');
  return invokeRelaiTool({
    config,
    name,
    args,
    context: transportToolContext(options),
    approvalContext: options.approvalContext,
    requestStateCodec: options.requestStateCodec || createRelaiRequestStateCodec(config, options.principal),
    validateOutput: output => validateToolOutput(config, name, args || {}, output)
  });
}

async function validateToolArguments(config, name, value) {
  const args = value == null ? {} : value;
  if (!isPlainObject(args)) return { ok: false, error: `Invalid arguments for tool ${name}: arguments must be an object.` };
  const validator = TRANSPORT_TOOL_VALIDATORS.get(name);
  if (!validator) return { ok: false, error: `Tool ${name} not found.` };
  const result = await validator.validate(args);
  if (result.issues) {
    return {
      ok: false,
      error: `Invalid arguments for tool ${name}: ${result.issues.map(issue => issue.message).join('; ')}`
    };
  }
  return { ok: true, value: result.value };
}

async function runBoundedExecution(executor, options = {}) {
  const bounds = options.bounds || DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS;
  const timeoutController = new AbortController();
  const signal = combineAbortSignals(options.signal, timeoutController.signal);
  let timedOut = false;
  const execution = Promise.resolve().then(() => executor(signal)).then(
    value => ({ kind: 'value', value }),
    error => ({ kind: 'error', error })
  );
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error('Bounded synchronous execution timed out.'));
      resolve({ kind: 'timeout' });
    }, bounds.maxDurationMs);
  });
  const aborted = signal ? new Promise(resolve => {
    if (signal.aborted) return resolve({ kind: 'aborted' });
    signal.addEventListener('abort', () => resolve({ kind: timedOut ? 'timeout' : 'aborted' }), { once: true });
  }) : new Promise(() => {});
  const settled = await Promise.race([execution, timeout, aborted]);
  clearTimeout(timer);

  if (settled.kind === 'timeout' || timedOut) {
    await awaitCleanup(execution);
    return { ok: false, error: executionLimitError('synchronous_timeout', 'Bounded synchronous execution exceeded its maximum duration.', bounds) };
  }
  if (settled.kind === 'aborted') {
    timeoutController.abort(options.signal?.reason);
    await awaitCleanup(execution);
    return { ok: false, error: abortedExecutionError() };
  }
  if (settled.kind === 'error') throw settled.error;
  return { ok: true, value: settled.value };
}

async function awaitCleanup(execution) {
  let timer;
  try {
    await Promise.race([
      execution,
      new Promise(resolve => {
        timer = setTimeout(resolve, TRANSPORT_CLEANUP_GRACE_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function transportToolContext(options) {
  const meta = objectValue(options.envelope);
  const client = objectValue(meta[CLIENT_INFO_META_KEY]);
  return {
    publicHttpOnly: options.publicHttpOnly === true || options.transportType === 'streamable-http',
    requestId: options.requestId,
    transportType: String(options.transportType || 'stdio'),
    protocolVersion: String(options.protocolVersion || MCP_PROTOCOL_VERSION),
    clientName: String(client.name || ''),
    clientVersion: String(client.version || ''),
    clientCapabilities: options.capabilities || {},
    requestHeaders: options.requestHeaders || {},
    principal: options.principal || principalIdentity(options.principal),
    signal: options.signal,
    nativeTaskId: options.nativeTaskId,
    mcp: {
      envelope: meta,
      method: 'tools/call',
      authInfo: options.authInfo || null,
      inputResponses: options.inputResponses ?? null
    }
  };
}

function clientCapabilities(message) {
  return objectValue(message?.params?._meta)[CLIENT_CAPABILITIES_META_KEY];
}

function isModernRequest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
  return String(objectValue(message.params?._meta)[PROTOCOL_VERSION_META_KEY] || '') === MCP_PROTOCOL_VERSION;
}

function nativeTaskErrorResponse(id, error) {
  if (error?.code === 'NATIVE_TASK_UNAVAILABLE') {
    return errorResponse(id, -32602, 'Invalid task ID or task is not available to this client.');
  }
  if (error?.code === 'NATIVE_TASK_INVALID_REQUEST') {
    return errorResponse(id, -32602, error.message, { reason: error.reason || 'invalid_task_request' });
  }
  if (error?.code === 'NATIVE_TASK_STORE_ERROR') {
    const corrupt = error.reason === 'record_corrupt';
    return errorResponse(id, -32603, corrupt ? 'Native task record is corrupt.' : 'Native task storage is unavailable.', {
      reason: corrupt ? 'task_record_corrupt' : (error.reason || 'task_store_unavailable'),
      retryable: corrupt ? false : error.retryable !== false
    });
  }
  return errorResponse(id, -32603, 'Native task request failed.', { reason: 'internal_error', retryable: true });
}

function executionLimitError(reason, message, bounds) {
  const error = new Error(message);
  error.code = SYNCHRONOUS_EXECUTION_LIMIT_CODE;
  error.reason = reason;
  error.retryable = reason === 'synchronous_timeout';
  error.data = { reason, limits: bounds };
  return error;
}

function abortedExecutionError() {
  const error = new Error('Bounded synchronous execution was cancelled because the request or connection closed.');
  error.code = EXECUTION_ABORTED_CODE;
  error.reason = 'execution_aborted';
  error.retryable = true;
  error.data = { reason: 'execution_aborted' };
  return error;
}

function toolExecutionErrorResponse(id, error) {
  const message = String(error?.message || 'Tool execution failed.');
  const errorCode = executionErrorCode(error);
  return successResponse(id, {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: { ok: false, error: message, errorCode }
  });
}

function executionErrorCode(error) {
  switch (String(error?.reason || '')) {
    case 'synchronous_timeout': return 'SYNCHRONOUS_EXECUTION_TIMEOUT';
    case 'execution_aborted': return 'EXECUTION_ABORTED';
    default: return String(error?.code || 'TOOL_EXECUTION_FAILED');
  }
}

function errorFromPolicy(id, error) {
  return errorResponse(id, Number(error?.code) || -32603, error?.message || 'Execution mode is unsupported.', error?.data);
}

function successResponse(id, result) {
  if (id == null) return notificationHandled();
  if (!validJsonRpcId(id)) return errorResponse(null, -32600, 'JSON-RPC id must be a string or finite number when present.');
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id,
      result: stampServerInfo(result)
    }
  };
}

function stampServerInfo(result) {
  if (!isPlainObject(result)) return result;
  const meta = result._meta;
  if (meta === undefined) return { ...result, _meta: { [SERVER_INFO_META_KEY]: MCP_SERVER_INFO } };
  if (!isPlainObject(meta) || meta[SERVER_INFO_META_KEY] !== undefined) return result;
  return { ...result, _meta: { ...meta, [SERVER_INFO_META_KEY]: MCP_SERVER_INFO } };
}

function notificationHandled() {
  return { status: 204, body: null, notification: true };
}

function errorResponse(id, code, message, data) {
  return {
    status: 200,
    body: {
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data === undefined ? {} : { data }) }
    }
  };
}

function objectValue(value) {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createTaskAwareStdioTransport(options = {}) {
  const transport = options.transport || new StdioServerTransport();
  const sessionController = new AbortController();
  const pending = new Map();
  const wrapper = {
    onclose: undefined,
    onerror: undefined,
    onmessage: undefined,
    async start() {
      transport.onmessage = message => { void intercept(message); };
      transport.onerror = error => wrapper.onerror?.(error);
      transport.onclose = () => {
        sessionController.abort(new Error('Stdio connection closed.'));
        for (const controller of pending.values()) controller.abort(new Error('Stdio connection closed.'));
        pending.clear();
        wrapper.onclose?.();
      };
      await transport.start();
    },
    async close() {
      sessionController.abort(new Error('Stdio connection closed.'));
      for (const controller of pending.values()) controller.abort(new Error('Stdio connection closed.'));
      pending.clear();
      await transport.close();
    },
    send(message, sendOptions) {
      return transport.send(message, sendOptions);
    },
    setProtocolVersion(version) {
      transport.setProtocolVersion?.(version);
    }
  };

  async function intercept(message) {
    if (message?.method === 'notifications/cancelled') {
      const controller = pending.get(message.params?.requestId);
      if (controller) {
        controller.abort(new Error('MCP request cancelled by the client.'));
        return;
      }
      wrapper.onmessage?.(message);
      return;
    }
    if (!isTransportTaskRequestCandidate(options.config, message)) {
      wrapper.onmessage?.(message);
      return;
    }
    const controller = message?.id == null ? null : new AbortController();
    if (controller) pending.set(message.id, controller);
    try {
      const response = await handleTransportTaskRequest(options.config, message, {
        principal: options.principal,
        transportType: 'stdio',
        envelope: objectValue(message?.params?._meta),
        signal: combineAbortSignals(sessionController.signal, controller?.signal),
        synchronousBounds: options.synchronousBounds,
        synchronousFallback: options.synchronousFallback
      });
      if (response) {
        if (response.body != null) await transport.send(response.body);
        return;
      }
      wrapper.onmessage?.(message);
    } catch (error) {
      if (message?.id != null) {
        await transport.send(errorResponse(message.id, -32603, 'Internal server error.').body).catch(() => {});
      }
      wrapper.onerror?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      if (controller) pending.delete(message.id);
    }
  }

  return wrapper;
}

export {
  createTaskAwareStdioTransport,
  handleTransportTaskRequest,
  isTransportTaskRequestCandidate,
  runBoundedExecution
};
