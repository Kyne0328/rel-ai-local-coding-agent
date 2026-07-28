
import { McpServer, fromJsonSchema, createRequestStateCodec } from '@modelcontextprotocol/server';
import { getToolSchemas, getToolSurfaceManifest, callTool, getToolDefinition } from './tools.js';
import { readConfig, allWorkspaceAliases } from './config.js';
import { serializeToolError } from './tools/errors.js';
import { listResources, readResource, resourceCacheHint } from './resources.js';
import { requireApprovalIfNeeded, approvalRequirement, approvalDigest } from './mcp/approval.js';
import { toolContext, clientName, requestStateKey, SERVER_INSTANCE_ID } from './mcp/context.js';
import { toolResult } from './mcp/results.js';
import { createOperationTask, completeOperationTask, failOperationTask, getOperationTask } from './operationTasks.js';
import { nativeTasksServerCapability, registerNativeTasksProbeTool } from './nativeTasksProbe.js';
import { packageMetadata as pkg } from './packageMetadata.js';
import { PROTOCOL_VERSION, runtimeMetadata } from './runtimeCompatibility.js';
function createRelaiMcpServer(options = {}) {
  const config = readConfig();
  const toolSurface = getToolSurfaceManifest();
  const runtime = runtimeMetadata();
  const requestStateCodec = createRequestStateCodec({
    key: requestStateKey(config),
    ttlSeconds: 10 * 60,
    bind: context => `${context.mcpReq.method}\0${context.http?.authInfo?.clientId || clientName(context) || 'stdio'}`
  });
  const nativeTasksExtension = nativeTasksServerCapability();
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
          protocolVersion: PROTOCOL_VERSION,
          toolSurfaceVersion: toolSurface.toolSurfaceVersion,
          toolCount: toolSurface.toolCount,
          manifestHash: runtime.manifestHash,
          taskIdentityVersion: 2,
          statelessCore: true,
          manifestResource: 'relai://server/tool-surface'
        }
      },
      ...(nativeTasksExtension ? { extensions: nativeTasksExtension } : {})
    },
    instructions: connectorInstructions(config),
    cacheHints: {
      'server/discover': { ttlMs: 30000, cacheScope: 'private' },
      'tools/list': { ttlMs: 30000, cacheScope: 'private' },
      'resources/list': { ttlMs: 15000, cacheScope: 'private' },
      'resources/read': { ttlMs: 5000, cacheScope: 'private' }
    },
    inputRequired: { maxRounds: 4, roundTimeoutMs: 10 * 60 * 1000, legacyShim: false },
    requestState: { verify: requestStateCodec.verify }
  });

  for (const definition of getToolSchemas(config)) registerTool(server, config, definition, requestStateCodec, options);
  registerNativeTasksProbeTool(server, options);
  for (const resource of listResources().resources) {
    server.registerResource(resource.name, resource.uri, {
      description: resource.description,
      mimeType: resource.mimeType,
      cacheHint: resourceCacheHint(resource.uri)
    }, async uri => readResource(uri.href));
  }
  return server;
}

function registerTool(server, config, definition, requestStateCodec, options) {
  server.registerTool(definition.name, {
    title: definition.title,
    description: definition.description,
    inputSchema: fromJsonSchema(definition.inputSchema),
    outputSchema: fromJsonSchema(definition.outputSchema),
    annotations: definition.annotations
  }, async (args, context) => {
    try {
      const approval = await requireApprovalIfNeeded(definition.name, args || {}, context, requestStateCodec);
      if (approval) return approval;
      const metadata = getToolDefinition(definition.name);
      if (shouldDefer(metadata, args)) {
        const operationTask = createOperationTask(config, {
          method: 'tools/call',
          name: definition.name,
          workspace: args?.workspace,
          logicalTaskId: args?.task_id || args?.taskId,
          principal: context?.http?.authInfo?.clientId || clientName(context) || 'stdio',
          message: `${definition.title || definition.name} is running.`
        });
        setImmediate(async () => {
          try {
            const current = getOperationTask(config, operationTask.taskId);
            if (current.status === 'cancelled') return;
            const result = await callTool(definition.name, {
              ...(args || {}),
              defer: false,
              _deferredExecution: true,
              _operationTaskId: operationTask.taskId
            }, toolContext(context, options));
            if (getOperationTask(config, operationTask.taskId).status !== 'cancelled') completeOperationTask(config, operationTask.taskId, result);
          } catch (error) {
            if (getOperationTask(config, operationTask.taskId).status !== 'cancelled') failOperationTask(config, operationTask.taskId, error);
          }
        });
        return toolResult({ ok: true, deferred: true, operationTask }, false);
      }
      const output = await callTool(definition.name, args || {}, toolContext(context, options));
      return toolResult(output, output?.ok === false);
    } catch (error) {
      return toolResult(serializeToolError(definition.name, error), true);
    }
  });
}

function shouldDefer(metadata, args) {
  return metadata?.behavior?.longRunning === true
    && args?.defer === true
    && args?._deferredExecution !== true;
}

function connectorInstructions(config = readConfig()) {
  const aliases = allWorkspaceAliases(config);
  const workspaceInstruction = aliases.length > 0
    ? `Use a configured workspace alias (${aliases.join(', ')}) or the exact absolute path registered for one of those workspaces. Never use a relative path such as ".".`
    : 'Use a configured workspace alias or the exact absolute path of a configured workspace. Never use a relative path such as ".".';
  return `This server targets MCP 2026-07-28 only and has no protocol session. For each independent user objective, call relai_start_task exactly once and retain its opaque task_id; never treat an MCP transport session, repository, or ChatGPT conversation as the task identity. ${workspaceInstruction} Pass that task_id to every subsequent Rel.AI tool call. Use relai_process_* for development servers and interactive commands, relai_worktree_* for isolated branches, relai_semantic_search when terminology is unknown, relai_code_inspect action trace for relationship maps, relai_diagnostics_run for normalized diagnostics, and relai_validation_plan before expensive final validation. Long-running commands and validation can use defer:true and return a durable Rel.AI operationTask handle; poll or cancel it with relai_operation_task_get and relai_operation_task_cancel. Destructive operations may return input_required and must be retried with the approved response and echoed requestState. Completion remains explicit through final relai_run_checks complete:true with summary, or relai_complete_task after read-only review.`;
}

export { createRelaiMcpServer, connectorInstructions, toolResult, approvalRequirement, approvalDigest, SERVER_INSTANCE_ID };
