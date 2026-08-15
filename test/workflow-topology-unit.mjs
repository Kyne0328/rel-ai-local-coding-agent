import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  TOPOLOGY_RECHECK_MS,
  clearTopologyCache,
  discoverRepositoryTopology,
  invalidateRepositoryTopology,
  packageForPath
} from '../src/workflow/topology.js';
import { commandDiscoveryWarnings, discoverCommands } from '../src/commandDiscovery.js';

const nestedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-topology-'));
try {
  fs.mkdirSync(path.join(nestedRoot, 'back-end', 'src'), { recursive: true });
  fs.mkdirSync(path.join(nestedRoot, 'front-end', 'src'), { recursive: true });
  fs.mkdirSync(path.join(nestedRoot, 'front-end', 'test'), { recursive: true });
  fs.writeFileSync(path.join(nestedRoot, 'back-end', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: 'node --test', lint: 'eslint .' } }));
  fs.writeFileSync(path.join(nestedRoot, 'front-end', 'package.json'), JSON.stringify({ name: 'web', scripts: { test: 'node --test', build: 'vite build' }, devDependencies: { vite: '^7' } }));
  fs.writeFileSync(path.join(nestedRoot, 'front-end', 'src', 'app.js'), 'export const app = true;\n');
  fs.writeFileSync(path.join(nestedRoot, 'front-end', 'test', 'app.test.js'), 'export {};\n');
  fs.mkdirSync(path.join(nestedRoot, 'node_modules', 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(nestedRoot, 'node_modules', 'ignored', 'package.json'), '{}');

  const topology = discoverRepositoryTopology(nestedRoot);
  assert.deepEqual(topology.packages.map(item => item.id).sort(), ['npm:back-end', 'npm:front-end']);
  assert.equal(packageForPath(topology, 'front-end/src/app.js')?.id, 'npm:front-end');
  assert.equal(packageForPath(topology, 'back-end/src/api.js')?.id, 'npm:back-end');
  assert.match(topology.fingerprint, /^[a-f0-9]{64}$/);

  const commands = discoverCommands(nestedRoot);
  assert.equal(commands['npm:front-end:test'], 'npm test');
  assert.equal(commands['npm:back-end:test'], 'npm test');
  assert.equal(commands['npm:front-end:build'], 'npm run build');

  const malformed = path.join(nestedRoot, 'malformed');
  fs.mkdirSync(malformed, { recursive: true });
  fs.writeFileSync(path.join(malformed, 'package.json'), '{malformed', 'utf8');
  assert.deepEqual(discoverCommands(malformed), {});
  assert.ok(commandDiscoveryWarnings(malformed).some(item => item.source === 'package.json'), 'manifest discovery failures must remain visible to diagnostics');
} finally {
  clearTopologyCache();
  fs.rmSync(nestedRoot, { recursive: true, force: true });
}

const invalidationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-topology-invalidation-'));
try {
  fs.mkdirSync(path.join(invalidationRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(invalidationRoot, 'src', 'index.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(invalidationRoot, 'package.json'), JSON.stringify({ name: 'root-a', scripts: { test: 'node test.js' } }, null, 2));

  clearTopologyCache();
  const initial = discoverRepositoryTopology(invalidationRoot);
  assert.equal(initial.packages.length, 1);
  assert.equal(initial.packages[0].name, 'root-a');
  assert.deepEqual(initial.packages[0].sourceRoots, ['src']);

  fs.writeFileSync(path.join(invalidationRoot, 'src', 'index.js'), 'export const value = 2;\n');
  assert.equal(
    invalidateRepositoryTopology(invalidationRoot, ['src/index.js']),
    false,
    'ordinary edits inside an already-known source root must not invalidate topology'
  );
  assert.equal(discoverRepositoryTopology(invalidationRoot).fingerprint, initial.fingerprint);

  fs.writeFileSync(path.join(invalidationRoot, 'package.json'), JSON.stringify({
    name: 'root-renamed',
    scripts: { test: 'node test.js', lint: 'node lint.js' },
    dependencies: { example: '^1.0.0' }
  }, null, 2));
  assert.equal(discoverRepositoryTopology(invalidationRoot).fingerprint, initial.fingerprint, 'the hot cache should avoid repeated manifest stats inside its short recheck window');
  await new Promise(resolve => setTimeout(resolve, TOPOLOGY_RECHECK_MS + 20));
  const manifestChanged = discoverRepositoryTopology(invalidationRoot);
  assert.notEqual(manifestChanged.fingerprint, initial.fingerprint, 'external manifest edits must invalidate after the bounded recheck window');
  assert.equal(manifestChanged.packages[0].name, 'root-renamed');
  assert.deepEqual(manifestChanged.packages[0].dependencies, ['example']);

  fs.mkdirSync(path.join(invalidationRoot, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(invalidationRoot, 'lib', 'new.js'), 'export {};\n');
  assert.equal(
    invalidateRepositoryTopology(invalidationRoot, ['lib/new.js']),
    true,
    'creating a previously absent package source root must invalidate topology'
  );
  const withLib = discoverRepositoryTopology(invalidationRoot);
  assert.deepEqual(withLib.packages[0].sourceRoots, ['src', 'lib']);
  assert.equal(invalidateRepositoryTopology(invalidationRoot, ['lib/new.js']), false, 'ordinary edits in the now-known root stay cached');

  fs.mkdirSync(path.join(invalidationRoot, 'packages', 'child'), { recursive: true });
  fs.writeFileSync(path.join(invalidationRoot, 'packages', 'child', 'package.json'), JSON.stringify({ name: 'child-package' }, null, 2));
  assert.equal(
    invalidateRepositoryTopology(invalidationRoot, ['packages/child/package.json']),
    true,
    'new manifest paths explicitly invalidate the cached manifest set'
  );
  const withChild = discoverRepositoryTopology(invalidationRoot);
  assert.ok(withChild.manifests.includes('packages/child/package.json'));
  assert.equal(withChild.packages.some(item => item.name === 'child-package'), true);

  assert.equal(invalidateRepositoryTopology(invalidationRoot, []), true, 'broad mutations invalidate topology conservatively');
} finally {
  clearTopologyCache();
  fs.rmSync(invalidationRoot, { recursive: true, force: true });
}

console.log('Nested repository topology, command projection, and invalidation tests passed.');
