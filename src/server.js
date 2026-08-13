import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config.js';
import { createStdioTaskPrincipal } from './mcp/principal.js';
import { createTaskAwareStdioTransport } from './mcp/transportTasks.js';
import { createRelaiMcpServer, SERVER_INSTANCE_ID } from './mcpServer.js';
import { pruneNativeToolTasks } from './mcp/nativeToolTasks.js';
import { initializeTelemetry, shutdownTelemetry } from './telemetry.js';

function main() {
  const config = readConfig();
  const principal = createStdioTaskPrincipal();
  const transport = createTaskAwareStdioTransport({ config, principal });
  initializeTelemetry(config);
  pruneNativeToolTasks(config);
  const cleanup = async () => {
    const [{ stopAllManagedProcesses }, { stopAllUiSessions }] = await Promise.all([
      import('./processManager.js'),
      import('./webAutomationManager.js')
    ]);
    await stopAllManagedProcesses(config).catch(() => {});
    await stopAllUiSessions().catch(() => {});
    await shutdownTelemetry().catch(() => {});
  };
  process.once('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.once('beforeExit', () => { void cleanup(); });
  return serveStdio(
    () => createRelaiMcpServer({
      transportType: 'stdio',
      nativeTasks: true,
      principal
    }),
    {
      legacy: 'reject',
      transport,
      onerror(error) {
        console.error(`[rel-ai-mcp] MCP stdio error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

export { main, SERVER_INSTANCE_ID };
