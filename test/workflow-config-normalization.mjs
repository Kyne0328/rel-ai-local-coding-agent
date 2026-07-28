import { updateWorkspace } from "../src/configEditor.js";
import { getReleaseNotes } from "../src/releaseNotes.js";
import { staleCommandKeys } from "../src/commandDiscovery.js";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizePatchConfig, makeDefaultPatchConfig, normalizeConfig } from "../src/config.js";

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
      context: { snapshotMaxFiles: 44, includeRoots: ['src'] }
    }
  }
});
assert.deepEqual(strict.patch, { backup: true, requireCleanGit: false, maxUpdateBytes: 16384 });
for (const key of ['workflow', 'flow', 'cautionZone', 'maxIndexFiles']) assert.equal(Object.hasOwn(strict, key), false);
assert.equal(Object.hasOwn(strict.patch, 'maxPatchBytes'), false);
assert.equal(Object.hasOwn(strict.workspaces.repo, 'fastTask'), false);
assert.equal(strict.workspaces.repo.context.snapshotMaxFiles, 44);
assert.deepEqual(strict.workspaces.repo.context.includeRoots, ['src']);
assert.equal(strict.productUx.showAutomaticValidation, true);
assert.equal(normalizeConfig({ productUx: { showAutomaticValidation: false }, workspaces: {} }).productUx.showAutomaticValidation, false);
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
