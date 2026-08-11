import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectVerifyCheckUnits } from '../src/bridge/checkDetection.js';
import { discoverRepositoryTopology } from '../src/workflow/topology.js';
import { buildCheckCatalog, selectChecksForPackages } from '../src/workflow/checkCatalog.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-workflow-checks-'));
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      check: 'node --check index.js',
      test: 'npm run test:all',
      'test:all': 'node --test',
      'benchmark:observability': 'node benchmark.js',
      release: 'node release.js',
      'watch:css': 'node watch.js',
      'fetch:tool': 'node fetch.js',
      'electron:dist': 'node package.js'
    }
  }));
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

  for (const level of ['quick', 'standard', 'release']) {
    const units = detectVerifyCheckUnits(root, level);
    const serialized = units.map(item => `${item.command}@${item.cwd}`).join('\n');
    assert.doesNotMatch(serialized, /benchmark:|\brelease\b|watch:|fetch:|electron:dist/, `${level} validation must not auto-select operational scripts`);
    assert.ok(units.length <= 8, `${level} validation should stay bounded, got ${units.length}: ${serialized}`);
  }
  assert.deepEqual(detectVerifyCheckUnits(root, 'quick').map(item => item.command), ['npm run check', 'npm run lint']);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Package-aware structured check catalog tests passed.');