import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readConfig } from './config.js';
import { createStdioTaskPrincipal } from './mcp/principal.js';
import { createTaskAwareStdioTransport } from './mcp/transportTasks.js';
import { createRelaiMcpServer, SERVER_INSTANCE_ID } from './mcpServer.js';
import { pruneNativeToolTasks } from './mcp/nativeToolTasks.js';
import { initializeTelemetry, shutdownTelemetry } from './telemetry.js';

async function main() {
  const config = readConfig();
  const principal = createStdioTaskPrincipal();
  const transport = createTaskAwareStdioTransport({ config, principal });
  initializeTelemetry(config);
  pruneNativeToolTasks(config);
  let cleanupPromise = null;
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const [
        { stopAllManagedProcesses },
        { stopAllUiSessions },
        { flushAuditWrites },
        { flushLocalAnalytics },
        { flushTaskHistoryPersistence }
      ] = await Promise.all([
        import('./processManager.js'),
        import('./webAutomationManager.js'),
        import('./audit.js'),
        import('./localAnalytics.js'),
        import('./taskHistoryStore.js')
      ]);
      await Promise.allSettled([
        flushAuditWrites(),
        flushTaskHistoryPersistence(),
        flushLocalAnalytics(config),
        stopAllManagedProcesses(config),
        stopAllUiSessions(),
        shutdownTelemetry()
      ]);
    })();
    return cleanupPromise;
  };
  process.once('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.once('beforeExit', () => { void cleanup(); });
  const handle = serveStdio(
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
  const sdkOnClose = transport.onclose;
  transport.onclose = () => {
    sdkOnClose?.();
    void cleanup();
  };
  return handle;
}

export { main, SERVER_INSTANCE_ID };
