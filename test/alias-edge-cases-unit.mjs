import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { aliasConsistencyCheck } = require('../src/productUx.js');

// 1. Empty config returns ok with empty workspaces
{
  const r = aliasConsistencyCheck({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.workspaces, []);
  console.log('1. empty config: OK');
}

// 2. testCommands is null -> treated as no commands, ok: true
{
  const r = aliasConsistencyCheck({ workspaces: { a: { path: '/nope', testCommands: null } } });
  assert.equal(r.workspaces[0].ok, true);
  assert.deepEqual(r.workspaces[0].configuredKeys, []);
  console.log('2. testCommands null: OK');
}

// 3. testCommands is array (malformed) -> Object.keys gives indices? Verify it doesnt crash and yields ok
{
  // Object.keys on an array returns string indices. The function should not crash.
  const r = aliasConsistencyCheck({ workspaces: { a: { path: '/nope', testCommands: ['npm test'] } } });
  // Configured keys are ['0']; values include 'npm test' which isn't discovered. So stale.
  assert.equal(r.workspaces[0].ok, false);
  console.log('3. testCommands array: OK');
}

// 4. Workspace with non-string command value (e.g. number) -> not stale (cmd truthy check filters)
{
  const r = aliasConsistencyCheck({ workspaces: { a: { path: '/nope', testCommands: { foo: 0 } } } });
  // cmd=0 is falsy, filter skips it -> staleKeys empty
  assert.equal(r.workspaces[0].ok, true);
  assert.deepEqual(r.workspaces[0].staleKeys, []);
  console.log('4. non-truthy command value: OK');
}

// 5. Workspace path empty string -> all configured keys stale
{
  const r = aliasConsistencyCheck({ workspaces: { a: { path: '', testCommands: { test: 'npm test' } } } });
  assert.equal(r.workspaces[0].ok, false);
  assert.deepEqual(r.workspaces[0].staleKeys, ['test']);
  console.log('5. empty path: OK');
}

// 6. Workspace path missing entirely -> all configured keys stale
{
  const r = aliasConsistencyCheck({ workspaces: { a: { testCommands: { test: 'npm test' } } } });
  assert.equal(r.workspaces[0].ok, false);
  console.log('6. missing path: OK');
}

// 7. Multiple workspaces: at least one stale -> overall ok false
{
  const r = aliasConsistencyCheck({
    workspaces: {
      a: { path: '/nope', testCommands: {} },
      b: { path: '/nope', testCommands: { test: 'npm test' } }
    }
  });
  assert.equal(r.ok, false);
  assert.equal(r.workspaces.find(w => w.alias === 'a').ok, true);
  assert.equal(r.workspaces.find(w => w.alias === 'b').ok, false);
  console.log('7. mixed workspaces: OK');
}

// 8. workspaces field missing -> ok true, empty array
{
  const r = aliasConsistencyCheck({});
  assert.equal(r.ok, true);
  console.log('8. workspaces missing: OK');
}

// 9. workspaces is null -> handled gracefully
{
  const r = aliasConsistencyCheck({ workspaces: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.workspaces, []);
  console.log('9. workspaces null: OK');
}

// 10. generatedAt is ISO timestamp
{
  const r = aliasConsistencyCheck({});
  assert.match(r.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  console.log('10. generatedAt ISO: OK');
}

console.log('alias edge-cases unit tests passed.');
