import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-shared-modules-'));
const configPath = path.join(sandbox, 'config.json');
const previousConfigPath = process.env.REL_AI_MCP_CONFIG;
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
fs.writeFileSync(configPath, JSON.stringify({
  version: 3,
  stateDir: sandbox,
  auditLogPath: path.join(sandbox, 'audit.jsonl'),
  workspaces: {}
}, null, 2));
process.env.REL_AI_MCP_CONFIG = configPath;
process.env.REL_AI_MCP_STATE_DIR = sandbox;

const { startHttpServer } = await import('../src/httpServer.js');
const server = startHttpServer({ host: '127.0.0.1', port: 0, token: 'shared-module-test', exitOnError: false, writeProfile: false });

try {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  for (const [pathname, expectedExport] of [
    ['/public/analyticsFailureCategory.js', 'normalizeFailureCategory'],
    ['/public/taskState.js', 'isTerminalDashboardTaskStatus'],
    ['/public/taskEvents.js', 'eventTimestampMs']
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`);
    const source = await response.text();
    assert.equal(response.status, 200, `${pathname} must be served for browser-relative imports`);
    assert.match(response.headers.get('content-type') || '', /^application\/javascript/);
    assert.match(source, new RegExp(`\\b${expectedExport}\\b`));
  }

  console.log('Dashboard shared browser modules are served from browser-resolved public URLs.');
} finally {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await server.waitForShutdown?.();
  if (previousConfigPath == null) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfigPath;
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(sandbox, { recursive: true, force: true });
}
