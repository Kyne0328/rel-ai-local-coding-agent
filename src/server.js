const readline = require('node:readline');
const { getToolSchemas, callTool } = require('./tools');
const { listResources, readResource } = require('./resources');
const pkg = require('../package.json');

const MAX_TOOL_RESULT_CHARS = Number(process.env.REL_AI_MCP_MAX_TOOL_RESULT_CHARS || 120000);

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
    case 'initialize':
      return result(message.id, {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: true }, resources: { subscribe: false, listChanged: true } },
        serverInfo: { name: pkg.name, version: pkg.version }
      });
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

function handleResourceRead(message) {
  const uri = message.params?.uri;
  if (!uri) return jsonRpcError(message.id, -32602, 'Missing resource uri.');
  return result(message.id, readResource(uri));
}

async function handleToolCall(message, options) {
  const params = message.params || {};
  const name = params.name;
  if (!name) return jsonRpcError(message.id, -32602, 'Missing tool name.');
  try {
    const output = await callTool(name, params.arguments || {}, {
      publicHttpOnly: Boolean(options.publicHttpOnly),
      taskScopeId: String(options.taskScopeId || '')
    });
    return result(message.id, toolResult(output, false));
  } catch (error) {
    return result(message.id, toolResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, true));
  }
}

async function handleNotification(message) {
  if (message.method === 'notifications/initialized' || message.method === 'initialized') return;
  console.error(`[rel-ai-mcp] ignored notification: ${message.method}`);
}

function toolResult(payload, isError) {
  const text = JSON.stringify(payload, null, 2);
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    const preview = text.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n[rel-ai-mcp truncated tool result: ${text.length} chars total]`;
    return {
      content: [{ type: 'text', text: preview }],
      structuredContent: compactToolResult(payload, text.length),
      isError: Boolean(isError)
    };
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: payload,
    isError: Boolean(isError)
  };
}

function compactToolResult(payload, originalChars) {
  if (!payload || typeof payload !== 'object') return { ok: false, truncated: true, originalChars };
  return {
    ok: payload.ok !== false,
    truncated: true,
    originalChars,
    message: 'Result was truncated. Re-call with a narrower path, maxBytes, maxEntries, limit, or diff path.',
    workspace: payload.workspace || null,
    sessionId: payload.sessionId || null,
    keys: Object.keys(payload).slice(0, 50)
  };
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

module.exports = { main, handleMessage };
