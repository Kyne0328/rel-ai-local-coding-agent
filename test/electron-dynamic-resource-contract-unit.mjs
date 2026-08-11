import assert from 'node:assert/strict';

const contracts = [
  ['../src/connectionProfile.js', {
    generateToken: 'function', readLaunchEnv: 'function', writeLaunchEnv: 'function',
    readConnectionProfile: 'function', writeConnectionProfile: 'function'
  }],
  ['../src/config.js', { ensureConfig: 'function', getConfigPath: 'function', readConfig: 'function' }],
  ['../src/toolActivity.js', { onToolActivity: 'function', getToolActivity: 'function', resetToolActivity: 'function' }],
  ['../src/http/dashboardSessions.js', { clearDashboardSessions: 'function', createDashboardBootstrap: 'function' }],
  ['../src/oauthProvider.js', { authorizationStatus: 'function', revokeAuthorizations: 'function' }],
  ['../src/durableState.js', { readJsonFile: 'function', writeJsonAtomic: 'function' }],
  ['../src/desktopUxContracts.js', { deriveConnectionState: 'function', ERROR_CODES: 'object' }],
  ['../src/diagnostics.js', { sanitizeDiagnosticValue: 'function' }],
  ['../src/httpServer.js', { startHttpServer: 'function' }],
  ['../src/process.js', { terminateProcessTree: 'function' }],
  ['../src/processManager.js', { stopAllManagedProcesses: 'function' }],
  ['../src/telemetry.js', { shutdownTelemetry: 'function' }]
];

for (const [specifier, expected] of contracts) {
  const module = await import(specifier);
  for (const [name, type] of Object.entries(expected)) {
    assert.equal(typeof module[name], type, `${specifier} must export ${name} for Electron importResourceModule consumers`);
  }
}

console.log('Electron dynamic resource-module export contracts passed.');
