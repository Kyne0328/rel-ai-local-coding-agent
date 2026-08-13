const BASE_PLATFORM_SPECS = Object.freeze({
  win32: Object.freeze({
    platform: 'win32',
    builderFlag: '--win',
    unpackedDirectory: 'win-unpacked',
    executableName: 'Rel.AI MCP.exe',
    resourcesDirectory: 'resources',
    tunnelClientDirectory: 'win32',
    tunnelClientFile: 'tunnel-client.exe',
    markerName: 'current-unpacked.json'
  }),
  linux: Object.freeze({
    platform: 'linux',
    builderFlag: '--linux',
    unpackedDirectory: 'linux-unpacked',
    executableName: 'rel-ai-mcp',
    resourcesDirectory: 'resources',
    tunnelClientDirectory: 'linux',
    tunnelClientFile: 'tunnel-client',
    markerName: 'current-unpacked-linux.json'
  })
});

function normalizeElectronPlatform(value = process.platform) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['win', 'win32', 'windows'].includes(normalized)) return 'win32';
  if (normalized === 'linux') return 'linux';
  if (['darwin', 'mac', 'macos'].includes(normalized)) return 'darwin';
  throw new Error(`Unsupported Electron target platform: ${normalized || '(empty)'}. Expected win32, linux, or darwin.`);
}

function normalizeElectronArch(value = process.env.REL_AI_TARGET_ARCH || process.arch) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['x64', 'amd64', 'x86_64'].includes(normalized)) return 'x64';
  if (['arm64', 'aarch64'].includes(normalized)) return 'arm64';
  throw new Error(`Unsupported Electron target architecture: ${normalized || '(empty)'}. Expected x64 or arm64.`);
}

function electronPlatformSpec(value = process.platform, architecture = process.env.REL_AI_TARGET_ARCH || process.arch) {
  const platform = normalizeElectronPlatform(value);
  if (platform !== 'darwin') return BASE_PLATFORM_SPECS[platform];
  const arch = normalizeElectronArch(architecture);
  return Object.freeze({
    platform: 'darwin',
    builderFlag: '--mac',
    unpackedDirectory: arch === 'arm64' ? 'mac-arm64' : 'mac',
    executableName: 'Rel.AI MCP.app/Contents/MacOS/Rel.AI MCP',
    resourcesDirectory: 'Rel.AI MCP.app/Contents/Resources',
    tunnelClientDirectory: 'darwin',
    tunnelClientFile: 'tunnel-client',
    markerName: `current-unpacked-mac-${arch}.json`
  });
}

export { electronPlatformSpec, normalizeElectronArch, normalizeElectronPlatform };
