import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { readConfig } from './config.js';
import { createRelaiRequestStateCodec, SERVER_INSTANCE_ID, toolContext } from './mcp/context.js';
import {
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_PROTOCOL_VERSION,
  TASKS_EXTENSION_ID,
  TASKS_EXTENSION_REVISION
} from './mcp/protocol.js';
import { toolResult } from './mcp/results.js';
import { PUBLIC_MCP_SERVER_INSTRUCTIONS } from './mcp/serverInstructions.js';
import { validateToolOutput } from './tools/outputValidation.js';
import { packageMetadata as pkg } from './packageMetadata.js';
import { listResources, readResource, resourceCacheHint } from './resources.js';
import { getPublicToolSchemas, getToolSurfaceManifest } from './tools/schema.js';

const MCP_SERVER_INFO = Object.freeze({
  name: pkg.name,
  version: pkg.version,
  toolSurfaceVersion: getToolSurfaceManifest().toolSurfaceVersion
});

function createRelaiMcpServer(options = {}) {
  const config = readConfig();
  const definitions = getPublicToolSchemas(config);
  const surface = getToolSurfaceManifest(config);
  const legacyCompatibility = options.legacyCompatibility === true;
  const requestStateCodec = createRelaiRequestStateCodec(config, options.principal);
  const capabilities = {
    tools: {},
    resources: { subscribe: false },
    ...(options.nativeTasks === true ? {
      extensions: { [TASKS_EXTENSION_ID]: { revision: TASKS_EXTENSION_REVISION } }
    } : {}),
    experimental: {
      relai: {
        targetProtocolVersion: MCP_PROTOCOL_VERSION,
        supportedProtocolVersions: legacyCompatibility
          ? [...MCP_LEGACY_PROTOCOL_VERSIONS]
          : [MCP_PROTOCOL_VERSION],
        compatibilityMode: legacyCompatibility ? 'legacy_http' : 'modern',
        toolSurfaceVersion: surface.toolSurfaceVersion,
        toolCount: definitions.length,
        taskIdentityVersion: 2,
        statelessRequestModel: true,
        manifestResource: 'relai://server/tool-surface'
      }
    }
  };
  const server = new McpServer(MCP_SERVER_INFO, {
    supportedProtocolVersions: legacyCompatibility
      ? [...MCP_LEGACY_PROTOCOL_VERSIONS]
      : [MCP_PROTOCOL_VERSION],
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
  server.registerTool(definition.name, toolRegistration(definition), async (args, context) => {
    const { invokeRelaiTool } = await import('./mcp/toolInvocation.js');
    return invokeRelaiTool({
      config,
      name: definition.name,
      args: args || {},
      context: toolContext(context, options),
      approvalContext: context,
      requestStateCodec,
      validateOutput: output => validateToolOutput(config, definition.name, args || {}, output)
    });
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

function connectorInstructions(_config = readConfig()) {
  return PUBLIC_MCP_SERVER_INSTRUCTIONS;
}

export {
  SERVER_INSTANCE_ID,


  connectorInstructions,
  createRelaiMcpServer,
  MCP_SERVER_INFO,
  toolResult
};
