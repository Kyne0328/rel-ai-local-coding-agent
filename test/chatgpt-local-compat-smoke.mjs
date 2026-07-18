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
  client.send(1, 'initialize', { protocolVersion: '2025-06-18' });
  await client.waitFor(1);

  let requestId = 10;
  for (const removed of ['relai_apply_bundle', 'relai_package_snapshot', 'relai_apply_update', 'relai_clear_files', 'relai_feature_probe', 'relai_git_fetch', 'relai_session_summary']) {
    client.call(requestId, removed, { workspace: 'repo' });
    const response = await client.waitFor(requestId);
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /Unknown tool/);
    requestId += 1;
  }

  client.call(requestId, 'relai_status', { workspace: 'repo' });
  const status = await client.waitFor(requestId);
  assert.equal(status.result.isError, false);
  const payload = JSON.parse(status.result.content[0].text);
  assert.equal(payload.tools.length, activeToolCount);
  assert.equal(Object.hasOwn(payload.toolGroups || {}, 'internal'), false);

  console.log('Removed MCP tools fail closed and status exposes only the active surface.');
} finally {
  await client.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
