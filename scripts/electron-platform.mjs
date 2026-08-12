const PLATFORM_SPECS = Object.freeze({
  win32: Object.freeze({
    platform: 'win32',
    builderFlag: '--win',
    unpackedDirectory: 'win-unpacked',
    executableName: 'Rel.AI MCP.exe',
    tunnelClientDirectory: 'win32',
    tunnelClientFile: 'tunnel-client.exe',
    markerName: 'current-unpacked.json'
  }),
  linux: Object.freeze({
    platform: 'linux',
    builderFlag: '--linux',
    unpackedDirectory: 'linux-unpacked',
    executableName: 'rel-ai-mcp',
    tunnelClientDirectory: 'linux',
    tunnelClientFile: 'tunnel-client',
    markerName: 'current-unpacked-linux.json'
  })
});
function normalizeElectronPlatform(value=process.platform){const normalized=String(value||'').trim().toLowerCase();if(['win','win32','windows'].includes(normalized))return'win32';if(normalized==='linux')return'linux';throw new Error(`Unsupported Electron target platform: ${normalized||'(empty)'}. Expected win32 or linux.`);}
function electronPlatformSpec(value=process.platform){return PLATFORM_SPECS[normalizeElectronPlatform(value)];}
export { electronPlatformSpec, normalizeElectronPlatform };
