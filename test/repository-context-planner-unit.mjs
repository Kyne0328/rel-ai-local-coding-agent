import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { relaiSearch } from '../src/bridge/search.js';
import { cachedRepositoryContext, cachedSearchGraphContext } from '../src/repository/intelligence/contextPlanner.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-context-planner-'));
const stateDir = path.join(root, '.state');
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
const markerNoise = Array.from({ length: 4 }, (_, index) => `// marker fixture ${index}`).join('\n');
fs.writeFileSync(path.join(workspaceRoot, 'src', 'core.js'), `export function markerCore() { return 'marker'; }\n${markerNoise}\n`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'service.js'), `import { markerCore } from './core.js';\nexport function markerService() { return markerCore(); }\n${markerNoise}\n`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'app.js'), `import { markerService } from './service.js';\nexport function markerApp() { return markerService(); }\n${markerNoise}\n`);
fs.writeFileSync(path.join(workspaceRoot, 'src', 'isolated.js'), `export const markerIsolated = 'marker';\n${markerNoise}\n`);
const init = spawnSync('git', ['init'], { cwd: workspaceRoot, encoding: 'utf8' });
assert.equal(init.status, 0, init.stderr);

const workspace = { alias: 'context-test', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  assert.equal(cachedRepositoryContext(workspace, config), null, 'cache-only context must not build a missing index');

  await repositoryIntelligence.ensure(workspace, config);
  const bootstrap = cachedRepositoryContext(workspace, config);
  assert.equal(bootstrap.available, true);
  assert.equal(bootstrap.freshness, 'current');
  assert.ok(bootstrap.modules.some(item => item.name === 'src'));
  assert.ok(bootstrap.recommendedReadOrder.length > 0);

  const matches = [
    { path: 'src/core.js', line: 1 },
    { path: 'src/service.js', line: 2 },
    { path: 'src/app.js', line: 2 },
    { path: 'src/isolated.js', line: 1 }
  ];
  const graph = cachedSearchGraphContext(workspace, config, matches);
  assert.equal(graph.available, true);
  assert.ok(graph.rankedPaths.some(item => item.path === 'src/core.js'));
  assert.ok(Object.keys(graph.pathScores).length >= 3);

  const searched = await relaiSearch(workspace, config, { pattern: 'marker', fixed: true });
  assert.equal(searched.autoTier, 'moderate');
  assert.equal(searched.selectionStrategy, 'path-match-density-and-graph');
  assert.match(searched.next, /graph-prioritized/);
  assert.notEqual(searched.files[0].path, 'src/isolated.js', 'unconnected lexical matches should not outrank structurally connected matches');

  repositoryIntelligence.noteMutation(workspace, config, ['src/core.js']);
  const stale = cachedRepositoryContext(workspace, config);
  assert.equal(stale.freshness, 'stale');
  const staleSearch = await relaiSearch(workspace, config, { pattern: 'marker', fixed: true });
  assert.equal(staleSearch.selectionStrategy, 'path-and-match-density', 'stale graph data must not influence search ordering');
} finally {
  await repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Cached graph bootstrap context, graph-ranked search, and stale-context tests passed.');
