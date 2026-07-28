import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiStatus } = require('../src/tools/status.js');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-status-aliases-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = stateDir;
const config = {
  stateDir,
  workspaces: {
    zebra: { path: '/tmp/zebra' },
    app: { path: '/tmp/app' },
    worker: { path: '/tmp/worker' },
    api: { path: '/tmp/api' }
  }
};

try {
  const status = await relaiStatus(config);
  assert.equal(status.workspaceCount, 4);
  assert.equal(status.toolSurface.toolSurfaceVersion, 23);
  assert.equal(status.toolSurface.toolCount, 34);
  assert.deepEqual(status.toolSurface.deprecations, []);
  assert.deepEqual(status.workspaceAliases, ['api', 'app', 'worker', 'zebra']);
  assert.equal(status.workspace, null);
  assert.equal(status.runtimeCompatibility.status, 'repository_unavailable');

  const missing = await relaiStatus(config, { workspace: 'unknown' });
  assert.equal(missing.workspace.alias, 'unknown');
  assert.match(missing.workspace.error, /not configured/i);
  assert.deepEqual(missing.workspaceAliases, ['api', 'app', 'worker', 'zebra']);
} finally {
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
}

console.log('Status workspace aliases unit tests passed');
