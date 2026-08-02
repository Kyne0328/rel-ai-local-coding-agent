import assert from 'node:assert/strict';

import { MAX_CLIPBOARD_TEXT_BYTES, isAllowedNgrokUrl, registerIpcHandlers } from "../electron/ipc-handlers.js";
import { createWindowGuards } from "../electron/ipc-security.js";

const handles = new Map();
const listeners = new Map();
const wizard = { id: 'wizard' };
const fallback = { id: 'fallback' };
const dashboard = { id: 'dashboard' };
const other = { id: 'other' };
const calls = [];
let clipboardText = '';
let openedUrl = '';
let stopCalls = 0;
let restartCalls = 0;
let minimizeCalls = 0;
let maximizeCalls = 0;
let closeCalls = 0;

const deps = {
  ipcMain: {
    handle: (channel, handler) => handles.set(channel, handler),
    on: (channel, handler) => listeners.set(channel, handler)
  },
  BrowserWindow: { fromWebContents: sender => sender?.window || null },
  clipboard: { writeText: value => { clipboardText = value; } },
  shell: { openExternal: async value => { openedUrl = value; } },
  getWizardWindow: () => wizard,
  closeWizard: options => calls.push(['closeWizard', options]),
  getFallbackWindow: () => fallback,
  getDashboardWindow: () => dashboard,
  getRecoveryConfig: () => ({ ok: true }),
  openRecoverySetup: () => ({ ok: true }),
  startServer: () => ({ ok: true, started: true }),
  stopServer: () => { stopCalls += 1; return { ok: true }; },
  launchConfiguredDesktop: async options => { restartCalls += 1; calls.push(['launch', options]); return { serverRunning: true }; },
  openSettingsWindow: () => ({ ok: true }),
  openDashboardWindow: () => ({ ok: true }),
  getDesktopSettings: () => ({ ok: true }),
  saveDesktopSettings: settings => ({ ok: true, settings }),
  replaceApprovalToken: request => ({ ok: true, request }),
  getUpdateStatus: () => ({ state: 'idle' }),
  checkForUpdates: () => ({ ok: true }),
  downloadUpdate: () => ({ ok: true }),
  installUpdate: () => ({ ok: true }),
  getLifecycleStatus: () => ({ ok: true }),
  setLaunchAtLogin: enabled => enabled,
  getCurrentStatus: () => ({ serverRunning: true }),
  getDashboardWindowState: () => ({ platform: 'win32', customTitleBar: true, controls: 'custom', maximized: false }),
  minimizeDashboardWindow: () => { minimizeCalls += 1; return { platform: 'win32', customTitleBar: true, controls: 'custom', minimized: true }; },
  toggleDashboardMaximize: () => { maximizeCalls += 1; return { platform: 'win32', customTitleBar: true, controls: 'custom', maximized: true }; },
  requestDashboardClose: () => { closeCalls += 1; return { ok: true }; },
  getNotificationsEnabled: () => true,
  setNotificationsEnabled: enabled => enabled,
  exportDiagnosticState: report => ({ ok: true, report }),
  openDiagnosticsFolder: () => ({ ok: true }),
  fitWindowToContent: (window, options) => calls.push(['fit', window.id, options]),
  saveLauncherConfig: config => calls.push(['save', config])
};
registerIpcHandlers(deps);

const eventFor = window => ({ sender: { window } });
assert.equal(handles.has('wizard:save-config'), false);
assert.equal(MAX_CLIPBOARD_TEXT_BYTES, 65536);
assert.equal(isAllowedNgrokUrl('https://dashboard.ngrok.com/get-started/setup/windows'), true);
const guards = createWindowGuards(deps.BrowserWindow);
assert.equal(guards.windowOnly(eventFor(dashboard), () => dashboard, 'Dashboard', () => 'allowed'), 'allowed');
assert.throws(() => guards.windowOnly(eventFor(other), () => dashboard, 'Dashboard', () => 'denied'), /not available/);
for (const value of [
  'http://dashboard.ngrok.com/get-started',
  'https://dashboard.ngrok.com.evil.example/',
  'https://user:pass@dashboard.ngrok.com/',
  'https://ngrok.com/'
]) assert.equal(isAllowedNgrokUrl(value), false, value);

assert.throws(() => handles.get('desktop:settings:get')(eventFor(other)), /not available to this renderer/);
for (const channel of ['desktop:window:get-state', 'desktop:window:minimize', 'desktop:window:toggle-maximize', 'desktop:window:close']) {
  assert.throws(() => handles.get(channel)(eventFor(other)), /not available to this renderer/, channel);
}
assert.throws(() => handles.get('wizard:cancel')(eventFor(dashboard)), /not available to this renderer/);
assert.throws(() => handles.get('server:start')(eventFor(wizard)), /not available to this renderer/);
assert.throws(() => handles.get('url:copy')(eventFor(other), 'text'), /not available to this renderer/);
assert.throws(() => handles.get('url:copy')(eventFor(dashboard), 'x'.repeat(MAX_CLIPBOARD_TEXT_BYTES + 1)), /64 KiB/);
await assert.rejects(
  handles.get('url:open-link')(eventFor(wizard), 'https://dashboard.ngrok.com.evil.example/'),
  /approved ngrok/
);

assert.deepEqual(handles.get('desktop:settings:get')(eventFor(dashboard)), { ok: true });
assert.equal([...handles.keys()].some(channel => channel.startsWith('desktop:cloud:')), false);
assert.equal(handles.get('desktop:window:get-state')(eventFor(dashboard)).customTitleBar, true);
assert.equal(handles.get('desktop:window:minimize')(eventFor(dashboard)).minimized, true);
assert.equal(handles.get('desktop:window:toggle-maximize')(eventFor(dashboard)).maximized, true);
assert.deepEqual(handles.get('desktop:window:close')(eventFor(dashboard)), { ok: true });
assert.equal(minimizeCalls, 1);
assert.equal(maximizeCalls, 1);
assert.equal(closeCalls, 1);
assert.deepEqual(handles.get('server:start')(eventFor(fallback)), { ok: true, started: true });
assert.deepEqual(handles.get('notifications:get-enabled')(eventFor(fallback)), { ok: true, enabled: true });
assert.deepEqual(handles.get('url:copy')(eventFor(wizard), 'safe\u0000text'), { ok: true });
assert.equal(clipboardText, 'safetext');
await handles.get('url:open-link')(eventFor(wizard), 'https://dashboard.ngrok.com/get-started/setup/windows');
assert.equal(openedUrl, 'https://dashboard.ngrok.com/get-started/setup/windows');

await handles.get('wizard:done')(eventFor(wizard), { port: 3333, restart: false });
assert.ok(calls.some(entry => entry[0] === 'save'));
assert.ok(calls.some(entry => entry[0] === 'closeWizard'));
assert.ok(calls.some(entry => entry[0] === 'launch' && entry[1].firstRun === true));

listeners.get('desktop:restart-service')(eventFor(other));
listeners.get('desktop:stop-service')(eventFor(other));
await new Promise(resolve => setImmediate(resolve));
assert.equal(restartCalls, 1, 'only wizard completion should have launched so far');
assert.equal(stopCalls, 0);
listeners.get('desktop:restart-service')(eventFor(dashboard));
listeners.get('desktop:stop-service')(eventFor(dashboard));
await new Promise(resolve => setImmediate(resolve));
assert.equal(restartCalls, 2);
assert.equal(stopCalls, 1);

listeners.get('window:fit-content')(eventFor(dashboard), { width: 1, height: 1 });
listeners.get('window:fit-content')(eventFor(wizard), { width: 500, height: 600 });
assert.ok(calls.some(entry => entry[0] === 'fit' && entry[1] === 'wizard' && entry[2].type === 'wizard'));

console.log('IPC security unit tests passed.');
