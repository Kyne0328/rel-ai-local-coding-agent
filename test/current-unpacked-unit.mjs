import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCurrentUnpacked } from '../scripts/current-unpacked.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-current-unpacked-'));
try {
  const dist = path.join(root, 'dist');
  const versioned = path.join(dist, 'unpacked-builds', 'build-1');
  fs.mkdirSync(versioned, { recursive: true });
  fs.writeFileSync(path.join(versioned, 'Rel.AI MCP.exe'), 'binary');
  fs.writeFileSync(path.join(dist, 'current-unpacked.json'), `${JSON.stringify({
    schemaVersion: 1,
    relativePath: 'unpacked-builds/build-1'
  }, null, 2)}\n`);
  assert.equal(resolveCurrentUnpacked(root), versioned);

  fs.writeFileSync(path.join(dist, 'current-unpacked.json'), JSON.stringify({ relativePath: '../outside' }));
  assert.throws(() => resolveCurrentUnpacked(root), /escapes dist/);

  fs.rmSync(path.join(dist, 'current-unpacked.json'));
  const preferred = path.join(dist, 'win-unpacked');
  fs.mkdirSync(preferred, { recursive: true });
  assert.equal(resolveCurrentUnpacked(root), preferred);

  fs.rmSync(preferred, { recursive: true, force: true });
  const buildCheck = path.join(dist, 'build-check', 'win-unpacked');
  fs.mkdirSync(buildCheck, { recursive: true });
  assert.equal(resolveCurrentUnpacked(root, { allowBuildCheck: true }), buildCheck);
  assert.throws(() => resolveCurrentUnpacked(root), /No current unpacked application/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Current unpacked package resolution and containment tests passed.');
