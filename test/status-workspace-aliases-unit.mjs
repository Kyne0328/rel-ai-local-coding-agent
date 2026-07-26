import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { relaiStatus } = require('../src/tools/status.js');

const config = {
  workspaces: {
    zebra: { path: '/tmp/zebra' },
    app: { path: '/tmp/app' },
    worker: { path: '/tmp/worker' },
    api: { path: '/tmp/api' }
  }
};

const status = await relaiStatus(config);
assert.equal(status.workspaceCount, 4);
assert.equal(status.toolSurface.toolSurfaceVersion, 10);
assert.equal(status.toolSurface.toolCount, 20);
assert.deepEqual(status.toolSurface.deprecations, []);
assert.deepEqual(status.workspaceAliases, ['api', 'app', 'worker', 'zebra']);
assert.equal(status.workspace, null);

const missing = await relaiStatus(config, { workspace: 'unknown' });
assert.equal(missing.workspace.alias, 'unknown');
assert.match(missing.workspace.error, /not configured/i);
assert.deepEqual(missing.workspaceAliases, ['api', 'app', 'worker', 'zebra'], 'invalid alias response must still expose valid choices');

console.log('Status workspace aliases unit tests passed');
