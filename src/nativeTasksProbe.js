'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CLIENT_CAPABILITIES_META_KEY, fromJsonSchema } = require('@modelcontextprotocol/server');
const { getStateDir } = require('./audit');
const { toolResult } = require('./mcp/results');

const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const PROBE_TOOL_NAME = 'relai_native_tasks_probe';
const PROBE_ENV_NAME = 'REL_AI_NATIVE_TASKS_PROBE';
const DEFAULT_DURATION_MS = 5000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 30000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const TASK_TTL_MS = 10 * 60 * 1000;
const TASK_ID_PATTERN = /^probe_[A-Za-z0-9_-]{20,160}$/;

function nativeTasksProbeEnabled() {
  return process.env[PROBE_ENV_NAME] === '1';
}

function clientSupportsNativeTasks(capabilities) {
  const extensions = capabilities?.extensions;
  return Boolean(extensions && Object.hasOwn(extensions, TASKS_EXTENSION_ID));
}

function clientCapabilitiesFromMessage(message) {
  return message?.params?._meta?.[CLIENT_CAPABILITIES_META_KEY] || {};
}

function nativeTasksServerCapability() {
  return nativeTasksProbeEnabled() ? { [TASKS_EXTENSION_ID]: {} } : null;
}

function registerNativeTasksProbeTool(server, options = {}) {
  if (!nativeTasksProbeEnabled()) return false;
  server.registerTool(PROBE_TOOL_NAME, {
    title: 'Probe Native MCP Tasks',
    description: 'Diagnostic canary for native MCP Tasks support. With the probe flag enabled, an HTTP client that advertises io.modelcontextprotocol/tasks receives a native asynchronous task. Other clients receive a synchronous capability report.',
    inputSchema: fromJsonSchema({
      type: 'object',
      properties: {
        durationMs: { type: 'number', minimum: MIN_DURATION_MS, maximum: MAX_DURATION_MS },
        label: { type: 'string', maxLength: 120 }
      },
      additionalProperties: false
    }),
    outputSchema: fromJsonSchema({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        probeEnabled: { type: 'boolean' },
        extensionId: { type: 'string' },
        clientAdvertisedTasks: { type: 'boolean' },
        transport: { type: 'string' },
        nativeTaskReturned: { type: 'boolean' },
        message: { type: 'string' },
        nextAction: { type: 'string' }
      },
      required: ['ok', 'probeEnabled', 'extensionId', 'clientAdvertisedTasks', 'transport', 'nativeTaskReturned', 'message'],
      additionalProperties: false
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }, async (_args, context) => {
    const envelope = context?.mcpReq?.envelope || {};
    const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY] || {};
    const clientAdvertisedTasks = clientSupportsNativeTasks(capabilities);
    const transport = String(options.transportType || (context?.http ? 'streamable-http' : 'stdio'));
    const nativeEligible = clientAdvertisedTasks && transport === 'streamable-http';
    return toolResult({
      ok: true,
      probeEnabled: true,
      extensionId: TASKS_EXTENSION_ID,
      clientAdvertisedTasks,
      transport,
      nativeTaskReturned: false,
      message: clientAdvertisedTasks
        ? 'The client advertised native MCP Tasks, but this call reached the synchronous fallback instead of the HTTP extension adapter.'
        : 'The client did not advertise the native MCP Tasks extension on this tool call.',
      nextAction: nativeEligible
        ? 'Inspect the HTTP adapter logs and request envelope; a native-capable HTTP call should return resultType task before SDK dispatch.'
        : 'Reconnect the MCP app after enabling the probe, then invoke this tool from the client being tested.'
    }, false);
  });
  return true;
}

function expectedNativeTaskName(method, params = {}) {
  if (!nativeTasksProbeEnabled()) return '';
  if (['tasks/get', 'tasks/update', 'tasks/cancel'].includes(String(method || ''))) {
    return String(params.taskId || '');
  }
  return '';
}

function handleNativeTasksProbeRequest(config, message, principal = '') {
  if (!nativeTasksProbeEnabled() || !message || typeof message !== 'object') return null;
  const method = String(message.method || '');
  const capabilities = clientCapabilitiesFromMessage(message);
  const supportsTasks = clientSupportsNativeTasks(capabilities);

  if (method === 'tools/call' && message.params?.name === PROBE_TOOL_NAME) {
    if (!supportsTasks) return null;
    try {
      const args = normalizeProbeArguments(message.params?.arguments);
      const task = createProbeTask(config, { ...args, principal });
      return successResponse(message.id, { resultType: 'task', ...publicTask(task) });
    } catch (error) {
      return errorResponse(message.id, -32602, error instanceof Error ? error.message : String(error));
    }
  }

  if (!['tasks/get', 'tasks/update', 'tasks/cancel'].includes(method)) return null;
  if (!supportsTasks) {
    return errorResponse(message.id, -32003, 'Missing required client capability', {
      requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } }
    });
  }

  try {
    const taskId = validateTaskId(message.params?.taskId);
    const task = requireOwnedTask(config, taskId, principal);
    if (method === 'tasks/get') {
      const refreshed = refreshProbeTask(config, task);
      return successResponse(message.id, { resultType: 'complete', ...detailedTask(refreshed) });
    }
    if (method === 'tasks/cancel') {
      cancelProbeTask(config, task);
      return successResponse(message.id, { resultType: 'complete' });
    }
    return successResponse(message.id, { resultType: 'complete' });
  } catch (_error) {
    return errorResponse(message.id, -32602, 'Invalid task ID or task is not available to this client.');
  }
}

function normalizeProbeArguments(value) {
  const args = value == null ? {} : value;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Probe arguments must be an object.');
  const allowed = new Set(['durationMs', 'label']);
  const unknown = Object.keys(args).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown probe argument: ${unknown[0]}`);
  const durationMs = args.durationMs == null ? DEFAULT_DURATION_MS : Number(args.durationMs);
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new Error(`durationMs must be between ${MIN_DURATION_MS} and ${MAX_DURATION_MS}.`);
  }
  const label = String(args.label || '').trim().slice(0, 120) || 'ChatGPT native MCP Tasks probe';
  return { durationMs: Math.round(durationMs), label };
}

function taskDirectory(config) {
  return path.join(getStateDir(config), 'native-task-probes');
}

function taskPath(config, taskId) {
  return path.join(taskDirectory(config), `${validateTaskId(taskId)}.json`);
}

function validateTaskId(taskId) {
  const value = String(taskId || '').trim();
  if (!TASK_ID_PATTERN.test(value)) throw new Error('Invalid native task probe ID.');
  return value;
}

function principalFingerprint(principal) {
  return crypto.createHash('sha256').update(String(principal || 'anonymous')).digest('base64url');
}

function createProbeTask(config, options) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const task = {
    taskId: `probe_${crypto.randomBytes(24).toString('base64url')}`,
    status: 'working',
    statusMessage: `${options.label} is running.`,
    createdAt: now,
    lastUpdatedAt: now,
    ttlMs: TASK_TTL_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    durationMs: options.durationMs,
    completeAtMs: nowMs + options.durationMs,
    principalFingerprint: principalFingerprint(options.principal),
    result: null
  };
  persistTask(config, task);
  return task;
}

function readProbeTask(config, taskId) {
  try {
    const task = JSON.parse(fs.readFileSync(taskPath(config, taskId), 'utf8'));
    const createdAtMs = Date.parse(task.createdAt || 0);
    if (!Number.isFinite(createdAtMs) || Date.now() > createdAtMs + Number(task.ttlMs || TASK_TTL_MS)) {
      fs.rmSync(taskPath(config, taskId), { force: true });
      return null;
    }
    return task;
  } catch {
    return null;
  }
}

function requireOwnedTask(config, taskId, principal) {
  const task = readProbeTask(config, taskId);
  if (!task || task.principalFingerprint !== principalFingerprint(principal)) throw new Error('Task unavailable.');
  return task;
}

function refreshProbeTask(config, task) {
  if (task.status !== 'working' || Date.now() < Number(task.completeAtMs || 0)) return task;
  task.status = 'completed';
  task.statusMessage = 'Native MCP Tasks probe completed.';
  task.lastUpdatedAt = new Date().toISOString();
  task.result = {
    content: [{ type: 'text', text: 'Native MCP Tasks probe completed. The client successfully retrieved the final tool result through tasks/get.' }],
    structuredContent: {
      ok: true,
      nativeTasksProbe: true,
      extensionId: TASKS_EXTENSION_ID,
      taskId: task.taskId,
      durationMs: task.durationMs,
      completedAt: task.lastUpdatedAt
    },
    isError: false
  };
  persistTask(config, task);
  return task;
}

function cancelProbeTask(config, task) {
  if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
  task.status = 'cancelled';
  task.statusMessage = 'Native MCP Tasks probe cancelled by the client.';
  task.lastUpdatedAt = new Date().toISOString();
  persistTask(config, task);
  return task;
}

function persistTask(config, task) {
  const directory = taskDirectory(config);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = taskPath(config, task.taskId);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function publicTask(task) {
  return {
    taskId: task.taskId,
    status: task.status,
    statusMessage: task.statusMessage,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    ttlMs: task.ttlMs,
    pollIntervalMs: task.pollIntervalMs
  };
}

function detailedTask(task) {
  return {
    ...publicTask(task),
    ...(task.status === 'completed' && task.result ? { result: task.result } : {})
  };
}

function successResponse(id, result) {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, result } };
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

module.exports = {
  TASKS_EXTENSION_ID,
  PROBE_TOOL_NAME,
  PROBE_ENV_NAME,
  nativeTasksProbeEnabled,
  clientSupportsNativeTasks,
  nativeTasksServerCapability,
  registerNativeTasksProbeTool,
  expectedNativeTaskName,
  handleNativeTasksProbeRequest
};
