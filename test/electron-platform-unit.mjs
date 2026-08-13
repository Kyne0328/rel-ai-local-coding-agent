import assert from 'node:assert/strict';
import { electronPlatformSpec, normalizeElectronArch, normalizeElectronPlatform } from '../scripts/electron-platform.mjs';

assert.equal(normalizeElectronPlatform('windows'), 'win32');
assert.equal(normalizeElectronPlatform('WIN32'), 'win32');
assert.equal(normalizeElectronPlatform('linux'), 'linux');
assert.equal(normalizeElectronPlatform('darwin'), 'darwin');
assert.equal(normalizeElectronPlatform('macOS'), 'darwin');
assert.equal(normalizeElectronArch('amd64'), 'x64');
assert.equal(normalizeElectronArch('arm64'), 'arm64');
assert.throws(() => normalizeElectronPlatform('freebsd'), /Unsupported Electron target platform/);
assert.throws(() => normalizeElectronArch('ia32'), /Unsupported Electron target architecture/);

assert.deepEqual(electronPlatformSpec('win32'), {
  platform: 'win32',
  builderFlag: '--win',
  unpackedDirectory: 'win-unpacked',
  executableName: 'Rel.AI MCP.exe',
  resourcesDirectory: 'resources',
  tunnelClientDirectory: 'win32',
  tunnelClientFile: 'tunnel-client.exe',
  markerName: 'current-unpacked.json'
});
assert.deepEqual(electronPlatformSpec('linux'), {
  platform: 'linux',
  builderFlag: '--linux',
  unpackedDirectory: 'linux-unpacked',
  executableName: 'rel-ai-mcp',
  resourcesDirectory: 'resources',
  tunnelClientDirectory: 'linux',
  tunnelClientFile: 'tunnel-client',
  markerName: 'current-unpacked-linux.json'
});
assert.deepEqual(electronPlatformSpec('darwin', 'x64'), {
  platform: 'darwin',
  builderFlag: '--mac',
  unpackedDirectory: 'mac',
  executableName: 'Rel.AI MCP.app/Contents/MacOS/Rel.AI MCP',
  resourcesDirectory: 'Rel.AI MCP.app/Contents/Resources',
  tunnelClientDirectory: 'darwin',
  tunnelClientFile: 'tunnel-client',
  markerName: 'current-unpacked-mac-x64.json'
});
assert.equal(electronPlatformSpec('darwin', 'arm64').unpackedDirectory, 'mac-arm64');
assert.equal(electronPlatformSpec('darwin', 'arm64').markerName, 'current-unpacked-mac-arm64.json');

console.log('Electron platform contract tests passed.');
