import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_INFO_META_KEY } from '@modelcontextprotocol/server';
import { createHttpMcpSession, MCP_VERSION } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39876;
const token = 'http-smoke-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-smoke-'));
const profile = path.join(stateDir, 'connection.json');
const originalProfile = `${JSON.stringify({ host: 'sentinel.invalid', port: 65535 }, null, 2)}\n`;
fs.writeFileSync(profile, originalProfile);
const configPath = path.join(stateDir, 'config.json');
const config = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'config.example.json'), 'utf8'));
config.stateDir = stateDir;
config.auditLogPath = path.join(stateDir, 'audit.jsonl');
config.workspaces = { repo: { ...(config.workspaces?.repo || {}), path: root } };
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: configPath,
    REL_AI_MCP_TOKEN: token,
    REL_AI_MCP_STATE_DIR: stateDir
  }
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
const base = `http://127.0.0.1:${port}`;

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`HTTP server did not become healthy. ${stderr}`);
}

let client = null;
try {
  await waitForHealth();
  const health = await fetch(`${base}/health`).then(response => response.json());
  assert.equal(health.ok, true);
  assert.ok(health.transports.includes('streamable-http'));

  const compressed = await fetch(`${base}/api/tools?token=${encodeURIComponent(token)}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal((await compressed.json()).length, 33);

  const dashboard = await fetch(`${base}/api/dashboard/v10?token=${encodeURIComponent(token)}`).then(response => response.json());
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.application.name, 'Rel.AI MCP');
  assert.ok(Array.isArray(dashboard.tasks));
  assert.equal(typeof dashboard.workspaceStates, 'object');

  client = await createHttpMcpSession(base, { token, clientName: 'relai-http-smoke' });
  const discovery = client.discovery;
  assert.equal(discovery.response.status, 200);
  assert.deepEqual(discovery.body.result?.supportedVersions, [MCP_VERSION]);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.toolSurfaceVersion, 25);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.toolCount, 33);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.statelessRequestModel, true);
  assert.deepEqual(discovery.body.result?.capabilities?.extensions?.['io.modelcontextprotocol/tasks'], {});
  assert.equal(discovery.body.result?._meta?.[SERVER_INFO_META_KEY]?.name, 'rel-ai-mcp');
  assert.match(discovery.body.result?._meta?.[SERVER_INFO_META_KEY]?.version || '', /^0\./);
  assert.match(discovery.body.result?.instructions || '', /MCP 2026-07-28 is stateless/);
  assert.equal(discovery.body.result?.cacheScope, 'private');
  assert.equal(discovery.body.result?.ttlMs, 30000);
  assert.equal(discovery.response.headers.get('mcp-session-id'), null);

  const liveDashboard = await fetch(`${base}/api/dashboard/v10?token=${encodeURIComponent(token)}`).then(response => response.json());
  assert.equal(liveDashboard.mcpConnection.status, 'ready');
  assert.equal(liveDashboard.mcpConnection.requestModel, 'stateless');
  assert.equal(liveDashboard.mcpConnection.connectedClientCount, 0);
  assert.deepEqual(liveDashboard.mcpConnection.activeSessions, []);

  const listed = await client.request('tools/list');
  assert.equal(listed.body.result?.tools?.length, 33);
  const names = listed.body.result.tools.map(tool => tool.name);
  for (const expected of ['relai_process_start', 'relai_worktree_create', 'relai_semantic_search', 'relai_diagnostics_run', 'relai_validation_plan', 'relai_native_tasks_probe']) {
    assert.ok(names.includes(expected), `${expected} missing`);
  }
  assert.equal(names.includes('relai_operation_task_get'), false);
  assert.equal(names.includes('relai_operation_task_cancel'), false);
  const inspect = listed.body.result.tools.find(tool => tool.name === 'relai_code_inspect');
  assert.ok(inspect.inputSchema.properties.action.enum.includes('trace'));
  assert.equal(inspect.outputSchema.type, 'object');
  const checks = listed.body.result.tools.find(tool => tool.name === 'relai_run_checks');
  assert.ok(checks.inputSchema.properties.planId);
  assert.ok(checks.inputSchema.properties.planLevel);
  assert.equal(checks.inputSchema.properties.defer, undefined);
  assert.equal(checks.outputSchema.properties.operationTask, undefined);
  assert.equal(checks.outputSchema.type, 'object');

  const status = await client.request('tools/call', {
    name: 'relai_status',
    arguments: { workspace: 'repo' }
  });
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.result?.isError, false, JSON.stringify(status.body));
  assert.equal(status.body.result?.structuredContent?.ok, true);

  const secondaryPath = path.join(stateDir, 'secondary-workspace');
  fs.mkdirSync(secondaryPath);
  const workspaceMutation = await fetch(`${base}/api/workspaces?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'upsert',
      alias: 'secondary',
      workspaceConfig: { mode: 'create', path: secondaryPath }
    })
  }).then(response => response.json());
  assert.equal(workspaceMutation.ok, true);
  const changedDashboard = await fetch(`${base}/api/dashboard/v10?token=${encodeURIComponent(token)}`).then(response => response.json());
  assert.equal(changedDashboard.mcpConnection.status, 'ready');
  assert.equal(changedDashboard.mcpConnection.metrics.toolManifestChanges, 1);
  assert.equal(changedDashboard.mcpConnection.metrics.capabilityMismatches, 0);

  const synchronizedTools = await client.request('tools/list');
  assert.equal(synchronizedTools.body.result?.tools?.length, 33);
  const synchronizedDashboard = await fetch(`${base}/api/dashboard/v10?token=${encodeURIComponent(token)}`).then(response => response.json());
  assert.equal(synchronizedDashboard.mcpConnection.status, 'ready');
  assert.notEqual(synchronizedDashboard.mcpConnection.toolManifestVersion, liveDashboard.mcpConnection.toolManifestVersion);

  const resources = await client.request('resources/list');
  assert.ok(resources.body.result.resources.some(item => item.uri === 'relai://server/tool-surface'));
  assert.equal(resources.body.result._meta?.['io.modelcontextprotocol/cache']?.cacheScope || resources.body.result.cacheScope || 'private', 'private');

  const surface = await client.request('resources/read', { uri: 'relai://server/tool-surface' });
  assert.ok(surface.body.result?.contents, JSON.stringify(surface.body));
  const manifest = JSON.parse(surface.body.result.contents[0].text);
  assert.equal(manifest.toolSurfaceVersion, 25);
  assert.equal(manifest.toolCount, 33);
  assert.equal(manifest.cache.cacheScope, 'private');
  assert.ok(manifest.cache.revision);

  const removed = await client.request('tools/call', { name: 'relai_config', arguments: {} });
  assert.equal(Boolean(removed.body.error?.code || removed.body.result?.isError), true);

  const mismatch = await client.request('tools/call', { name: 'relai_status', arguments: {} }, { name: 'wrong-name' });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.body.error?.message || '', /does not match/);

  const undeclaredParam = await client.request('tools/call', {
    name: 'relai_status',
    arguments: { workspace: 'repo' }
  }, { extraHeaders: { 'mcp-param-extra': 'not-declared' } });
  assert.equal(undeclaredParam.response.status, 400);
  assert.match(undeclaredParam.body.error?.message || '', /not declared/);

  const getMcp = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(getMcp.status, 405);
  assert.equal(getMcp.headers.get('allow'), 'POST');
} finally {
  if (client) await client.close().catch(() => {});
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  assert.equal(fs.readFileSync(profile, 'utf8'), originalProfile);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('HTTP MCP 2026-07-28 discovery, stateless tools, resources, dashboard, and POST-only lifecycle smoke test passed.');
