import assert from 'node:assert/strict';

import { aliasConsistencyCheck } from "../src/productUx.js";

for (const config of [{}, { workspaces: {} }, { workspaces: null }]) {
  const result = aliasConsistencyCheck(config);
  assert.equal(result.ok, true);
  assert.deepEqual(result.workspaces, []);
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
}

for (const testCommands of [undefined, null, {}]) {
  const result = aliasConsistencyCheck({
    workspaces: { myapp: { path: '/nonexistent-relai-test-path', testCommands } }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.workspaces[0].configuredKeys, []);
  assert.deepEqual(result.workspaces[0].staleKeys, []);
}

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
  assert.deepEqual(result.workspaces[0].configuredKeys, ['lint', 'test']);
  assert.deepEqual(result.workspaces[0].staleKeys, ['lint', 'test']);
}

for (const workspace of [
  { path: '', testCommands: { test: 'npm test' } },
  { testCommands: { test: 'npm test' } }
]) {
  const result = aliasConsistencyCheck({ workspaces: { myapp: workspace } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.workspaces[0].staleKeys, ['test']);
}

{
  const malformed = aliasConsistencyCheck({
    workspaces: { myapp: { path: '/nope', testCommands: ['npm test'] } }
  });
  assert.equal(malformed.ok, false);
  assert.deepEqual(malformed.workspaces[0].configuredKeys, ['0']);
  assert.deepEqual(malformed.workspaces[0].staleKeys, ['0']);

  const falsy = aliasConsistencyCheck({
    workspaces: { myapp: { path: '/nope', testCommands: { ignored: 0 } } }
  });
  assert.equal(falsy.ok, true);
  assert.deepEqual(falsy.workspaces[0].staleKeys, []);
}

{
  const result = aliasConsistencyCheck({
    workspaces: {
      clean: { path: '/nonexistent-relai-test-path-xyz789', testCommands: {} },
      stale: { path: '/nonexistent-relai-test-path-xyz789', testCommands: { test: 'npm test' } }
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.workspaces.find(workspace => workspace.alias === 'clean').ok, true);
  assert.equal(result.workspaces.find(workspace => workspace.alias === 'stale').ok, false);
}

console.log('Alias consistency tests passed, including malformed and missing configuration cases.');
