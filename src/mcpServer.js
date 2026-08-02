import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { readConfig } from './config.js';
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
  const surface = getToolSurfaceManifest(config);
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
    validateOutput: output => validateToolOutput(config, definition.name, args || {}, output)
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

function connectorInstructions(_config = readConfig()) {
  return 'Start each objective with relai_work action begin and pass its work_id to later calls. Inspect relevant files before editing; use bounded reads and commands. Validate after changes. Never bypass approval, workspace, task, or destructive-operation safeguards. Report only checks actually run. Finish with relai_validate action checks complete:true, or relai_work action finish after review.';
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
