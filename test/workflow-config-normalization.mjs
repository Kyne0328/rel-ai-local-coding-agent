import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizePatchConfig,
  makeDefaultPatchConfig,
  normalizeConfig
} = require('../src/config.js');

assert.deepEqual(makeDefaultPatchConfig(), {
  backup: true,
  requireCleanGit: false,
  maxUpdateBytes: 2 * 1024 * 1024
});

assert.deepEqual(normalizePatchConfig(undefined), makeDefaultPatchConfig());
assert.deepEqual(normalizePatchConfig({ backup: false, requireCleanGit: true, maxUpdateBytes: 4096 }), {
  backup: false,
  requireCleanGit: true,
  maxUpdateBytes: 4096
});
assert.equal(normalizePatchConfig({ maxUpdateBytes: 1 }).maxUpdateBytes, 1024);
assert.equal(normalizePatchConfig({ maxUpdateBytes: 100 * 1024 * 1024 }).maxUpdateBytes, 50 * 1024 * 1024);

const migrated = normalizeConfig({
  stateDir: path.join(os.tmpdir(), 'relai-state'),
  workflow: {
    mode: 'prepared',
    prepared: {
      backup: false,
      requireCleanGit: true,
      maxPatchBytes: 8192,
      maxBundleBytes: 123456,
      clearMissingDefault: true
    }
  },
  workspaces: {}
});
assert.deepEqual(migrated.patch, { backup: false, requireCleanGit: true, maxUpdateBytes: 8192 });
assert.equal(Object.hasOwn(migrated, 'workflow'), false);
assert.equal(Object.hasOwn(migrated, 'flow'), false);
assert.equal(Object.hasOwn(migrated, 'cautionZone'), false);
assert.equal(Object.hasOwn(migrated.patch, 'maxBundleBytes'), false);
assert.equal(Object.hasOwn(migrated.patch, 'clearMissingDefault'), false);

{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-cfg-'));
  const tmpConfig = path.join(tmpDir, 'config.json');
  const previous = process.env.REL_AI_MCP_CONFIG;
  process.env.REL_AI_MCP_CONFIG = tmpConfig;
  try {
    fs.writeFileSync(tmpConfig, JSON.stringify({ trustedLocalAgent: true, workspaces: { broken: { path: path.join(tmpDir, 'missing') } } }));
    const { updateWorkspace } = require('../src/configEditor.js');
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
  const { getReleaseNotes } = require('../src/releaseNotes.js');
  const notes = getReleaseNotes();
  assert.ok(notes.version);
  assert.ok(Array.isArray(notes.bullets));
}

{
  const { staleCommandKeys } = require('../src/commandDiscovery.js');
  assert.deepEqual(staleCommandKeys({ test: 'npm run gone', build: 'npm run build' }, { build: 'npm run build' }), ['test']);
}

console.log('Patch configuration normalization tests passed.');
