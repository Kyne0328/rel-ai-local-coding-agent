import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpClient } from './helpers/mcp-client.mjs';
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
  client.discover(1);
  const discovery = await client.waitFor(1);
  assert.ok(discovery.result?.supportedVersions?.includes('2026-07-28'));

  let requestId = 10;
  for (const removed of ['relai_apply_bundle', 'relai_package_snapshot', 'relai_apply_update', 'relai_clear_files', 'relai_feature_probe', 'relai_git_fetch', 'relai_session_summary']) {
    client.call(requestId, removed, { workspace: 'repo' });
    const response = await client.waitFor(requestId);
    assert.equal(response.error?.code, -32602);
    assert.match(response.error?.message || '', /not found/i);
    requestId += 1;
  }

  client.call(requestId, 'relai_status', { workspace: 'repo' });
  const status = await client.waitFor(requestId);
  assert.equal(status.result.isError, false);
  const payload = JSON.parse(status.result.content[0].text);
  assert.equal(payload.tools.length, activeToolCount);
  assert.equal(Object.hasOwn(payload.toolGroups || {}, 'internal'), false);
  requestId += 1;

  client.call(requestId, 'relai_run_checks', { workspace: 'repo', check: 'node -e "process.exit(1)"' });
  const failedCheck = await client.waitFor(requestId);
  assert.equal(failedCheck.result.isError, true, 'returned ok:false tool results must set MCP isError');
  assert.equal(failedCheck.result.structuredContent.ok, false, 'structured failure payload must be preserved');
  assert.equal(failedCheck.result.structuredContent.results[0].exitCode, 1, 'structured diagnostics must remain available');

  console.log('SDK v2 rejects removed tools, exposes the active surface, and preserves tool-level isError results.');
} finally {
  await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
