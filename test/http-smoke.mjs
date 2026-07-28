import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postMcp } from './helpers/http-mcp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39876;
const token = 'http-smoke-token';
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-http-smoke-'));
const profile = path.join(stateDir, 'connection.json');
const originalProfile = `${JSON.stringify({ host: 'sentinel.invalid', port: 65535 }, null, 2)}\n`;
fs.writeFileSync(profile, originalProfile);
const child = spawn(process.execPath, [path.join(root, 'bin', 'rel-ai-mcp-http.js'), '--host', '127.0.0.1', '--port', String(port), '--no-profile-write'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    REL_AI_MCP_CONFIG: path.join(root, 'examples', 'config.example.json'),
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

try {
  await waitForHealth();
  const health = await fetch(`${base}/health`).then(response => response.json());
  assert.equal(health.ok, true);
  assert.ok(health.transports.includes('streamable-http'));

  const compressed = await fetch(`${base}/api/tools?token=${encodeURIComponent(token)}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal((await compressed.json()).length, 34);

  const dashboard = await fetch(`${base}/api/dashboard/v10?token=${encodeURIComponent(token)}`).then(response => response.json());
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.application.name, 'Rel.AI MCP');
  assert.ok(Array.isArray(dashboard.tasks));
  assert.equal(typeof dashboard.workspaceStates, 'object');

  const discovery = await postMcp(base, { id: 1, method: 'server/discover', token, clientName: 'relai-http-smoke' });
  assert.equal(discovery.response.status, 200);
  assert.ok(discovery.body.result?.supportedVersions?.includes('2026-07-28'));
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.toolSurfaceVersion, 23);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.toolCount, 34);
  assert.match(discovery.body.result?.capabilities?.experimental?.relai?.manifestHash || '', /^[A-Za-z0-9_-]{24}$/);
  assert.equal(discovery.body.result?.capabilities?.experimental?.relai?.statelessCore, true);
  assert.equal(discovery.body.result?.capabilities?.extensions?.['io.modelcontextprotocol/tasks'], undefined);

  const listed = await postMcp(base, { id: 2, method: 'tools/list', token, clientName: 'relai-http-smoke' });
  assert.equal(listed.body.result?.tools?.length, 34);
  const names = listed.body.result.tools.map(tool => tool.name);
  for (const expected of ['relai_process_start', 'relai_worktree_create', 'relai_semantic_search', 'relai_diagnostics_run', 'relai_validation_plan']) {
    assert.ok(names.includes(expected), `${expected} missing`);
  }
  const inspect = listed.body.result.tools.find(tool => tool.name === 'relai_code_inspect');
  assert.ok(inspect.inputSchema.properties.action.enum.includes('trace'));
  assert.equal(inspect.outputSchema.type, 'object');
  const checks = listed.body.result.tools.find(tool => tool.name === 'relai_run_checks');
  assert.ok(checks.inputSchema.properties.planId);
  assert.ok(checks.inputSchema.properties.planLevel);
  assert.equal(checks.outputSchema.type, 'object');

  const resources = await postMcp(base, { id: 3, method: 'resources/list', token });
  assert.ok(resources.body.result.resources.some(item => item.uri === 'relai://server/tool-surface'));
  assert.equal(resources.body.result._meta?.['io.modelcontextprotocol/cache']?.cacheScope || resources.body.result.cacheScope || 'private', 'private');

  const surface = await postMcp(base, { id: 4, method: 'resources/read', token, name: 'relai://server/tool-surface', params: { uri: 'relai://server/tool-surface' } });
  assert.ok(surface.body.result?.contents, JSON.stringify(surface.body));
  const manifest = JSON.parse(surface.body.result.contents[0].text);
  assert.equal(manifest.toolSurfaceVersion, 23);
  assert.equal(manifest.toolCount, 34);
  assert.equal(manifest.cache.cacheScope, 'private');
  assert.ok(manifest.cache.revision);

  const removed = await postMcp(base, { id: 5, method: 'tools/call', token, name: 'relai_config', params: { name: 'relai_config', arguments: {} } });
  assert.equal(removed.body.error?.code || removed.body.result?.isError ? true : false, true);

  const mismatch = await postMcp(base, {
    id: 6,
    method: 'tools/call',
    token,
    name: 'wrong-name',
    params: { name: 'relai_status', arguments: {} }
  });
  assert.equal(mismatch.response.status, 400);
  assert.match(mismatch.body.error?.message || '', /does not match/);
} finally {
  child.kill('SIGKILL');
  await once(child, 'close').catch(() => {});
  assert.equal(fs.readFileSync(profile, 'utf8'), originalProfile);
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('HTTP MCP 2026 hard-cutover smoke test passed.');
