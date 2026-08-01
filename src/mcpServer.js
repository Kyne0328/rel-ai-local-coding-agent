import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { allWorkspaceAliases, readConfig } from './config.js';
import { approvalDigest, approvalRequirement } from './mcp/approval.js';
import { createRelaiRequestStateCodec, SERVER_INSTANCE_ID, toolContext } from './mcp/context.js';
import { MCP_PROTOCOL_VERSION, TASKS_EXTENSION_ID } from './mcp/protocol.js';
import { toolResult } from './mcp/results.js';
import { invokeRelaiTool } from './mcp/toolInvocation.js';
import { validateToolOutput } from './tools/outputValidation.js';
import { packageMetadata as pkg } from './packageMetadata.js';
import { listResources, readResource, resourceCacheHint } from './resources.js';
import { getPublicToolSchemas, getToolSurfaceManifest } from './tools.js';

const MCP_SERVER_INFO = Object.freeze({
  name: pkg.name,
  version: pkg.version,
  toolSurfaceVersion: getToolSurfaceManifest().toolSurfaceVersion
});

function createRelaiMcpServer(options = {}) {
  const config = readConfig();
  const definitions = runtimeToolSchemas(config);
  const surface = getToolSurfaceManifest();
  const legacyCompatibility = options.legacyCompatibility === true;
  const requestStateCodec = createRelaiRequestStateCodec(config, options.principal);
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
  const server = new McpServer(MCP_SERVER_INFO, {
    ...(legacyCompatibility ? {} : { supportedProtocolVersions: [MCP_PROTOCOL_VERSION] }),
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
      legacyShim: legacyCompatibility
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
  server.registerTool(definition.name, toolRegistration(definition), async (args, context) => invokeRelaiTool({
    config,
    name: definition.name,
    args: args || {},
    context: toolContext(context, options),
    approvalContext: context,
    requestStateCodec,
    validateOutput: output => validateToolOutput(config, definition.name, output)
  }));
}

function toolRegistration(definition) {
  return {
    title: definition.title,
    description: definition.description,
    inputSchema: fromJsonSchema(definition.inputSchema),
    annotations: definition.annotations
  };
}

function runtimeToolSchemas(config) {
  return getPublicToolSchemas(config);
}

function connectorInstructions(config = readConfig()) {
  const aliases = allWorkspaceAliases(config);
  const workspaceInstruction = aliases.length > 0
    ? `Start with a configured workspace alias (${aliases.join(', ')}) or its exact registered absolute path; never use a relative path such as ".".`
    : 'Start with a configured workspace alias or its exact registered absolute path; never use a relative path such as ".".';
  return `For each independent user objective, call relai_begin_work exactly once. ${workspaceInstruction} It returns a principal-bound work_id plus repository bootstrap context. Pass work_id to every later work-scoped Rel.AI call; omit workspace unless you want Rel.AI to verify an ownership assertion. Use the bootstrap before requesting another repository snapshot. Modern MCP ${MCP_PROTOCOL_VERSION} requests are strict and stateless: every request supplies protocol, client, and capability metadata. HTTP also accepts the SDK-supported stateless initialize flow for ChatGPT compatibility. Neither transport mode nor any transport identifier is a work-session identity. Use relai_process_* for development servers and interactive commands, relai_worktree_* for isolated branches, relai_semantic_search when terminology is unknown, relai_code_inspect action trace for relationship maps, and relai_diagnostics_run for normalized diagnostics. relai_run_checks performs change-aware validation planning internally. Destructive operations may return input_required and must be retried with accepted input and protected requestState. Native MCP Tasks, when advertised and selected for a long operation, are polled with tasks/get and controlled with tasks/update or tasks/cancel. Finish a work session through relai_run_checks complete:true with summary, or relai_finish_work after read-only review.`;
}

export {
  SERVER_INSTANCE_ID,
  approvalDigest,
  approvalRequirement,
  connectorInstructions,
  createRelaiMcpServer,
  MCP_SERVER_INFO,
  runtimeToolSchemas,
  toolResult
};
