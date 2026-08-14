import { updateWorkspace } from "../src/configEditor.js";
import { getReleaseNotes } from "../src/releaseNotes.js";
import { staleCommandKeys } from "../src/commandDiscovery.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizePatchConfig, makeDefaultPatchConfig, normalizeConfig, ensureConfig, invalidateConfigCache } from "../src/config.js";

const exampleConfig = JSON.parse(fs.readFileSync(path.resolve('examples/config.example.json'), 'utf8'));
assert.equal(exampleConfig.auditLogPath, '', 'the portable example must not mix Windows and Unix path syntax');

assert.deepEqual(makeDefaultPatchConfig(), {
  backup: true,
  requireCleanGit: false,
  maxUpdateBytes: 50 * 1024 * 1024
});
assert.equal(Object.hasOwn(exampleConfig.patch || {}, 'maxUpdateBytes'), false, 'normal configuration should not expose a user-tuned patch size');

assert.deepEqual(normalizePatchConfig(undefined), makeDefaultPatchConfig());
assert.deepEqual(normalizePatchConfig({ backup: false, requireCleanGit: true, maxUpdateBytes: 4096 }), {
  backup: false,
  requireCleanGit: true,
  maxUpdateBytes: 50 * 1024 * 1024
});
assert.equal(normalizePatchConfig({ maxUpdateBytes: 1 }).maxUpdateBytes, 50 * 1024 * 1024, 'legacy low patch limits must not throttle upgraded installations');
assert.equal(normalizePatchConfig({ maxUpdateBytes: 100 * 1024 * 1024 }).maxUpdateBytes, 50 * 1024 * 1024);

const strict = normalizeConfig({
  stateDir: path.join(os.tmpdir(), 'relai-state'),
  workflow: { prepared: { backup: false, requireCleanGit: true, maxPatchBytes: 8192 } },
  flow: { fast: { maxPatchBytes: 4096 } },
  cautionZone: true,
  maxIndexFiles: 99,
  patch: { backup: true, requireCleanGit: false, maxUpdateBytes: 16384, maxPatchBytes: 8192 },
  workspaces: {
    repo: {
      path: process.cwd(),
      fastTask: { maxIndexFiles: 22, includePaths: ['legacy'] },
      protectedBranches: ['main'],
      defaultBaseBranch: 'main',
      allowedRemotes: ['origin'],
      context: { snapshotMaxFiles: 44, includeRoots: ['src'] }
    }
  }
});
assert.deepEqual(strict.patch, { backup: true, requireCleanGit: false, maxUpdateBytes: 50 * 1024 * 1024 });
for (const key of ['workflow', 'flow', 'cautionZone', 'maxIndexFiles']) assert.equal(Object.hasOwn(strict, key), false);
assert.equal(Object.hasOwn(normalizeConfig({ toolProfile: 'core' }), 'toolProfile'), false, 'removed toolProfile configuration must be discarded');
assert.equal(Object.hasOwn(strict.patch, 'maxPatchBytes'), false);
assert.equal(Object.hasOwn(strict.workspaces.repo, 'fastTask'), false);
assert.equal(strict.workspaces.repo.context.snapshotMaxFiles, 44);
assert.deepEqual(strict.workspaces.repo.context.includeRoots, ['src']);
assert.equal(Object.hasOwn(normalizeConfig({ productUx: { showAutomaticValidation: false }, workspaces: {} }).productUx, 'showAutomaticValidation'), false);
for (const key of ['protectedBranches', 'defaultBaseBranch', 'allowedRemotes']) assert.equal(Object.hasOwn(strict.workspaces.repo, key), false, `removed workspace field ${key} must be discarded`);
const runtimePolicy = normalizeConfig({
  telemetry: { enabled: true, endpoint: ' http://127.0.0.1:4318/v1/traces ', sampleRatio: 0.25 },
  processEnvironment: { allow: ['CUSTOM_SAFE', 'GITHUB_TOKEN', 'CUSTOM_SAFE', ''] }
});
assert.deepEqual(runtimePolicy.telemetry, {
  enabled: true,
  endpoint: 'http://127.0.0.1:4318/v1/traces',
  sampleRatio: 0.25
});
assert.deepEqual(runtimePolicy.processEnvironment, { allow: ['CUSTOM_SAFE', 'GITHUB_TOKEN'] });
assert.equal(normalizeConfig({ telemetry: { sampleRatio: 2 } }).telemetry.sampleRatio, 1);
assert.equal(normalizeConfig({ telemetry: { sampleRatio: -1 } }).telemetry.sampleRatio, 0);

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-config-v3-hard-cutover-'));
  const tmpConfig = path.join(tmpDir, 'config.json');
  const previous = process.env.REL_AI_MCP_CONFIG;
  process.env.REL_AI_MCP_CONFIG = tmpConfig;
  try {
    fs.writeFileSync(tmpConfig, `${JSON.stringify({
      version: 3,
      sourceVersion: 3,
      stateDir: tmpDir,
      trustedLocalAgent: true,
      productUx: { showAutomaticValidation: false },
      workspaces: {
        keep: {
          path: tmpDir,
          protectedBranches: ['main'],
          defaultBaseBranch: 'main',
          allowedRemotes: ['origin'],
          context: { snapshotMaxFiles: 44, includeRoots: ['src'] }
        }
      }
    }, null, 2)}\n`);
    invalidateConfigCache();
    const migrated = ensureConfig();
    const persisted = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
    assert.equal(migrated.version, 4, 'v3 configuration must normalize to the hard-cutover schema');
    assert.equal(persisted.version, 4, 'hard-cutover normalization must be persisted before desktop startup continues');
    assert.equal(Object.hasOwn(persisted, 'sourceVersion'), false, 'obsolete sourceVersion must not survive migration');
    assert.equal(Object.hasOwn(persisted.productUx, 'showAutomaticValidation'), false, 'removed validation display preference must not survive migration');
    for (const key of ['protectedBranches', 'defaultBaseBranch', 'allowedRemotes']) assert.equal(Object.hasOwn(persisted.workspaces.keep, key), false, `removed workspace field ${key} must not survive migration`);
    assert.equal(persisted.workspaces.keep.path, tmpDir, 'valid workspaces must survive configuration migration');
    assert.equal(fs.existsSync(`${tmpConfig}.bak`), true, 'configuration migration must preserve the original file as a backup');
  } finally {
    if (previous == null) delete process.env.REL_AI_MCP_CONFIG;
    else process.env.REL_AI_MCP_CONFIG = previous;
    invalidateConfigCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-config-invalid-recovery-'));
  const tmpConfig = path.join(tmpDir, 'config.json');
  const previous = process.env.REL_AI_MCP_CONFIG;
  process.env.REL_AI_MCP_CONFIG = tmpConfig;
  try {
    fs.writeFileSync(tmpConfig, '{ invalid json');
    invalidateConfigCache();
    const recovered = ensureConfig();
    assert.equal(recovered.version, 4, 'invalid persisted configuration must recover to a valid current config');
    assert.equal(JSON.parse(fs.readFileSync(tmpConfig, 'utf8')).version, 4);
    assert.equal(
      fs.readdirSync(tmpDir).some(name => name.startsWith('config.json.invalid-')),
      true,
      'invalid configuration must be preserved for diagnostics instead of deleted'
    );
  } finally {
    if (previous == null) delete process.env.REL_AI_MCP_CONFIG;
    else process.env.REL_AI_MCP_CONFIG = previous;
    invalidateConfigCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
const normalizedCommands = normalizeConfig({
  workspaces: {
    repo: {
      path: process.cwd(),
      testCommands: {
        'npm:test': 'npm test',
        'npm:test:fast-task': 'npm run test:fast-task'
      }
    }
  }
});
assert.deepEqual(normalizedCommands.workspaces.repo.testCommands, { 'npm:test': 'npm test' });

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-cfg-'));
  const tmpConfig = path.join(tmpDir, 'config.json');
  const previous = process.env.REL_AI_MCP_CONFIG;
  process.env.REL_AI_MCP_CONFIG = tmpConfig;
  try {
    fs.writeFileSync(tmpConfig, JSON.stringify({ trustedLocalAgent: true, workspaces: { broken: { path: path.join(tmpDir, 'missing') } } }));

    const current = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
    const result = updateWorkspace(current, { action: 'clear', alias: 'broken', confirmClear: true });
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(tmpConfig, 'utf8')).workspaces.broken, undefined);
  } finally {
    if (previous == null) delete process.env.REL_AI_MCP_CONFIG;
    else process.env.REL_AI_MCP_CONFIG = previous;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

{

  const notes = getReleaseNotes();
  assert.ok(notes.version);
  assert.ok(Array.isArray(notes.bullets));
}

{

  assert.deepEqual(staleCommandKeys({ test: 'npm run gone', build: 'npm run build' }, { build: 'npm run build' }), ['test']);
}

console.log('Current-only configuration normalization tests passed.');
