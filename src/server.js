'use strict';

const { serveStdio } = require('@modelcontextprotocol/server/stdio');
const { createRelaiMcpServer, SERVER_INSTANCE_ID } = require('./mcpServer');
const { readConfig } = require('./config');
const { initializeTelemetry, shutdownTelemetry } = require('./telemetry');
const { stopAllManagedProcesses, pruneManagedProcesses } = require('./processManager');
const { pruneOperationTasks } = require('./operationTasks');

function main() {
  const config = readConfig();
  initializeTelemetry(config);
  pruneManagedProcesses(config);
  pruneOperationTasks(config);
  const cleanup = async () => {
    await stopAllManagedProcesses(config).catch(() => {});
    await shutdownTelemetry().catch(() => {});
  };
  process.once('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.once('beforeExit', () => { void cleanup(); });
  return serveStdio(
    () => createRelaiMcpServer({ transportType: 'stdio' }),
    {
      onerror(error) {
        console.error(`[rel-ai-mcp] MCP stdio error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

module.exports = { main, SERVER_INSTANCE_ID };
