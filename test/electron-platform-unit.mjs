import assert from 'node:assert/strict';
import { electronPlatformSpec, normalizeElectronPlatform } from '../scripts/electron-platform.mjs';

assert.equal(normalizeElectronPlatform('windows'), 'win32');
assert.equal(normalizeElectronPlatform('WIN32'), 'win32');
assert.equal(normalizeElectronPlatform('linux'), 'linux');
assert.throws(() => normalizeElectronPlatform('darwin'), /Unsupported Electron target platform/);

assert.deepEqual(electronPlatformSpec('win32'), {
  platform: 'win32',
  builderFlag: '--win',
  unpackedDirectory: 'win-unpacked',
  executableName: 'Rel.AI MCP.exe',
  ngrokDirectory: 'win32',
  ngrokFile: 'ngrok.exe',
  markerName: 'current-unpacked.json'
});
assert.deepEqual(electronPlatformSpec('linux'), {
  platform: 'linux',
  builderFlag: '--linux',
  unpackedDirectory: 'linux-unpacked',
  executableName: 'rel-ai-mcp',
  ngrokDirectory: 'linux',
  ngrokFile: 'ngrok',
  markerName: 'current-unpacked-linux.json'
});

console.log('Electron platform contract tests passed.');
