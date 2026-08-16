import assert from 'node:assert/strict';

import { createRecoveryWindowManager } from "../electron/recovery-window.js";

const windows = [];
class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.focused = false;
    this.events = new Map();
    this.webEvents = new Map();
    this.sessionEvents = new Map();
    this.sent = [];
    this.permissionRequestHandler = null;
    this.permissionCheckHandler = null;
    this.windowOpenHandler = null;
    this.webContents = {
      session: {
        setPermissionRequestHandler: handler => { this.permissionRequestHandler = handler; },
        setPermissionCheckHandler: handler => { this.permissionCheckHandler = handler; },
        on: (name, callback) => this.sessionEvents.set(name, callback)
      },
      on: (name, callback) => this.webEvents.set(name, callback),
      setWindowOpenHandler: handler => { this.windowOpenHandler = handler; },
      send: (channel, payload) => this.sent.push({ channel, payload })
    };
    windows.push(this);
  }

  loadURL(url) { this.loadedUrl = url; }
  on(name, callback) { this.events.set(name, callback); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() { this.focused = true; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  destroy() {
    this.destroyed = true;
    this.events.get('closed')?.();
  }
}

let quitting = false;
let readyCalls = 0;
const securityErrors = [];
const manager = createRecoveryWindowManager({
  BrowserWindow: FakeWindow,
  preloadPath: 'preload.cjs',
  rendererUrl: 'relai-app://renderer/status.html',  limits: { minWidth: 480, minHeight: 420 },
  isQuitting: () => quitting,
  onReady: () => { readyCalls += 1; },
  onSecurityError: error => securityErrors.push(error.message)
});

const first = manager.show();
assert.equal(windows.length, 1);
assert.equal(first.loadedUrl, 'relai-app://renderer/status.html');
assert.equal(first.options.title, 'Rel.AI MCP Recovery');
assert.equal(first.options.webPreferences.sandbox, true);
assert.equal(first.options.webPreferences.webSecurity, true);
assert.equal(first.options.webPreferences.contextIsolation, true);
assert.equal(first.options.webPreferences.nodeIntegration, false);
assert.equal(first.options.webPreferences.partition, 'relai-recovery');
assert.deepEqual(first.options.webPreferences.additionalArguments, ['--relai-preload-surface=application']);
assert.match(first.options.backgroundColor, /^#[0-9a-f]{6}$/i, 'recovery window must provide an opaque fallback background while its UI loads');
assert.equal(first.visible, true);
assert.equal(first.focused, true);
first.webEvents.get('did-finish-load')?.();
assert.equal(readyCalls, 1);

let permissionGranted = true;
first.permissionRequestHandler(null, 'camera', allowed => { permissionGranted = allowed; });
assert.equal(permissionGranted, false);
assert.equal(first.permissionCheckHandler(), false);
let prevented = false;
first.sessionEvents.get('will-download')?.({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
prevented = false;
first.webEvents.get('will-attach-webview')?.({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
assert.deepEqual(first.windowOpenHandler({ url: 'https://example.com/' }), { action: 'deny' });
prevented = false;
first.webEvents.get('will-navigate')?.({ preventDefault: () => { prevented = true; } }, 'https://example.com/');
assert.equal(prevented, true);
assert.deepEqual(securityErrors, ['Blocked navigation outside the local Electron renderer.']);

manager.sendStatus({ serverRunning: false });
manager.sendLog('port in use');
assert.deepEqual(first.sent, [
  { channel: 'server:status', payload: { serverRunning: false } },
  { channel: 'server:log', payload: 'port in use' }
]);

prevented = false;
first.events.get('close')?.({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, true);
assert.equal(first.visible, false, 'routine close must hide the fallback while the tray app stays alive');
const sentBeforeHiddenStatus = first.sent.length;
manager.sendStatus({ serverRunning: true, taskActivity: { state: 'working', activeCalls: 2 } });
manager.sendLog('hidden log one');
manager.sendLog('hidden log two');
assert.equal(first.sent.length, sentBeforeHiddenStatus, 'hidden recovery windows must not receive high-frequency status or log IPC');
assert.equal(manager.show(), first, 'show must reuse the same fallback window');
assert.equal(first.sent.length, sentBeforeHiddenStatus + 3, 'reopening recovery must receive the latest status and logs accumulated while hidden');
assert.deepEqual(first.sent.slice(-3), [
  {
    channel: 'server:status',
    payload: { serverRunning: true, taskActivity: { state: 'working', activeCalls: 2 } }
  },
  { channel: 'server:log', payload: 'hidden log one' },
  { channel: 'server:log', payload: 'hidden log two' }
]);
assert.equal(windows.length, 1);

quitting = true;
prevented = false;
first.events.get('close')?.({ preventDefault: () => { prevented = true; } });
assert.equal(prevented, false, 'application shutdown must not block the window close');
manager.close();
assert.equal(first.destroyed, true);
assert.equal(manager.getWindow(), null);

console.log('Recovery-window manager unit tests passed.');
