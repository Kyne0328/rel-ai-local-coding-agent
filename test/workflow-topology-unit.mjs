import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { discoverRepositoryTopology, packageForPath } from '../src/workflow/topology.js';
import { discoverCommands } from '../src/commandDiscovery.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-topology-'));
try {
  fs.mkdirSync(path.join(root, 'back-end', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'front-end', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'front-end', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'back-end', 'package.json'), JSON.stringify({ name: 'api', scripts: { test: 'node --test', lint: 'eslint .' } }));
  fs.writeFileSync(path.join(root, 'front-end', 'package.json'), JSON.stringify({ name: 'web', scripts: { test: 'node --test', build: 'vite build' }, devDependencies: { vite: '^7' } }));
  fs.writeFileSync(path.join(root, 'front-end', 'src', 'app.js'), 'export const app = true;\n');
  fs.writeFileSync(path.join(root, 'front-end', 'test', 'app.test.js'), 'export {};\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'ignored'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored', 'package.json'), '{}');

  const topology = discoverRepositoryTopology(root);
  assert.deepEqual(topology.packages.map(item => item.id).sort(), ['npm:back-end', 'npm:front-end']);
  assert.equal(packageForPath(topology, 'front-end/src/app.js')?.id, 'npm:front-end');
  assert.equal(packageForPath(topology, 'back-end/src/api.js')?.id, 'npm:back-end');
  assert.match(topology.fingerprint, /^[a-f0-9]{64}$/);

  const commands = discoverCommands(root);
  assert.equal(commands['npm:front-end:test'], 'npm test');
  assert.equal(commands['npm:back-end:test'], 'npm test');
  assert.equal(commands['npm:front-end:build'], 'npm run build');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Nested repository topology and command projection tests passed.');