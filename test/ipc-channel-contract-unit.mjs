import assert from 'node:assert/strict';
import { registerIpcHandlers } from '../electron/ipc-handlers.js';

const inventory = {
  'wizard:done': spec('handle', ['wizard'], 'reject', 'launcher-config'),
  'wizard:cancel': spec('handle', ['wizard'], 'reject', 'none'),
  'recovery:get-config': spec('handle', ['wizard'], 'reject', 'none'),
  'wizard:cloud-pair': spec('handle', ['wizard'], 'reject', 'none'),
  'wizard:cloud-status': spec('handle', ['wizard'], 'reject', 'none'),
  'wizard:cloud-cancel': spec('handle', ['wizard'], 'reject', 'none'),
  'wizard:cloud-recovery-get': spec('handle', ['wizard'], 'reject', 'explicit-secret-read'),
  'wizard:cloud-link-create': spec('handle', ['wizard'], 'reject', 'explicit-secret-read'),
  'wizard:cloud-recover': spec('handle', ['wizard'], 'reject', 'delegated'),
  'recovery:open-setup': spec('handle', ['fallback'], 'reject', 'none'),
  'server:start': spec('handle', ['fallback'], 'reject', 'none'),
  'server:stop': spec('handle', ['fallback'], 'reject', 'none'),
  'url:copy': spec('handle', ['wizard', 'fallback', 'dashboard'], 'reject', 'clipboard-64k'),
  'url:open-dashboard': spec('handle', ['fallback'], 'reject', 'none'),
  'desktop:get-status': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:window:get-state': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:window:minimize': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:window:toggle-maximize': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:window:close': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:open-settings': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:settings:get': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:settings:save': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:gateway:get': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:gateway:pair': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:gateway:pair-cancel': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:gateway:devices': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:gateway:device-revoke': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:gateway:mode-set': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:gateway:recovery-get': spec('handle', ['dashboard'], 'reject', 'explicit-secret-read'),
  'desktop:gateway:usage': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:analytics:local': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:approval-token:replace': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:update:get': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:update:check': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:update:download': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:update:install': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:lifecycle:get': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:startup:set': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:notifications:get': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:notifications:set': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:notification-preferences:get': spec('handle', ['dashboard'], 'reject', 'none'),
  'desktop:notification-preferences:set': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:diagnostics:export': spec('handle', ['dashboard'], 'reject', 'delegated'),
  'desktop:diagnostics:open-folder': spec('handle', ['dashboard'], 'reject', 'none'),
  'notifications:get-enabled': spec('handle', ['fallback'], 'reject', 'none'),
  'notifications:set-enabled': spec('handle', ['fallback'], 'reject', 'delegated'),
  'url:open-link': spec('handle', ['wizard'], 'reject', 'ngrok-https-only'),
  'desktop:restart-service': spec('on', ['dashboard'], 'ignore', 'none'),
  'desktop:stop-service': spec('on', ['dashboard'], 'ignore', 'none'),
  'window:fit-content': spec('on', ['wizard', 'fallback'], 'ignore', 'bounded-window-size')
};
const windows = { wizard: { id: 'wizard' }, fallback: { id: 'fallback' }, dashboard: { id: 'dashboard' }, other: { id: 'other' } };
const handles = new Map();
const listeners = new Map();
const calls = [];
const ipcMain = {
  handle(channel, handler) {
    assert.equal(handles.has(channel) || listeners.has(channel), false, `duplicate IPC registration: ${channel}`);
    handles.set(channel, handler);
  },
  on(channel, handler) {
    assert.equal(handles.has(channel) || listeners.has(channel), false, `duplicate IPC registration: ${channel}`);
    listeners.set(channel, handler);
  }
};
registerIpcHandlers({
  ipcMain,
  BrowserWindow: { fromWebContents: sender => sender?.window || null },
  clipboard: { writeText: value => calls.push(['clipboard', value]) },
  shell: { openExternal: async value => calls.push(['external', value]) },
  getWizardWindow: () => windows.wizard,
  getFallbackWindow: () => windows.fallback,
  getDashboardWindow: () => windows.dashboard,
  closeWizard: value => calls.push(['closeWizard', value]),
  getRecoveryConfig: () => ({ ok: true, source: 'recovery' }),
  startWizardCloudPairing: () => ({ ok: true, pairing: { code: 'AAAA-BBBB-CCCC' } }),
  getWizardCloudStatus: () => ({ ok: true, connectionMode: 'cloud', gateway: { state: 'pairing' } }),
  cancelWizardCloudPairing: () => ({ ok: true }),
  getWizardRecoveryCode: () => ({ ok: true, recoveryCode: 'relai-recovery-v1.prn_x.secret' }),
  createWizardDeviceLink: () => ({ ok: true, linkCode: 'relai-link-v1.prn_x.secret', expiresAt: 1234 }),
  recoverWizardCloudIdentity: value => ({ ok: true, value }),
  openRecoverySetup: () => ({ ok: true }),
  startServer: () => ({ ok: true, started: true }),
  stopServer: () => { calls.push(['stop']); return { ok: true }; },
  launchConfiguredDesktop: async value => { calls.push(['launch', value]); return { ok: true }; },
  openSettingsWindow: () => ({ ok: true }),
  openDashboardWindow: () => ({ ok: true }),
  getDesktopSettings: () => ({ ok: true }),
  saveDesktopSettings: value => ({ ok: true, value }),
  getGatewayStatus: () => ({ state: 'connected', deviceId: 'device-safe' }),
  beginGatewayPairing: value => ({ ok: true, value }),
  cancelGatewayPairing: () => ({ ok: true }),
  listGatewayDevices: () => ({ ok: true, devices: [] }),
  revokeGatewayDevice: value => ({ ok: true, value }),
  setGatewayMode: value => ({ ok: true, value }),
  getGatewayRecovery: () => ({ ok: true, recoveryCode: 'recovery-code' }),
  getGatewayUsage: value => ({ ok: true, month: value }),
  getLocalUsage: value => ({ ok: true, month: value, source: 'local' }),
  replaceApprovalToken: value => ({ ok: true, value }),
  getUpdateStatus: () => ({ state: 'idle' }),
  checkForUpdates: () => ({ ok: true }),
  downloadUpdate: () => ({ ok: true }),
  installUpdate: () => ({ ok: true }),
  getLifecycleStatus: () => ({ ok: true }),
  setLaunchAtLogin: value => value,
  getCurrentStatus: () => ({ ok: true }),
  getNotificationsEnabled: () => true,
  setNotificationsEnabled: value => value,
  getNotificationPreferences: () => ({ enabled: true, applicationUpdates: true }),
  updateNotificationPreferences: value => ({ ok: true, preferences: value }),
  getDashboardWindowState: () => ({ maximized: false }),
  minimizeDashboardWindow: () => ({ minimized: true }),
  toggleDashboardMaximize: () => ({ maximized: true }),
  requestDashboardClose: () => ({ ok: true }),
  exportDiagnosticState: value => ({ ok: true, value }),
  openDiagnosticsFolder: () => ({ ok: true }),
  fitWindowToContent: (window, value) => calls.push(['fit', window.id, value]),
  saveLauncherConfig: value => calls.push(['save', value])
});

assert.deepEqual([...handles.keys()].sort(), Object.keys(inventory).filter(channel => inventory[channel].mode === 'handle').sort());
assert.deepEqual([...listeners.keys()].sort(), Object.keys(inventory).filter(channel => inventory[channel].mode === 'on').sort());
for (const [channel, expected] of Object.entries(inventory)) {
  const handler = expected.mode === 'handle' ? handles.get(channel) : listeners.get(channel);
  assert.equal(typeof handler, 'function');
  if (expected.failure === 'reject') assert.throws(() => handler(eventFor(windows.other), ...argsFor(channel)), /not available to this renderer/);
  else assert.doesNotThrow(() => handler(eventFor(windows.other), ...argsFor(channel)));
  for (const windowName of expected.windows) {
    const result = handler(eventFor(windows[windowName]), ...argsFor(channel));
    if (result && typeof result.then === 'function') await result;
  }
}
assert.throws(() => handles.get('url:copy')(eventFor(windows.wizard), 'x'.repeat(64 * 1024 + 1)), /64 KiB/);
await assert.rejects(handles.get('url:open-link')(eventFor(windows.wizard), 'https://dashboard.ngrok.com.evil.example/'), /approved ngrok/);
assert.ok(calls.some(call => call[0] === 'fit' && call[1] === 'wizard' && call[2].type === 'wizard'));
assert.ok(calls.some(call => call[0] === 'fit' && call[1] === 'fallback' && call[2].type === 'status'));
console.log(`${Object.keys(inventory).length} IPC channel contracts passed with exact registration and sender policies.`);

function spec(mode, allowedWindows, failure, validation) { return { mode, windows: allowedWindows, failure, validation }; }
function eventFor(window) { return { sender: { window } }; }
function argsFor(channel) {
  switch (channel) {
    case 'wizard:done': return [{ port: 3333, restart: false }];
    case 'wizard:cloud-recover': return ['relai-recovery-v1.prn_example.recovery'];
    case 'url:copy': return ['safe text'];
    case 'desktop:settings:save': return [{ notifications: true }];
    case 'desktop:gateway:pair': return [{ action: 'begin' }];
    case 'desktop:gateway:device-revoke': return [{ deviceId: '11111111-1111-4111-8111-111111111111' }];
    case 'desktop:gateway:mode-set': return [{ mode: 'cloud' }];
    case 'desktop:gateway:usage':
    case 'desktop:analytics:local': return ['2026-08'];
    case 'desktop:approval-token:replace': return [{ reason: 'rotate' }];
    case 'desktop:startup:set':
    case 'desktop:notifications:set':
    case 'desktop:notification-preferences:set':
    case 'notifications:set-enabled': return [true];
    case 'desktop:diagnostics:export': return [{ status: 'ready' }];
    case 'url:open-link': return ['https://dashboard.ngrok.com/get-started/setup/windows'];
    case 'window:fit-content': return [{ width: 500, height: 600 }];
    default: return [];
  }
}
