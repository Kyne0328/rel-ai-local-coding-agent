import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCurrentUnpacked } from '../scripts/current-unpacked.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-current-unpacked-'));
try {
  testWindows(root);
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
  testLinux(root);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function testWindows(testRoot) {
  const dist = path.join(testRoot, 'dist');
  const versioned = path.join(dist, 'unpacked-builds', 'win32-build-1');
  createExecutable(versioned, 'Rel.AI MCP.exe');
  fs.writeFileSync(path.join(dist, 'current-unpacked.json'), `${JSON.stringify({
    schemaVersion: 2,
    platform: 'win32',
    relativePath: 'unpacked-builds/win32-build-1'
  }, null, 2)}\n`);
  assert.equal(resolveCurrentUnpacked(testRoot, { platform: 'win32' }), versioned);

  const recentBuildCheck = path.join(dist, 'build-check', 'win-unpacked');
  createExecutable(recentBuildCheck, 'Rel.AI MCP.exe');
  const oldTime = new Date(Date.now() - 60_000);
  fs.utimesSync(versioned, oldTime, oldTime);
  assert.equal(resolveCurrentUnpacked(testRoot, { platform: 'win32', allowBuildCheck: true }), recentBuildCheck);
  fs.rmSync(path.join(dist, 'build-check'), { recursive: true, force: true });

  fs.writeFileSync(path.join(dist, 'current-unpacked.json'), JSON.stringify({ platform: 'win32', relativePath: '../outside' }));
  assert.throws(() => resolveCurrentUnpacked(testRoot, { platform: 'win32' }), /escapes dist/);

  fs.rmSync(path.join(dist, 'current-unpacked.json'));
  const preferred = path.join(dist, 'win-unpacked');
  createExecutable(preferred, 'Rel.AI MCP.exe');
  assert.equal(resolveCurrentUnpacked(testRoot, { platform: 'win32' }), preferred);

  fs.rmSync(preferred, { recursive: true, force: true });
  const buildCheck = path.join(dist, 'build-check', 'win-unpacked');
  createExecutable(buildCheck, 'Rel.AI MCP.exe');
  assert.equal(resolveCurrentUnpacked(testRoot, { platform: 'win32', allowBuildCheck: true }), buildCheck);
  assert.throws(() => resolveCurrentUnpacked(testRoot, { platform: 'win32' }), /No current win32 unpacked application/);
}

function testLinux(testRoot) {
  const dist = path.join(testRoot, 'dist');
  const versioned = path.join(dist, 'unpacked-builds', 'linux-build-1');
  createExecutable(versioned, 'rel-ai-mcp');
  fs.writeFileSync(path.join(dist, 'current-unpacked-linux.json'), `${JSON.stringify({
    schemaVersion: 2,
    platform: 'linux',
    relativePath: 'unpacked-builds/linux-build-1'
  }, null, 2)}\n`);
  assert.equal(resolveCurrentUnpacked(testRoot, { platform: 'linux' }), versioned);
  assert.throws(() => resolveCurrentUnpacked(testRoot, { platform: 'win32' }), /No current win32 unpacked application/);

  fs.rmSync(path.join(dist, 'current-unpacked-linux.json'));
  const preferred = path.join(dist, 'linux-unpacked');
  createExecutable(preferred, 'rel-ai-mcp');
  assert.equal(resolveCurrentUnpacked(testRoot, { platform: 'linux' }), preferred);
}

function createExecutable(directory, name) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), 'binary', { mode: 0o755 });
}

console.log('Windows and Linux unpacked package resolution and containment tests passed.');
