import { McpServer, createRequestStateCodec, fromJsonSchema } from '@modelcontextprotocol/server';
import { allWorkspaceAliases, readConfig } from './config.js';
import { approvalDigest, approvalRequirement, requireApprovalIfNeeded } from './mcp/approval.js';
import { requestStateKey, SERVER_INSTANCE_ID, toolContext } from './mcp/context.js';
import { MCP_PROTOCOL_VERSION, TASKS_EXTENSION_ID } from './mcp/protocol.js';
import { toolResult } from './mcp/results.js';
import { PROBE_TOOL_NAME, nativeTasksProbeFallback } from './nativeTasksProbe.js';
import { packageMetadata as pkg } from './packageMetadata.js';
import { listResources, readResource, resourceCacheHint } from './resources.js';
import { callTool, getToolSchemas, getToolSurfaceManifest } from './tools.js';
import { serializeToolError } from './tools/errors.js';

function createRelaiMcpServer(options = {}) {
  const config = readConfig();
  const definitions = runtimeToolSchemas(config);
  const surface = getToolSurfaceManifest();
  const requestStateCodec = createRequestStateCodec({
    key: requestStateKey(config),
    ttlSeconds: 10 * 60,
    bind: context => `${context.mcpReq.method}\0${context.http?.authInfo?.clientId || 'stdio'}`
  });
  const capabilities = {
    tools: {},
    resources: { subscribe: false },
    ...(options.nativeTasks === true ? { extensions: { [TASKS_EXTENSION_ID]: {} } } : {}),
    experimental: {
      relai: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        toolSurfaceVersion: surface.toolSurfaceVersion,
        toolCount: definitions.length,
        taskIdentityVersion: 2,
        statelessRequestModel: true,
        manifestResource: 'relai://server/tool-surface'
      }
    }
  };
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version,
    toolSurfaceVersion: surface.toolSurfaceVersion
  }, {
    ...(options.legacyCompatibility === true ? {} : { supportedProtocolVersions: [MCP_PROTOCOL_VERSION] }),
    capabilities,
    instructions: connectorInstructions(config),
    cacheHints: {
      'server/discover': { ttlMs: 30000, cacheScope: 'private' },
      'tools/list': { ttlMs: 30000, cacheScope: 'private' },
      'resources/list': { ttlMs: 15000, cacheScope: 'private' },
      'resources/read': { ttlMs: 5000, cacheScope: 'private' }
    },
    inputRequired: {
      maxRounds: 4,
      roundTimeoutMs: 10 * 60 * 1000,
      legacyShim: options.legacyCompatibility === true
    },
    requestState: { verify: requestStateCodec.verify }
  });

  for (const definition of definitions) {
    registerTool(server, config, definition, requestStateCodec, options);
  }
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
  server.registerTool(definition.name, toolRegistration(definition), async (args, context) => {
    const resolvedContext = toolContext(context, options);
    if (definition.name === PROBE_TOOL_NAME) {
      return nativeTasksProbeFallback(config, args || {}, resolvedContext);
    }
    try {
      const approval = await requireApprovalIfNeeded(definition.name, args || {}, context, requestStateCodec);
      if (approval) return approval;
      const output = await callTool(definition.name, args || {}, resolvedContext);
      return toolResult(output, output?.ok === false);
    } catch (error) {
      return toolResult(serializeToolError(definition.name, error), true);
    }
  });
}

function toolRegistration(definition) {
  return {
    title: definition.title,
    description: definition.description,
    inputSchema: fromJsonSchema(definition.inputSchema),
    outputSchema: fromJsonSchema(definition.outputSchema),
    annotations: definition.annotations
  };
}

function runtimeToolSchemas(config) {
  return getToolSchemas(config);
}

function connectorInstructions(config = readConfig()) {
  const aliases = allWorkspaceAliases(config);
  const workspaceInstruction = aliases.length > 0
    ? `Start with a configured workspace alias (${aliases.join(', ')}) or its exact registered absolute path; never use a relative path such as ".".`
    : 'Start with a configured workspace alias or its exact registered absolute path; never use a relative path such as ".".';
  return `For each independent user objective, call relai_start_task exactly once. ${workspaceInstruction} It returns an opaque workspace-bound task_id plus repository bootstrap context. Pass task_id to every later task-scoped Rel.AI call; omit workspace unless you want Rel.AI to verify an ownership assertion. Use the bootstrap before requesting another repository snapshot. Native MCP ${MCP_PROTOCOL_VERSION} is stateless: every modern request supplies its own protocol metadata, client identity, and capabilities. The HTTP endpoint may translate ChatGPT's SDK-supported frozen legacy envelope, but no transport identifier is a task identity. Use relai_process_* for development servers and interactive commands, relai_worktree_* for isolated branches, relai_semantic_search when terminology is unknown, relai_code_inspect action trace for relationship maps, relai_diagnostics_run for normalized diagnostics, and relai_validation_plan before expensive final validation. Destructive operations may return input_required and must be retried with the accepted response and protected requestState. Native MCP Tasks, when advertised by the current request, are polled with tasks/get and controlled with tasks/update or tasks/cancel. Completion remains explicit through final relai_run_checks complete:true with summary, or relai_complete_task after read-only review.`;
}

export {
  SERVER_INSTANCE_ID,
  approvalDigest,
  approvalRequirement,
  connectorInstructions,
  createRelaiMcpServer,
  runtimeToolSchemas,
  toolResult
};
