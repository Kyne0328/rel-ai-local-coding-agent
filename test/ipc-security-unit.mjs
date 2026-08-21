import assert from 'node:assert/strict';
import { MAX_CLIPBOARD_TEXT_BYTES, registerIpcHandlers } from '../electron/ipc-handlers.js';
import { createWindowGuards } from '../electron/ipc-security.js';

const handles = new Map();
const listeners = new Map();
const wizard = { id: 'wizard' };
const fallback = { id: 'fallback' };
const dashboard = { id: 'dashboard' };
const other = { id: 'other' };
const calls = [];
let clipboardText = '';
let stopCalls = 0;
let restartCalls = 0;
let relaunchCalls = 0;
let quitCalls = 0;

const deps = {
  ipcMain: { handle: (channel, handler) => handles.set(channel, handler), on: (channel, handler) => listeners.set(channel, handler) },
  BrowserWindow: { fromWebContents: sender => sender?.window || null },
  clipboard: { writeText: value => { clipboardText = value; } },
  getWizardWindow: () => wizard,
  closeWizard: options => calls.push(['closeWizard', options]),
  getFallbackWindow: () => fallback,
  getDashboardWindow: () => dashboard,
  getRecoveryConfig: () => ({ ok: true }),
  openRecoverySetup: () => ({ ok: true }),
  startServer: () => ({ ok: true, started: true }),
  stopServer: () => { stopCalls += 1; return { ok: true }; },
  launchConfiguredDesktop: async options => { calls.push(['launch', options]); return { serverRunning: true }; },
  restartConnection: async () => { restartCalls += 1; return { serverRunning: true, tunnelStatus: 'running' }; },
  relaunchApplication: async () => { relaunchCalls += 1; return { ok: true }; },
  quitApplication: async () => { quitCalls += 1; return { ok: true }; },
  openSettingsWindow: () => ({ ok: true }),
  openDashboardWindow: () => ({ ok: true }),
  getDesktopSettings: () => ({ ok: true }),
  saveDesktopSettings: settings => ({ ok: true, settings }),
  getLocalUsage: month => ({ ok: true, month }),
  getUpdateStatus: () => ({ state: 'idle' }), checkForUpdates: () => ({ ok: true }), downloadUpdate: () => ({ ok: true }), installUpdate: () => ({ ok: true }),
  getLifecycleStatus: () => ({ ok: true }), setLaunchAtLogin: enabled => enabled,
  getCurrentStatus: () => ({ serverRunning: true }),
  getDashboardWindowState: () => ({ platform: 'win32', customTitleBar: true }),
  minimizeDashboardWindow: () => ({ minimized: true }), toggleDashboardMaximize: () => ({ maximized: true }), requestDashboardClose: () => ({ ok: true }),
  getNotificationsEnabled: () => true, setNotificationsEnabled: enabled => enabled,
  getNotificationPreferences: () => ({}), updateNotificationPreferences: patch => patch,
  exportDiagnosticState: report => ({ ok: true, report }), openDiagnosticsFolder: () => ({ ok: true }),
  getTaskCodeWorkspace: payload => ({ ok: true, payload }),
  readTaskCodeFile: payload => ({ ok: true, payload }),
  writeTaskCodeFile: payload => ({ ok: true, payload }),
  readTaskCodeDiff: payload => ({ ok: true, payload }),
  listCodeEditors: () => ({ ok: true, editors: [] }),
  openTaskCodeIde: payload => ({ ok: true, payload }),
  fitWindowToContent: (window, options) => calls.push(['fit', window.id, options]),
  saveLauncherConfig: config => calls.push(['save', config]),
  setTunnelApiKey: key => calls.push(['tunnelKey', key])
};
registerIpcHandlers(deps);
const eventFor = window => ({ sender: { window } });

assert.ok(Number.isSafeInteger(MAX_CLIPBOARD_TEXT_BYTES) && MAX_CLIPBOARD_TEXT_BYTES > 0, 'clipboard input must remain bounded');
const guards = createWindowGuards(deps.BrowserWindow);
assert.equal(guards.windowOnly(eventFor(dashboard), () => dashboard, 'Dashboard', () => 'allowed'), 'allowed');
assert.throws(() => guards.windowOnly(eventFor(other), () => dashboard, 'Dashboard', () => 'denied'), /not available/);
assert.equal([...handles.keys()].some(channel => channel.startsWith('desktop:cloud:')), false);
assert.equal([...handles.keys()].some(channel => /ngrok|gateway|approval/i.test(channel)), false);
assert.throws(() => handles.get('desktop:settings:get')(eventFor(other)), /not available/);
assert.throws(() => handles.get('desktop:code:get')(eventFor(other), { taskId: 'task-1' }), /not available/);
assert.deepEqual(handles.get('desktop:code:get')(eventFor(dashboard), { taskId: 'task-1' }), { ok: true, payload: { taskId: 'task-1' } });
assert.throws(() => handles.get('desktop:code:write')(eventFor(dashboard), { taskId: 'task-1', path: 'a.js', content: 'x'.repeat((2 * 1024 * 1024) + 1) }), /2 MiB/);
assert.throws(() => handles.get('desktop:code:open-ide')(eventFor(dashboard), { taskId: 'task-1', editorId: 'x'.repeat(41) }), /editorId is too long/);
assert.throws(() => handles.get('url:copy')(eventFor(dashboard), 'x'.repeat(MAX_CLIPBOARD_TEXT_BYTES + 1)));
assert.deepEqual(handles.get('url:copy')(eventFor(wizard), 'safe\u0000text'), { ok: true });
assert.equal(clipboardText, 'safetext');
await handles.get('wizard:done')(eventFor(wizard), { port: 3333, tunnelId: 'tunnel_example123456', tunnelApiKey: 'sk-runtime-example-123456', restart: false });
assert.ok(calls.some(entry => entry[0] === 'tunnelKey'));
assert.ok(calls.some(entry => entry[0] === 'save'));
assert.ok(calls.some(entry => entry[0] === 'launch' && entry[1].firstRun === true));
assert.throws(() => handles.get('desktop:restart-connection')(eventFor(other)), /not available/);
assert.throws(() => handles.get('recovery:restart-connection')(eventFor(other)), /not available/);
assert.throws(() => handles.get('desktop:relaunch')(eventFor(other)), /not available/);
assert.throws(() => handles.get('desktop:quit')(eventFor(other)), /not available/);
assert.equal(restartCalls, 0, 'wizard startup must stay separate from the tunnel-only retry operation');
assert.equal(relaunchCalls, 0);
assert.equal(quitCalls, 0);
await handles.get('desktop:restart-connection')(eventFor(dashboard));
await handles.get('recovery:restart-connection')(eventFor(fallback));
await handles.get('desktop:relaunch')(eventFor(dashboard));
await handles.get('desktop:quit')(eventFor(dashboard));
assert.equal(restartCalls, 2);
assert.equal(relaunchCalls, 1);
assert.equal(quitCalls, 1);
listeners.get('desktop:stop-service')(eventFor(other));
await new Promise(resolve => setImmediate(resolve));
assert.equal(stopCalls, 0);
listeners.get('desktop:stop-service')(eventFor(dashboard));
await new Promise(resolve => setImmediate(resolve));
assert.equal(stopCalls, 1);
console.log('IPC secure tunnel boundary tests passed.');
