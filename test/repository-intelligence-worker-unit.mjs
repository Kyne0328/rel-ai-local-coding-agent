import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { repositoryIndexPath } from '../src/repository/intelligence/database.js';
import { evictIdleRepositoryWorkers } from '../src/repository/intelligence/indexer.js';
import { repositoryIntelligence } from '../src/repository/intelligence/service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-repository-worker-'));
const stateDir = path.join(root, '.state');
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(workspaceRoot, 'src', 'alpha.js'), 'export function alpha() { return 1; }\n');
fs.writeFileSync(path.join(workspaceRoot, 'src', 'beta.js'), 'export function beta() { return alpha(); }\n');

const workspace = { alias: 'worker-test', path: workspaceRoot, context: {}, testCommands: {}, commands: {} };
const config = { stateDir };

try {
  const initial = await repositoryIntelligence.ensure(workspace, config);
  assert.equal(initial.workerIsolated, true);
  assert.equal(initial.scanMode, 'full');
  assert.equal(initial.runtimeStatus, 'ready');
  assert.ok(initial.sourceFileCount >= 2);

  assert.equal(evictIdleRepositoryWorkers('test idle eviction'), 1);
  const afterEvictionStatus = repositoryIntelligence.status(workspace, config);
  assert.equal(afterEvictionStatus.status, 'ready');
  assert.equal(afterEvictionStatus.active, false);
  assert.equal(afterEvictionStatus.dirty, false);

  fs.writeFileSync(path.join(workspaceRoot, 'src', 'alpha.js'), 'export function alpha() { return 2; }\n');
  repositoryIntelligence.noteMutation(workspace, config, ['src/alpha.js']);
  const incremental = await repositoryIntelligence.ensure(workspace, config);
  assert.equal(incremental.scanMode, 'incremental');
  assert.equal(incremental.changedPathCount, 1);
  assert.equal(incremental.pendingRefresh, false);

  assert.equal(evictIdleRepositoryWorkers('test second idle eviction'), 1);
  const cached = await repositoryIntelligence.ensure(workspace, config);
  assert.equal(cached.cacheHit, true);
  assert.equal(evictIdleRepositoryWorkers('cache hit must not recreate worker'), 0);

  const status = repositoryIntelligence.status(workspace, config);
  assert.equal(status.status, 'ready');
  assert.equal(status.active, false);
  assert.equal(status.dirty, false);

  const rebuilt = await repositoryIntelligence.rebuild(workspace, config);
  assert.equal(rebuilt.scanMode, 'full');
  assert.equal(rebuilt.rebuilt, true);
  assert.ok(rebuilt.generation > incremental.generation);

  repositoryIntelligence.shutdown();
  fs.writeFileSync(repositoryIndexPath(config, workspace), 'not-a-sqlite-database', 'utf8');
  const recovered = await repositoryIntelligence.ensure(workspace, config);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.scanMode, 'full');
  assert.ok(recovered.sourceFileCount >= 2);

  const controller = new AbortController();
  const cancelled = repositoryIntelligence.ensure(workspace, config, { force: true, signal: controller.signal });
  controller.abort(new Error('test active cancellation'));
  await assert.rejects(
    cancelled,
    error => error?.code === 'INDEX_ABORTED' && error?.name === 'AbortError'
  );
  await waitForIdle();
  const afterCancellation = await repositoryIntelligence.ensure(workspace, config, { force: true });
  assert.equal(afterCancellation.runtimeStatus, 'ready');
  assert.equal(afterCancellation.workerIsolated, true);
} finally {
  repositoryIntelligence.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
}

async function waitForIdle() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!repositoryIntelligence.status(workspace, config).active) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Repository Intelligence worker did not settle after cancellation.');
}

console.log('Repository Intelligence worker isolation, incremental refresh, rebuild, recovery, and cancellation tests passed.');
