import assert from 'node:assert/strict';
import { registerIpcHandlers } from '../electron/ipc-handlers.js';

const inventory = {
  'wizard:done': spec('handle', ['wizard'], 'reject'),
  'wizard:cancel': spec('handle', ['wizard'], 'reject'),
  'wizard:open-openai-setup': spec('handle', ['wizard'], 'reject'),
  'recovery:get-config': spec('handle', ['wizard'], 'reject'),
  'recovery:open-setup': spec('handle', ['fallback'], 'reject'),
  'url:open-dashboard': spec('handle', ['fallback'], 'reject'),
  'notifications:get-enabled': spec('handle', ['fallback'], 'reject'),
  'notifications:set-enabled': spec('handle', ['fallback'], 'reject'),
  'server:start': spec('handle', ['fallback'], 'reject'),
  'server:stop': spec('handle', ['fallback'], 'reject'),
  'recovery:restart-connection': spec('handle', ['fallback'], 'reject'),
  'recovery:relaunch': spec('handle', ['fallback'], 'reject'),
  'desktop:restart-connection': spec('handle', ['dashboard'], 'reject'),
  'desktop:relaunch': spec('handle', ['dashboard'], 'reject'),
  'desktop:quit': spec('handle', ['dashboard'], 'reject'),
  'desktop:get-status': spec('handle', ['dashboard'], 'reject'),
  'desktop:window:get-state': spec('handle', ['dashboard'], 'reject'),
  'desktop:window:minimize': spec('handle', ['dashboard'], 'reject'),
  'desktop:window:toggle-maximize': spec('handle', ['dashboard'], 'reject'),
  'desktop:window:close': spec('handle', ['dashboard'], 'reject'),
  'desktop:open-settings': spec('handle', ['dashboard'], 'reject'),
  'desktop:reload-dashboard': spec('handle', ['dashboard'], 'reject'),
  'desktop:analytics:local': spec('handle', ['dashboard'], 'reject'),
  'desktop:settings:get': spec('handle', ['dashboard'], 'reject'),
  'desktop:settings:save': spec('handle', ['dashboard'], 'reject'),
  'desktop:lifecycle:get': spec('handle', ['dashboard'], 'reject'),
  'desktop:startup:set': spec('handle', ['dashboard'], 'reject'),
  'desktop:keep-awake:set': spec('handle', ['dashboard'], 'reject'),
  'desktop:notifications:get': spec('handle', ['dashboard'], 'reject'),
  'desktop:notifications:set': spec('handle', ['dashboard'], 'reject'),
  'desktop:notification-preferences:get': spec('handle', ['dashboard'], 'reject'),
  'desktop:notification-preferences:set': spec('handle', ['dashboard'], 'reject'),
  'desktop:update:get': spec('handle', ['dashboard'], 'reject'),
  'desktop:update:check': spec('handle', ['dashboard'], 'reject'),
  'desktop:update:download': spec('handle', ['dashboard'], 'reject'),
  'desktop:update:install': spec('handle', ['dashboard'], 'reject'),
  'desktop:diagnostics:export': spec('handle', ['dashboard'], 'reject'),
  'desktop:diagnostics:open-folder': spec('handle', ['dashboard'], 'reject'),
  'url:copy': spec('handle', ['wizard', 'fallback', 'dashboard'], 'reject'),
  'desktop:stop-service': spec('on', ['dashboard'], 'ignore'),
  'window:fit-content': spec('on', ['wizard', 'fallback'], 'ignore')
};

const windows = { wizard: { id: 'wizard' }, fallback: { id: 'fallback' }, dashboard: { id: 'dashboard' }, other: { id: 'other' } };
const handles = new Map();
const listeners = new Map();
const calls = [];
const ipcMain = {
  handle(channel, handler) { assert.equal(handles.has(channel) || listeners.has(channel), false, `duplicate IPC registration: ${channel}`); handles.set(channel, handler); },
  on(channel, handler) { assert.equal(handles.has(channel) || listeners.has(channel), false, `duplicate IPC registration: ${channel}`); listeners.set(channel, handler); }
};

registerIpcHandlers({
  ipcMain,
  BrowserWindow: { fromWebContents: sender => sender?.window || null },
  clipboard: { writeText: value => calls.push(['clipboard', value]) },
  shell: { openExternal: async value => { calls.push(['openExternal', value]); } },
  getWizardWindow: () => windows.wizard,
  closeWizard: value => calls.push(['closeWizard', value]),
  getFallbackWindow: () => windows.fallback,
  getDashboardWindow: () => windows.dashboard,
  getRecoveryConfig: () => ({ ok: true, tunnelId: 'tunnel_12345678', tunnelApiKeyConfigured: true, port: 3333 }),
  setTunnelApiKey: value => calls.push(['tunnelKey', value]),
  saveLauncherConfig: value => calls.push(['save', value]),
  launchConfiguredDesktop: async value => { calls.push(['launch', value]); return { serverRunning: true, tunnelStatus: 'running' }; },
  restartConnection: async () => { calls.push(['restartConnection']); return { serverRunning: true, tunnelStatus: 'running' }; },
  relaunchApplication: async () => { calls.push(['relaunch']); return { ok: true }; },
  quitApplication: async () => { calls.push(['quit']); return { ok: true }; },
  openRecoverySetup: () => ({ ok: true }),
  openDashboardWindow: () => ({ ok: true }),
  getNotificationsEnabled: () => true,
  setNotificationsEnabled: value => value,
  startServer: () => ({ serverRunning: true }),
  stopServer: () => { calls.push(['stop']); return { serverRunning: false }; },
  getCurrentStatus: () => ({ serverRunning: true }),
  getDashboardWindowState: () => ({ maximized: false }),
  minimizeDashboardWindow: () => ({ minimized: true }),
  toggleDashboardMaximize: () => ({ maximized: true }),
  requestDashboardClose: () => ({ ok: true }),
  openSettingsWindow: () => ({ ok: true }),
  getLocalUsage: month => ({ ok: true, month, source: 'local' }),
  getDesktopSettings: () => ({ ok: true }),
  saveDesktopSettings: value => ({ ok: true, value }),
  getLifecycleStatus: () => ({ ok: true }),
  setLaunchAtLogin: value => value,
  setKeepAwake: value => value,
  getNotificationPreferences: () => ({ enabled: true }),
  updateNotificationPreferences: value => ({ ok: true, preferences: value }),
  getUpdateStatus: () => ({ state: 'idle' }),
  checkForUpdates: () => ({ ok: true }),
  downloadUpdate: () => ({ ok: true }),
  installUpdate: () => ({ ok: true }),
  exportDiagnosticState: value => ({ ok: true, value }),
  openDiagnosticsFolder: () => ({ ok: true }),
  fitWindowToContent: (window, value) => calls.push(['fit', window.id, value])
});

assert.deepEqual([...handles.keys()].sort(), Object.keys(inventory).filter(channel => inventory[channel].mode === 'handle').sort());
assert.deepEqual([...listeners.keys()].sort(), Object.keys(inventory).filter(channel => inventory[channel].mode === 'on').sort());

for (const [channel, expected] of Object.entries(inventory)) {
  const handler = expected.mode === 'handle' ? handles.get(channel) : listeners.get(channel);
  assert.equal(typeof handler, 'function', channel);
  if (expected.failure === 'reject') assert.throws(() => handler(eventFor(windows.other), ...argsFor(channel)), /not available to this renderer/, channel);
  else assert.doesNotThrow(() => handler(eventFor(windows.other), ...argsFor(channel)), channel);
  for (const windowName of expected.windows) {
    const result = handler(eventFor(windows[windowName]), ...argsFor(channel));
    if (result && typeof result.then === 'function') await result;
  }
}

assert.throws(() => handles.get('url:copy')(eventFor(windows.wizard), 'x'.repeat(64 * 1024 + 1)), /64 KiB/);
const done = await handles.get('wizard:done')(eventFor(windows.wizard), { tunnelId: 'tunnel_12345678', tunnelApiKey: 'runtime-api-key-value', port: 3333, restart: false });
assert.equal(done.ok, true);
assert.ok(calls.some(call => call[0] === 'tunnelKey' && call[1] === 'runtime-api-key-value'));
assert.ok(calls.some(call => call[0] === 'save' && call[1].tunnelId === 'tunnel_12345678'));
assert.equal([...handles.keys()].some(channel => /gateway|approval|cloud|open-link/i.test(channel)), false);
assert.ok(calls.some(call => call[0] === 'fit' && call[1] === 'wizard'));
assert.ok(calls.some(call => call[0] === 'fit' && call[1] === 'fallback'));

console.log(`${Object.keys(inventory).length} tunnel-only IPC channel contracts passed.`);

function spec(mode, windows, failure) { return { mode, windows, failure }; }
function eventFor(window) { return { sender: { window } }; }
function argsFor(channel) {
  switch (channel) {
    case 'wizard:done': return [{ tunnelId: 'tunnel_12345678', tunnelApiKey: 'runtime-api-key-value', port: 3333, restart: false }];
    case 'wizard:open-openai-setup': return ['tunnels'];
    case 'url:copy': return ['safe text'];
    case 'desktop:analytics:local': return ['2026-08'];
    case 'desktop:settings:save': return [{ port: 3333, tunnelId: 'tunnel_12345678' }];
    case 'desktop:reload-dashboard': return ['#tasks'];
    case 'desktop:startup:set':
    case 'desktop:keep-awake:set':
    case 'desktop:notifications:set':
    case 'desktop:notification-preferences:set':
    case 'notifications:set-enabled': return [true];
    case 'desktop:diagnostics:export': return [{ status: 'ready' }];
    case 'window:fit-content': return [{ width: 500, height: 600 }];
    default: return [];
  }
}
