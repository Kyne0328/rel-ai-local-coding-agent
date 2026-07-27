'use strict';

const crypto = require('node:crypto');
const { McpServer, fromJsonSchema } = require('@modelcontextprotocol/server');
const { getToolSchemas, getToolSurfaceManifest, callTool } = require('./tools');
const { readConfig } = require('./config');
const { serializeToolError } = require('./tools/errors');
const { listResources, readResource } = require('./resources');
const pkg = require('../package.json');

const SERVER_INSTANCE_ID = crypto.randomUUID();
const DEFAULT_MAX_TOOL_RESULT_BYTES = 512 * 1024;
const MAX_TOOL_RESULT_BYTES = Number(process.env.REL_AI_MCP_MAX_TOOL_RESULT_BYTES || process.env.REL_AI_MCP_MAX_TOOL_RESULT_CHARS || DEFAULT_MAX_TOOL_RESULT_BYTES);

function createRelaiMcpServer(options = {}) {
  const config = readConfig();
  const toolSurface = getToolSurfaceManifest();
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
    toolSurfaceVersion: toolSurface.toolSurfaceVersion
  }, {
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
    instructions: connectorInstructions(config)
  });

  for (const definition of getToolSchemas(config)) {
    server.registerTool(definition.name, {
      title: definition.title,
      description: definition.description,
      inputSchema: fromJsonSchema(definition.inputSchema),
      annotations: definition.annotations
    }, async (args, context) => {
      try {
        const output = await callTool(definition.name, args || {}, toolContext(server, context, options));
        return toolResult(output, output?.ok === false);
      } catch (error) {
        return toolResult(serializeToolError(definition.name, error), true);
      }
    });
  }

  for (const resource of listResources().resources) {
    server.registerResource(resource.name, resource.uri, {
      description: resource.description,
      mimeType: resource.mimeType
    }, async (uri) => readResource(uri.href));
  }

  return server;
}

function toolContext(server, context, options) {
  const client = server.server.getClientVersion?.() || {};
  const http = options.publicHttpOnly === true || Boolean(context.http);
  return {
    publicHttpOnly: http,
    requestId: context.mcpReq.id,
    serverInstanceId: SERVER_INSTANCE_ID,
    transportType: String(options.transportType || (http ? 'streamable-http' : 'stdio')),
    transportSessionId: String(context.sessionId || ''),
    clientName: String(client.name || ''),
    clientVersion: String(client.version || '')
  };
}

function connectorInstructions(config = readConfig()) {
  const aliases = Object.keys(config.workspaces || {}).sort((left, right) => left.localeCompare(right));
  const workspaceInstruction = aliases.length > 0
    ? `Use a configured workspace alias (${aliases.join(', ')}) or the exact absolute path registered for one of those workspaces. Never use a relative path such as ".".`
    : 'Use a configured workspace alias or the exact absolute path of a configured workspace. Never use a relative path such as ".".';
  return `For each independent user task, call relai_start_task exactly once and retain its opaque task_id. ${workspaceInstruction} Pass that task_id to every subsequent Rel.AI tool call for the task, including validation and completion; never treat an MCP transport session, repository, or ChatGPT conversation as the task identity. Use the minimum number of workspace-tool calls needed. Call relai_repo_snapshot when an overview is useful and follow any projectInstructions it returns; earlier sources override later sources. Use relai_search when location is unknown and relai_read only when wider source is needed. Prefer relai_edit with runChecks:true and returnDiff:true. Completion is explicit: on the final standard or release relai_run_checks pass complete:true with summary, or call relai_complete_task with the same task_id after a final read-only review.`;
}

function toolResult(payload, isError) {
  const text = JSON.stringify(payload, null, 2);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_TOOL_RESULT_BYTES) {
    return {
      content: [{
        type: 'text',
        text: `${truncateUtf8Head(text, MAX_TOOL_RESULT_BYTES)}\n\n[rel-ai-mcp truncated tool result: ${bytes} bytes total]`
      }],
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
  return Buffer.from(String(text), 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/u, '');
}

function compactToolResult(payload, originalBytes) {
  if (!payload || typeof payload !== 'object') return { ok: false, truncated: true, originalBytes };
  const compact = {
    ok: payload.ok !== false,
    truncated: true,
    originalBytes,
    message: boundedText(payload.message, 2000) || 'Result was truncated. Re-call with a narrower path, maxBytes, maxEntries, limit, or diff path.',
    workspace: payload.workspace || null,
    task_id: payload.task_id || payload.taskId || null,
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

module.exports = {
  createRelaiMcpServer,
  connectorInstructions,
  toolResult,
  SERVER_INSTANCE_ID
};
