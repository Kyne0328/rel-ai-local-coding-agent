const crypto = require('node:crypto');
const readline = require('node:readline');
const { getToolSchemas, getToolSurfaceManifest, callTool } = require('./tools');
const { serializeToolError } = require('./tools/errors');
const { listResources, readResource } = require('./resources');
const pkg = require('../package.json');

const SERVER_INSTANCE_ID = crypto.randomUUID();
const DEFAULT_MAX_TOOL_RESULT_BYTES = 512 * 1024;
const MAX_TOOL_RESULT_BYTES = Number(process.env.REL_AI_MCP_MAX_TOOL_RESULT_BYTES || process.env.REL_AI_MCP_MAX_TOOL_RESULT_CHARS || DEFAULT_MAX_TOOL_RESULT_BYTES);
const CLIENT_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CLIENT_CONTEXTS = 256;
const clientContexts = new Map();

function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const message = JSON.parse(trimmed);
      if (Array.isArray(message)) {
        const responses = [];
        for (const item of message) {
          const response = await handleMessage(item);
          if (response) responses.push(response);
        }
        if (responses.length > 0) write(responses);
        return;
      }
      const response = await handleMessage(message);
      if (response) write(response);
    } catch (error) {
      write(jsonRpcError(null, -32700, 'Parse error', error instanceof Error ? error.message : String(error)));
    }
  });
}

async function handleMessage(message, options = {}) {
  if (message?.jsonrpc !== '2.0') {
    return jsonRpcError(messageId(message), -32600, 'Invalid Request');
  }
  if (message.id === undefined) {
    await handleNotification(message);
    return null;
  }
  try {
    return await dispatchMessage(message, options);
  } catch (error) {
    return jsonRpcError(message.id, -32603, 'Internal error', error instanceof Error ? error.message : String(error));
  }
}

function messageId(message) {
  return message?.id !== undefined ? message.id : null;
}

async function dispatchMessage(message, options) {
  switch (message.method) {
    case 'initialize': {
      rememberClientContext(message, options);
      const toolSurface = getToolSurfaceManifest();
      return result(message.id, {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: false, listChanged: true },
          experimental: {
            relai: {
              toolSurfaceVersion: toolSurface.toolSurfaceVersion,
              taskIdentityVersion: 2,
              manifestResource: 'relai://server/tool-surface'
            }
          }
        },
        serverInfo: { name: pkg.name, version: pkg.version, toolSurfaceVersion: toolSurface.toolSurfaceVersion },
        instructions: 'For each independent user task, call relai_start_task exactly once and retain its opaque task_id. Pass that task_id to every subsequent Rel.AI tool call for the task, including validation and completion; never treat an MCP transport session, repository, or ChatGPT conversation as the task identity. Use the minimum number of workspace-tool calls needed. Call relai_repo_snapshot when an overview is useful and follow any projectInstructions it returns; earlier sources override later sources. Use relai_search when location is unknown and relai_read only when wider source is needed. Prefer relai_edit with runChecks:true and returnDiff:true. Completion is explicit: on the final standard or release relai_run_checks pass complete:true with summary, or call relai_complete_task with the same task_id after a final read-only review.'
      });
    }
    case 'ping':
      return result(message.id, {});
    case 'tools/list':
      return result(message.id, { tools: getToolSchemas() });
    case 'resources/list':
      return result(message.id, listResources());
    case 'resources/read':
      return handleResourceRead(message);
    case 'tools/call':
      return handleToolCall(message, options);
    default:
      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

function clientContextKey(options = {}) {
  const transportType = String(options.transportType || (options.publicHttpOnly ? 'http' : 'stdio'));
  const identity = String(options.transportSessionId || options.taskScopeId || (transportType === 'stdio' ? 'default' : 'anonymous'));
  return `${transportType}:${identity}`;
}

function rememberClientContext(message, options = {}) {
  const now = Date.now();
  for (const [key, value] of clientContexts) {
    if (now - Number(value.initializedAt || 0) > CLIENT_CONTEXT_TTL_MS) clientContexts.delete(key);
  }
  while (clientContexts.size >= MAX_CLIENT_CONTEXTS) clientContexts.delete(clientContexts.keys().next().value);
  const clientInfo = message.params?.clientInfo || {};
  clientContexts.set(clientContextKey(options), {
    clientName: String(clientInfo.name || ''),
    clientVersion: String(clientInfo.version || ''),
    initializationRequestId: message.id,
    initializedAt: now
  });
}

function readClientContext(options = {}) {
  return clientContexts.get(clientContextKey(options)) || {
    clientName: '',
    clientVersion: '',
    initializationRequestId: ''
  };
}

function handleResourceRead(message) {
  const uri = message.params?.uri;
  if (!uri) return jsonRpcError(message.id, -32602, 'Missing resource uri.');
  return result(message.id, readResource(uri));
}

async function handleToolCall(message, options) {
  const params = message.params || {};
  const clientContext = readClientContext(options);
  const name = params.name;
  if (!name) return jsonRpcError(message.id, -32602, 'Missing tool name.');
  try {
    const output = await callTool(name, params.arguments || {}, {
      publicHttpOnly: Boolean(options.publicHttpOnly),
      taskScopeId: String(options.taskScopeId || ''),
      requestId: message.id,
      serverInstanceId: SERVER_INSTANCE_ID,
      transportType: String(options.transportType || (options.publicHttpOnly ? 'http' : 'stdio')),
      transportSessionId: String(options.transportSessionId || ''),
      clientName: clientContext.clientName,
      clientVersion: clientContext.clientVersion,
      initializationRequestId: clientContext.initializationRequestId
    });
    return result(message.id, toolResult(output, output?.ok === false));
  } catch (error) {
    return result(message.id, toolResult(serializeToolError(name, error), true));
  }
}

async function handleNotification(message) {
  if (message.method === 'notifications/initialized' || message.method === 'initialized') return;
  console.error(`[rel-ai-mcp] ignored notification: ${message.method}`);
}

function toolResult(payload, isError) {
  const text = JSON.stringify(payload, null, 2);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_TOOL_RESULT_BYTES) {
    const preview = truncateUtf8Head(text, MAX_TOOL_RESULT_BYTES) + `\n\n[rel-ai-mcp truncated tool result: ${bytes} bytes total]`;
    return {
      content: [{ type: 'text', text: preview }],
      structuredContent: compactToolResult(payload, bytes),
      isError: Boolean(isError)
    };
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: payload,
    isError: Boolean(isError)
  };
}

function truncateUtf8Head(text, maxBytes) {
  const buffer = Buffer.from(String(text), 'utf8');
  return buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '');
}

function compactToolResult(payload, originalBytes) {
  if (!payload || typeof payload !== 'object') return { ok: false, truncated: true, originalBytes };
  const fallbackMessage = 'Result was truncated. Re-call with a narrower path, maxBytes, maxEntries, limit, or diff path.';
  const compact = {
    ok: payload.ok !== false,
    truncated: true,
    originalBytes,
    message: boundedText(payload.message, 2000) || fallbackMessage,
    workspace: payload.workspace || null,
    task_id: payload.task_id || payload.taskId || null,
    sessionId: payload.sessionId || null,
    error: boundedText(payload.error, 4000),
    errorCode: payload.errorCode,
    errorDetails: compactErrorDetails(payload.errorDetails),
    level: payload.level,
    validationStatus: payload.validationStatus,
    completionKnown: payload.completionKnown,
    endReason: payload.endReason,
    completionSource: payload.completionSource,
    summary: boundedText(payload.summary, 2000),
    validationAt: payload.validationAt,
    nextAction: boundedText(payload.nextAction, 2000),
    results: compactDiagnosticResults(payload.results),
    keys: Object.keys(payload).slice(0, 50)
  };
  return Object.fromEntries(Object.entries(compact).filter(([, value]) => value != null));
}

function compactDiagnosticResults(results) {
  if (!Array.isArray(results) || results.length === 0) return undefined;
  return results.slice(0, 5).map((item) => ({
    command: boundedText(item?.command, 1000),
    ok: item?.ok !== false,
    exitCode: item?.exitCode,
    timedOut: item?.timedOut === true,
    signal: item?.signal,
    stdout: tailText(item?.stdout, 2000),
    stderr: tailText(item?.stderr, 4000)
  })).map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value != null)));
}

function compactErrorDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  const text = boundedText(JSON.stringify(details), 4000);
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch { return { summary: text }; }
}

function boundedText(value, maxChars) {
  if (typeof value !== 'string' || !value) return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n[truncated]`;
}

function tailText(value, maxChars) {
  if (typeof value !== 'string' || !value) return undefined;
  return value.length <= maxChars ? value : `[kept last ${maxChars} chars]\n${value.slice(-maxChars)}`;
}

function result(id, value) {
  return { jsonrpc: '2.0', id, result: value };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

module.exports = { main, handleMessage, SERVER_INSTANCE_ID };
