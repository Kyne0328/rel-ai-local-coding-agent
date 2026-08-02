import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startMcpClient } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const profile of ['compact', 'legacy']) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `relai-${profile}-discovery-`));
  const configPath = path.join(temp, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 2,
    toolProfile: profile,
    stateDir: path.join(temp, 'state'),
    patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
    workspaces: { repo: { path: root } }
  }, null, 2));

  const client = startMcpClient({ root, configPath });
  try {
    client.initialize(1);
    await client.waitFor(1);
    client.send(2, 'tools/list', {});
    const response = await client.waitFor(2);
    const names = response.result?.tools?.map(tool => tool.name) || [];
    if (profile === 'compact') {
      assert.equal(names.length, 12);
      assert.ok(names.includes('relai_work'));
      assert.equal(names.includes('relai_begin_work'), false);
    } else {
      assert.equal(names.length, 30);
      assert.ok(names.includes('relai_begin_work'));
      assert.equal(names.includes('relai_work'), false);
    }
  } finally {
    await client.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const invalidTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-invalid-profile-'));
try {
  const invalidPath = path.join(invalidTemp, 'config.json');
  fs.writeFileSync(invalidPath, JSON.stringify({
    version: 2,
    toolProfile: 'compact,legacy',
    stateDir: path.join(invalidTemp, 'state'),
    workspaces: { repo: { path: root } }
  }, null, 2));
  const client = startMcpClient({ root, configPath: invalidPath });
  try {
    client.initialize(1);
    await assert.rejects(() => client.waitFor(1), /profiles cannot be combined|Invalid Rel\.AI tool profile/i);
  } finally {
    await client.close().catch(() => {});
  }
} finally {
  fs.rmSync(invalidTemp, { recursive: true, force: true });
}

console.log('Compact and legacy MCP discovery profiles are mutually exclusive and independently discoverable.');
