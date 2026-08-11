import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { discoverRepositoryTopology } from '../src/workflow/topology.js';
import { buildCheckCatalog, selectChecksForPackages } from '../src/workflow/checkCatalog.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-checks-'));
try {
  fs.mkdirSync(path.join(root, 'back-end'), { recursive: true });
  fs.mkdirSync(path.join(root, 'front-end'), { recursive: true });
  fs.writeFileSync(path.join(root, 'back-end', 'package.json'), JSON.stringify({ scripts: { test: 'node --test', migrate: 'node migrate.js' } }));
  fs.writeFileSync(path.join(root, 'front-end', 'package.json'), JSON.stringify({ scripts: { test: 'node --test', lint: 'eslint src', build: 'vite build' } }));

  const catalog = buildCheckCatalog(discoverRepositoryTopology(root));
  const front = catalog.filter(item => item.packageId === 'npm:front-end');
  const back = catalog.filter(item => item.packageId === 'npm:back-end');
  assert.ok(front.some(item => item.id === 'npm:front-end:test' && item.cwd === 'front-end' && item.command === 'npm test' && item.kind === 'test'));
  assert.ok(back.some(item => item.id === 'npm:back-end:test' && item.cwd === 'back-end'));
  assert.ok(back.some(item => item.kind === 'migration'));
  assert.equal(selectChecksForPackages(catalog, ['npm:back-end']).some(item => item.kind === 'migration'), false, 'migration must never be auto-selected');
  assert.equal(new Set(catalog.map(item => `${item.command}|${item.cwd}`)).size, catalog.length, 'duplicate command names in different package cwd must be preserved');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Package-aware structured check catalog tests passed.');