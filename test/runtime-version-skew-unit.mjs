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
assert.equal(current.applicationVersion, '0.23.0');
assert.equal(current.toolSurfaceVersion, 25);
assert.equal(current.toolCount, 33);
assert.match(current.manifestHash, /^[A-Za-z0-9_-]{24}$/);

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
assert.equal(repositoryAhead.schemaSensitiveOperationsBlocked, true);
assert.equal(repositoryAhead.activeTasksPreventRestart, true);
assert.match(repositoryAhead.message, /run final validation with complete:true/i);

const runtimeAhead = assessRuntimeCompatibility(
  { ...current, applicationVersion: '0.24.0', packageVersion: '0.24.0', toolSurfaceVersion: 25 },
  { ...current, source: 'repository' }
);
assert.equal(runtimeAhead.status, 'runtime_newer');
assert.equal(runtimeAhead.restartRequired, false);
assert.equal(runtimeAhead.schemaSensitiveOperationsBlocked, true);

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
  fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'rel-ai-mcp', version: '0.24.0' }));
  fs.writeFileSync(path.join(temp, 'release-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    applicationVersion: '0.24.0',
    protocolVersion: current.protocolVersion,
    toolSurfaceVersion: 24,
    toolCount: 33,
    manifestHash: 'new-surface'
  }));
  const repository = readRepositoryMetadata(temp, 'repo');
  assert.equal(repository.applicationVersion, '0.24.0');
  assert.equal(repository.workspace, 'repo');
  const config = { workspaces: { repo: { path: temp } } };
  assert.throws(
    () => assertRuntimeCompatibility(config, 'relai_edit', { workspace: 'repo' }, { activeTaskCount: 1 }),
    error => error?.code === 'RUNTIME_RESTART_REQUIRED' && error.details.activeTasksPreventRestart === true
  );
  assert.doesNotThrow(() => assertRuntimeCompatibility(config, 'relai_status', { workspace: 'repo' }));
  assert.doesNotThrow(() => assertRuntimeCompatibility(config, 'relai_cancel_task', { workspace: 'repo' }));
  assert.doesNotThrow(() => assertRuntimeCompatibility(
    config,
    'relai_run_checks',
    { workspace: 'repo', task_id: 'task-1', complete: true, summary: 'Validate and close.' },
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

console.log('Runtime/repository application, protocol, tool-surface, count, hash, and safe-operation skew handling passed.');
