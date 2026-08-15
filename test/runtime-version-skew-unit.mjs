import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {
  assessRuntimeCompatibility,
  readRepositoryMetadata,
  runtimeMetadata
} = await import('../src/runtimeCompatibility.js');

const current = runtimeMetadata();
assert.equal(runtimeMetadata(), current, 'unchanged runtime metadata should reuse the canonical manifest calculation');
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
  const cachedAlias = readRepositoryMetadata(temp, 'secondary');
  assert.equal(cachedAlias.applicationVersion, repositoryVersion);
  assert.equal(cachedAlias.workspace, 'secondary', 'cached repository metadata must not retain the previous workspace alias');
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'rel-ai-mcp', version: current.applicationVersion }));
  fs.writeFileSync(path.join(temp, 'release-manifest.json'), JSON.stringify({
    schemaVersion: current.schemaVersion,
    applicationVersion: current.applicationVersion,
    protocolVersion: current.protocolVersion,
    toolSurfaceVersion: current.toolSurfaceVersion,
    toolCount: current.toolCount,
    manifestHash: current.manifestHash
  }));
  const refreshedRepository = readRepositoryMetadata(temp, 'repo');
  assert.equal(refreshedRepository.applicationVersion, current.applicationVersion, 'repository metadata cache must invalidate when source files change');
  assert.equal(refreshedRepository.manifestHash, current.manifestHash);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Runtime/repository skew remains observable without blocking self-hosted editing or other tools.');
