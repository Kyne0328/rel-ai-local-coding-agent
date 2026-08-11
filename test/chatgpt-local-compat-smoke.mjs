import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient, structuredContentOf, MCP_VERSION } from './helpers/mcp-client.mjs';
import { activeToolCount } from './helpers/tool-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-single-surface-'));
const configPath = path.join(temp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify({
  version: 2,
  stateDir: path.join(temp, 'state'),
  patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
  workspaces: { repo: { path: root } }
}, null, 2));

const client = startMcpClient({ root, configPath });
try {
  client.initialize(1);
  const discovery = await client.waitFor(1);
  assert.ok(discovery.result?.supportedVersions?.includes(MCP_VERSION));

  client.send(2, 'tools/list');
  const listed = await client.waitFor(2);
  assert.equal(listed.result?.tools?.length, activeToolCount);
  assert.ok(listed.result.tools.every(tool => tool.outputSchema), 'direct MCP discovery must advertise outputSchema for every tool');
  const searchTool = listed.result.tools.find(tool => tool.name === 'relai_search');
  assert.equal(searchTool.outputSchema.additionalProperties, false);
  assert.equal(searchTool.outputSchema.properties.neuralEmbeddings.type, 'boolean');

  let requestId = 10;
  for (const removed of ['relai_begin_work', 'relai_status', 'relai_run_checks', 'relai_apply_bundle', 'relai_package_snapshot', 'relai_apply_update', 'relai_clear_files', 'relai_feature_probe', 'relai_git_fetch', 'relai_session_summary']) {
    client.call(requestId, removed, { workspace: 'repo' });
    const response = await client.waitFor(requestId);
    assert.equal(response.error?.code, -32602);
    assert.match(response.error?.message || '', /not found/i);
    requestId += 1;
  }

  client.call(requestId, 'relai_work', { action: 'status', workspace: 'repo' });
  const status = await client.waitFor(requestId);
  assert.equal(status.result.isError, false);
  const payload = structuredContentOf(status);
  assert.equal(payload.tools.length, activeToolCount);
  assert.equal(Object.hasOwn(payload.toolGroups || {}, 'internal'), false);
  requestId += 1;

  client.call(requestId, 'relai_work', { action: 'begin', workspace: 'repo' });
  const task = structuredContentOf(await client.waitFor(requestId));
  requestId += 1;

  client.call(requestId, 'relai_validate', { action: 'checks', workspace: 'repo', work_id: task.work_id, check: 'node -e "process.exit(1)"' });
  const failedCheck = await client.waitFor(requestId);
  assert.equal(failedCheck.result.isError, true, 'returned ok:false tool results must set MCP isError');
  assert.equal(failedCheck.result.structuredContent.ok, false, 'structured failure payload must be preserved');
  assert.equal(failedCheck.result.structuredContent.results[0].exitCode, 1, 'structured diagnostics must remain available');

  console.log('SDK v2 rejects removed tools, exposes the active surface, and preserves tool-level isError results.');
} finally {
  await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
