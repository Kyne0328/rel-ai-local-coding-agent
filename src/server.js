

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createRelaiMcpServer, SERVER_INSTANCE_ID } from "./mcpServer.js";
import { readConfig } from "./config.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";
import { stopAllManagedProcesses, pruneManagedProcesses } from "./processManager.js";
import { pruneOperationTasks } from "./operationTasks.js";

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

export { main, SERVER_INSTANCE_ID };
