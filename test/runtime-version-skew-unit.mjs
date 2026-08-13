import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {
  assessRuntimeCompatibility,
  assertRuntimeCompatibility,
  readRepositoryMetadata,
  runtimeMetadata
} = await import('../src/runtimeCompatibility.js');

const current = runtimeMetadata();
const packageVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const releaseManifest = JSON.parse(fs.readFileSync(new URL('../release-manifest.json', import.meta.url), 'utf8'));
assert.equal(current.applicationVersion, packageVersion);
assert.equal(current.toolSurfaceVersion, releaseManifest.toolSurfaceVersion);
assert.equal(current.toolCount, releaseManifest.toolCount);
assert.match(current.manifestHash, /^[A-Za-z0-9_-]{24}$/);
assert.equal(current.schemaVersion, releaseManifest.schemaVersion);

const configured = runtimeMetadata({
  toolProfile: 'core',
  workspaces: { repo: { path: process.cwd() }, another: { path: os.tmpdir() } }
});
assert.equal(configured.toolCount, current.toolCount, 'stale profile configuration must not reduce the public surface');
assert.equal(configured.manifestHash, current.manifestHash, 'configuration fields must not change the runtime manifest hash');

const equal = assessRuntimeCompatibility(current, { ...current, source: 'repository' });
assert.equal(equal.status, 'compatible');
assert.equal(equal.compatible, true);
assert.equal(equal.restartRequired, false);

const repositoryAhead = assessRuntimeCompatibility(
  { ...current, applicationVersion: '0.22.0', packageVersion: '0.22.0', toolSurfaceVersion: 22, toolCount: 33, manifestHash: 'old' },
  { ...current, source: 'repository' },
  { activeTaskCount: 2 }
);
assert.equal(repositoryAhead.status, 'restart_required');
assert.equal(repositoryAhead.restartRequired, true);
assert.equal(repositoryAhead.schemaSensitiveOperationsBlocked, false);
assert.equal(repositoryAhead.advisoryOnly, true);
assert.equal(repositoryAhead.activeTasksPreventRestart, true);
assert.match(repositoryAhead.message, /tools remain available/i);

const runtimeAhead = assessRuntimeCompatibility(
  { ...current, applicationVersion: '999.0.0', packageVersion: '999.0.0' },
  { ...current, source: 'repository' }
);
assert.equal(runtimeAhead.status, 'runtime_newer');
assert.equal(runtimeAhead.restartRequired, false);
assert.equal(runtimeAhead.schemaSensitiveOperationsBlocked, false);
assert.equal(runtimeAhead.advisoryOnly, true);

const surfaceMismatch = assessRuntimeCompatibility(
  current,
  { ...current, source: 'repository', toolSurfaceVersion: current.toolSurfaceVersion + 1, manifestHash: 'changed' }
);
assert.equal(surfaceMismatch.status, 'restart_required');
assert.ok(surfaceMismatch.differences.some(item => item.field === 'toolSurfaceVersion'));

const unavailable = assessRuntimeCompatibility(current, null);
assert.equal(unavailable.status, 'repository_unavailable');
assert.equal(unavailable.compatible, true);
assert.equal(unavailable.schemaSensitiveOperationsBlocked, false);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-runtime-skew-'));
try {
  const repositoryVersion = '999.0.0';
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'rel-ai-mcp', version: repositoryVersion }));
  fs.writeFileSync(path.join(temp, 'release-manifest.json'), JSON.stringify({
    schemaVersion: current.schemaVersion,
    applicationVersion: repositoryVersion,
    protocolVersion: current.protocolVersion,
    toolSurfaceVersion: current.toolSurfaceVersion + 1,
    toolCount: current.toolCount,
    manifestHash: 'new-surface'
  }));
  const repository = readRepositoryMetadata(temp, 'repo');
  assert.equal(repository.applicationVersion, repositoryVersion);
  assert.equal(repository.workspace, 'repo');
  const config = { workspaces: { repo: { path: temp } } };
  const editCompatibility = assertRuntimeCompatibility(
    config,
    'relai_edit',
    { workspace: 'repo' },
    { activeTaskCount: 1 }
  );
  assert.equal(editCompatibility.compatibility.status, 'restart_required');
  assert.equal(editCompatibility.compatibility.schemaSensitiveOperationsBlocked, false);
  assert.doesNotThrow(() => assertRuntimeCompatibility(config, 'relai_status', { workspace: 'repo' }));
  assert.doesNotThrow(() => assertRuntimeCompatibility(config, 'relai_begin_work', { workspace: 'repo' }));
  assert.doesNotThrow(() => assertRuntimeCompatibility(config, 'relai_cancel_work', { workspace: 'repo' }));
  assert.doesNotThrow(() => assertRuntimeCompatibility(
    config,
    'relai_run_checks',
    { workspace: 'repo', work_id: 'task-1', complete: true, summary: 'Validate and close.' },
    { activeTaskCount: 1 }
  ));

  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'rel-ai-mcp', version: current.applicationVersion }));
  fs.writeFileSync(path.join(temp, 'release-manifest.json'), JSON.stringify({
    schemaVersion: current.schemaVersion,
    applicationVersion: current.applicationVersion,
    protocolVersion: current.protocolVersion,
    toolSurfaceVersion: current.toolSurfaceVersion,
    toolCount: current.toolCount,
    manifestHash: current.manifestHash
  }));
  assert.doesNotThrow(() => assertRuntimeCompatibility(config, 'relai_edit', { workspace: 'repo' }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Runtime/repository skew remains observable without blocking self-hosted editing or other tools.');
