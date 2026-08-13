import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startMcpClient } from './helpers/mcp-client.mjs';
import { activeToolCount, activeToolNames } from './helpers/tool-surface.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const variants = [
  { name: 'canonical', extra: {} },
  { name: 'stale-profile-field', extra: { toolProfile: 'core' } }
];

for (const variant of variants) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `relai-${variant.name}-discovery-`));
  const configPath = path.join(temp, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 3,
    ...variant.extra,
    stateDir: path.join(temp, 'state'),
    patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
    workspaces: { repo: { path: root } }
  }, null, 2));

  const client = startMcpClient({ root, configPath });
  try {
    client.initialize(1);
    const discovery = await client.waitFor(1);
    assert.equal(discovery.result?.capabilities?.experimental?.relai?.toolCount, activeToolCount);
    client.send(2, 'tools/list', {});
    const response = await client.waitFor(2);
    const names = response.result?.tools?.map(tool => tool.name) || [];
    assert.deepEqual(names, activeToolNames);
  } finally {
    await client.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log(`The unified ${activeToolCount}-tool MCP surface is always discovered; stale profile fields have no effect.`);
