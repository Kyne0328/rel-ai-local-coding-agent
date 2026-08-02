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
  acknowledgeNativeTaskCancellation,
  cancelNativeTask,
  getNativeTask,
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
  completeOperationTask,
  createOperationTask,
  failOperationTask,
  operationTaskSignal
} from '../operationTasks.js';
import { approvalRequirement } from './approval.js';
import { createRelaiRequestStateCodec } from './context.js';
import { invokeRelaiTool } from './toolInvocation.js';
import { getToolDefinition, getToolSchemas } from '../tools.js';
import { validateToolOutput } from '../tools/outputValidation.js';
import { principalIdentity } from './principal.js';
import { MCP_SERVER_INFO } from '../mcpServer.js';

const TRANSPORT_CLEANUP_GRACE_MS = 5000;

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
  const definition = getToolDefinition(name, config, message.params?.arguments || {});
  if (!shouldInterceptTool(definition, message.params?.arguments)) return null;

  const validated = await validateToolArguments(config, name, message.params?.arguments);
  if (!validated.ok) return errorResponse(message.id, -32602, validated.error);

  const bounds = options.synchronousBounds || DEFAULT_SYNCHRONOUS_EXECUTION_BOUNDS;
  const estimate = synchronousEstimate(name, validated.value, capabilities, bounds, options);
  const selection = selectExecutionMode({
    clientCapabilities: capabilities,
    taskEligibility: TASK_ELIGIBILITY.ELIGIBLE,
    canCompleteSynchronously: estimate.safe,
    estimatedDurationMs: estimate.durationMs,
    estimatedOutputBytes: estimate.outputBytes,
    synchronousBounds: bounds,
    abortSignals: options.signal ? [options.signal] : []
  });
  if (!selection.ok) return errorFromPolicy(message.id, selection.error);

  if (selection.mode === TASK_EXECUTION_MODE.NATIVE_TASKS) {
    return createNativeToolTask(config, message, validated.value, {
      ...options,
      capabilities,
      bounds: selection.bounds,
      message
    });
  }

  const execute = typeof options.executeToolResult === 'function'
    ? options.executeToolResult
    : executeToolResult;
  const bounded = await runBoundedExecution(
    signal => execute(config, name, boundedArguments(name, validated.value, selection.bounds), {
      ...options,
      capabilities,
      signal,
      requestId: message.id,
      message
    }),
    { bounds: selection.bounds, signal: selection.signal }
  );
  if (!bounded.ok) return errorFromPolicy(message.id, bounded.error);
  return successResponse(message.id, bounded.value);
}

function shouldInterceptTool(definition, args = {}) {
  return definition?.behavior?.executionClass === 'native_task_eligible'
    && definition?.behavior?.longRunning === true
    && !approvalRequirement(definition.name, args || {});
}

function isTransportTaskRequestCandidate(config, message) {
  if (!isModernRequest(message)) return false;
  const method = String(message?.method || '');
  if (TASK_METHODS.includes(method)) return true;
  if (method !== 'tools/call') return false;
  const name = String(message?.params?.name || '');
  try {
    const definition = getToolDefinition(name, config, message?.params?.arguments || {});
    return shouldInterceptTool(definition, message?.params?.arguments);
  } catch {
    // Invalid tool arguments belong to the SDK's normal schema-validation path.
    // Interception must never terminate the transport while probing eligibility.
    return false;
  }
}

function synchronousEstimate(name, args, capabilities, bounds, options = {}) {
  const tasksSupported = negotiateTasksCapability(capabilities).supported;
  if (!tasksSupported) {
    return {
      safe: options.synchronousFallback !== false,
      durationMs: bounds.maxDurationMs,
      outputBytes: bounds.maxCapturedOutputBytes
    };
  }
  const timeoutMs = Number(args?.timeoutMs);
  const explicitBound = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const directDurationLimit = Math.min(bounds.maxDurationMs, 10_000);
  let outputBytes = bounds.maxCapturedOutputBytes;
  if (name === 'relai_exec') outputBytes = Math.min(Number(args?.maxOutputBytes) || outputBytes, outputBytes);
  else outputBytes = Math.min(outputBytes, 512 * 1024);
  const commandCount = Array.isArray(args?.checks)
    ? args.checks.length
    : Array.isArray(args?.commands)
      ? args.commands.length
      : args?.check || args?.command
        ? 1
        : Number.POSITIVE_INFINITY;
  const safe = explicitBound
    && timeoutMs <= directDurationLimit
    && outputBytes <= bounds.maxCapturedOutputBytes
    && commandCount <= 1;
  return {
    safe,
    durationMs: explicitBound ? timeoutMs : undefined,
    outputBytes
  };
}

function handleTaskProtocolRequest(config, message, principal, capabilities) {
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
      return successResponse(message.id, { resultType: 'complete', ...getNativeTask(config, taskId, { principal }) });
    }
    if (message.method === 'tasks/update') {
      updateNativeTaskInputs(config, taskId, message.params?.inputResponses, { principal });
      return successResponse(message.id, { resultType: 'complete' });
    }
    cancelNativeTask(config, taskId, {
      principal,
      statusMessage: 'Native MCP task cancellation requested by the client.'
    });
    return successResponse(message.id, { resultType: 'complete' });
  } catch (error) {
    return nativeTaskErrorResponse(message.id, error);
  }
}

function createNativeToolTask(config, message, args, options) {
  const name = String(message.params?.name || '');
  const operation = createOperationTask(config, {
    principal: options.principal,
    method: 'tools/call',
    name,
    logicalTaskId: String(args.work_id || ''),
    workspace: String(args.workspace || ''),
    message: `${name} is running as a native MCP task.`
  });
  const taskId = operation.taskId;
  const signal = operationTaskSignal(config, taskId);
  queueMicrotask(() => {
    void executeToolResult(config, name, {
      ...args,
      _operationTaskId: taskId
    }, {
      ...options,
      signal,
      requestId: message.id,
      nativeTaskId: taskId
    }).then(result => {
      if (signal?.aborted) {
        acknowledgeNativeTaskCancellation(config, taskId, {
          principal: options.principal,
          executionStopped: true,
          statusMessage: 'Native MCP task cancelled.'
        });
        return;
      }
      completeOperationTask(config, taskId, result);
    }).catch(error => {
      if (signal?.aborted) {
        acknowledgeNativeTaskCancellation(config, taskId, {
          principal: options.principal,
          executionStopped: true,
          statusMessage: 'Native MCP task cancelled.'
        });
        return;
      }
      failOperationTask(config, taskId, error);
    });
  });
  return successResponse(message.id, {
    resultType: 'task',
    ...getNativeTask(config, taskId, { principal: options.principal })
  });
}

async function executeToolResult(config, name, args, options = {}) {
  return invokeRelaiTool({
    config,
    name,
    args,
    context: transportToolContext(options),
    requestStateCodec: createRelaiRequestStateCodec(config, options.principal),
    validateOutput: output => validateToolOutput(config, name, args || {}, output)
  });
}

async function validateToolArguments(config, name, value) {
  const args = value == null ? {} : value;
  if (!isPlainObject(args)) return { ok: false, error: `Invalid arguments for tool ${name}: arguments must be an object.` };
  const schema = getToolSchemas(config).find(item => item.name === name)?.inputSchema;
  if (!schema) return { ok: false, error: `Tool ${name} not found.` };
  const result = await fromJsonSchema(schema)['~standard'].validate(args);
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
  const bytes = Buffer.byteLength(JSON.stringify(settled.value), 'utf8');
  if (bytes > bounds.maxCapturedOutputBytes) {
    return { ok: false, error: executionLimitError('synchronous_output_limit', 'Bounded synchronous execution exceeded its captured-output limit.', bounds, bytes) };
  }
  return { ok: true, value: settled.value, bytes };
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

function boundedArguments(name, args, bounds) {
  const value = { ...args };
  if (['relai_exec', 'relai_validate', 'relai_diagnostics_run', 'relai_run_checks'].includes(name)) {
    value.timeoutMs = Math.min(Number(args.timeoutMs) || bounds.maxDurationMs, bounds.maxDurationMs);
  }
  if (name === 'relai_exec') {
    value.maxOutputBytes = Math.min(Number(args.maxOutputBytes) || bounds.maxCapturedOutputBytes, bounds.maxCapturedOutputBytes);
  }
  return value;
}

function transportToolContext(options) {
  const meta = objectValue(options.envelope);
  const client = objectValue(meta[CLIENT_INFO_META_KEY]);
  return {
    publicHttpOnly: options.transportType === 'streamable-http',
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
      inputResponses: null
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

function executionLimitError(reason, message, bounds, capturedOutputBytes) {
  const error = new Error(message);
  error.code = SYNCHRONOUS_EXECUTION_LIMIT_CODE;
  error.reason = reason;
  error.retryable = reason === 'synchronous_timeout';
  error.data = {
    reason,
    limits: bounds,
    ...(capturedOutputBytes == null ? {} : { capturedOutputBytes })
  };
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
  TRANSPORT_CLEANUP_GRACE_MS,
  createTaskAwareStdioTransport,
  handleTransportTaskRequest,
  isTransportTaskRequestCandidate,
  runBoundedExecution
};
