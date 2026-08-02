import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startMcpClient } from './helpers/mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectations = {
  core: { count: 7, present: 'relai_work', absent: 'relai_process' },
  compact: { count: 12, present: 'relai_work', absent: 'relai_begin_work' }
};

for (const [profile, expected] of Object.entries(expectations)) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `relai-${profile}-discovery-`));
  const configPath = path.join(temp, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    version: 3,
    toolProfile: profile,
    stateDir: path.join(temp, 'state'),
    patch: { backup: false, requireCleanGit: false, maxUpdateBytes: 2097152 },
    workspaces: { repo: { path: root } }
  }, null, 2));

  const client = startMcpClient({ root, configPath });
  try {
    client.initialize(1);
    const discovery = await client.waitFor(1);
    assert.equal(discovery.result?.capabilities?.experimental?.relai?.toolCount, expected.count);
    client.send(2, 'tools/list', {});
    const response = await client.waitFor(2);
    const names = response.result?.tools?.map(tool => tool.name) || [];
    assert.equal(names.length, expected.count);
    assert.ok(names.includes(expected.present));
    assert.equal(names.includes(expected.absent), false);
  } finally {
    await client.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (const invalidProfile of ['legacy', 'full', 'compact,legacy']) {
  const invalidTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-invalid-profile-'));
  try {
    const invalidPath = path.join(invalidTemp, 'config.json');
    fs.writeFileSync(invalidPath, JSON.stringify({
      version: 3,
      toolProfile: invalidProfile,
      stateDir: path.join(invalidTemp, 'state'),
      workspaces: { repo: { path: root } }
    }, null, 2));
    const client = startMcpClient({ root, configPath: invalidPath });
    try {
      client.initialize(1);
      await assert.rejects(() => client.waitFor(1), /Removed profiles|Invalid Rel\.AI tool profile/i);
    } finally {
      await client.close().catch(() => {});
    }
  } finally {
    fs.rmSync(invalidTemp, { recursive: true, force: true });
  }
}

console.log('Core and compact MCP discovery profiles are independently discoverable; removed profiles fail closed.');
