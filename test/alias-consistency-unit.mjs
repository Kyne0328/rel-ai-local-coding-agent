import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { aliasConsistencyCheck } = require('../src/productUx.js');

// 1. No workspaces → ok: true, empty workspaces array
{
  const result = aliasConsistencyCheck({ workspaces: {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.workspaces, []);
  assert.ok(typeof result.generatedAt === 'string', 'generatedAt must be string');
  console.log('1. no workspaces: OK');
}

// 2. Workspace with no testCommands → configuredKeys empty, staleKeys empty, ok: true
{
  const result = aliasConsistencyCheck({
    workspaces: { myapp: { path: '/nonexistent-relai-test-path', testCommands: {} } }
  });
  assert.equal(result.ok, true);
  const ws = result.workspaces[0];
  assert.equal(ws.alias, 'myapp');
  assert.deepEqual(ws.configuredKeys, []);
  assert.deepEqual(ws.staleKeys, []);
  assert.equal(ws.ok, true);
  console.log('2. no testCommands: OK');
}

// 3. Missing workspace path → discoverCommands returns {}, all configured keys become stale
{
  const result = aliasConsistencyCheck({
    workspaces: {
      myapp: {
        path: '/nonexistent-relai-test-path-xyz789',
        testCommands: { test: 'npm test', lint: 'npm run lint' }
      }
    }
  });
  assert.equal(result.ok, false);
  const ws = result.workspaces[0];
  assert.equal(ws.ok, false);
  assert.deepEqual(ws.configuredKeys.toSorted((a, b) => a.localeCompare(b)), ['lint', 'test'].toSorted((a, b) => a.localeCompare(b)));
  assert.deepEqual(ws.staleKeys.toSorted((a, b) => a.localeCompare(b)), ['lint', 'test'].toSorted((a, b) => a.localeCompare(b)), 'all keys stale when path nonexistent');
  console.log('3. nonexistent path - all keys stale: OK');
}

// 4. Multiple workspaces — one clean, one stale
{
  const result = aliasConsistencyCheck({
    workspaces: {
      clean: { path: '/nonexistent-relai-test-path-xyz789', testCommands: {} },
      stale: { path: '/nonexistent-relai-test-path-xyz789', testCommands: { test: 'npm test' } }
    }
  });
  assert.equal(result.ok, false, 'overall ok is false when any workspace has stale keys');
  const clean = result.workspaces.find(w => w.alias === 'clean');
  const stale = result.workspaces.find(w => w.alias === 'stale');
  assert.equal(clean.ok, true);
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.staleKeys, ['test']);
  console.log('4. multiple workspaces mixed: OK');
}

console.log('alias-consistency unit tests passed.');
