import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDashboardWindowManager, validateConnection } = require('../electron/dashboard-window.js');

const external = [];
const windows = [];
let requestListener = null;
let permissionHandler = null;
let permissionCheck = null;
let openHandler = null;
const webContentsEvents = new Map();

const fakeSession = {
  webRequest: {
    onBeforeSendHeaders(_filter, listener) { requestListener = listener; }
  },
  setPermissionRequestHandler(listener) { permissionHandler = listener; },
  setPermissionCheckHandler(listener) { permissionCheck = listener; }
};

class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.events = new Map();
    this.webContents = {
      session: fakeSession,
      url: '',
      on(name, listener) { webContentsEvents.set(name, listener); },
      setWindowOpenHandler(listener) { openHandler = listener; },
      getURL: () => this.webContents.url
    };
    windows.push(this);
  }
  async loadURL(url) { this.webContents.url = url; }
  once(name, listener) { this.events.set(name, listener); }
  on(name, listener) { this.events.set(name, listener); }
  show() { this.shown = true; }
  showInactive() { this.shownInactive = true; }
  moveTop() { this.movedTop = true; }
  focus() { this.focused = true; }
  destroy() { this.destroyed = true; this.events.get('closed')?.(); }
  isDestroyed() { return this.destroyed; }
}

const manager = createDashboardWindowManager({
  BrowserWindow: FakeWindow,
  shell: { openExternal: url => external.push(url) },
  app: { focus() {} },
  dialog: { async showOpenDialog() { return { canceled: false, filePaths: ['C:/repo'] }; } },
  getConnection: async () => ({
    url: 'http://127.0.0.1:3333/dashboard?surface=desktop',
    token: 'secret-token'
  })
});

const win = await manager.open();
assert.equal(windows.length, 1);
assert.equal(win.options.webPreferences.nodeIntegration, false);
assert.equal(win.options.webPreferences.contextIsolation, true);
assert.equal(win.options.webPreferences.sandbox, true);
assert.equal(win.options.webPreferences.partition, 'relai-dashboard');
assert.equal(win.webContents.url, 'http://127.0.0.1:3333/dashboard?surface=desktop');
assert.equal(win.webContents.url.includes('secret-token'), false);
assert.equal(typeof requestListener, 'function');
assert.equal(typeof permissionHandler, 'function');
assert.equal(permissionCheck(), false);
let permissionAllowed = true;
permissionHandler(null, 'camera', value => { permissionAllowed = value; });
assert.equal(permissionAllowed, false);

let injectedHeaders = null;
requestListener({
  url: 'http://127.0.0.1:3333/api/dashboard/v10',
  requestHeaders: { Accept: 'application/json' }
}, result => { injectedHeaders = result.requestHeaders; });
assert.equal(injectedHeaders.Authorization, 'Bearer secret-token');
requestListener({
  url: 'http://localhost:4444/api/dashboard/v10',
  requestHeaders: {}
}, result => { injectedHeaders = result.requestHeaders; });
assert.equal(injectedHeaders.Authorization, undefined, 'credentials must not cross origins');

const navigation = webContentsEvents.get('will-navigate');
let prevented = false;
navigation({ preventDefault() { prevented = true; } }, 'https://example.com/docs');
assert.equal(prevented, true);
assert.deepEqual(external, ['https://example.com/docs']);
assert.deepEqual(openHandler({ url: 'https://example.com/help' }), { action: 'deny' });
assert.deepEqual(external, ['https://example.com/docs', 'https://example.com/help']);

assert.equal(await manager.pickFolder(), 'C:/repo');
const reused = await manager.open();
assert.equal(reused, win);
assert.equal(windows.length, 1);
manager.close();
assert.equal(manager.getWindow(), null);

assert.equal(validateConnection({ url: 'http://localhost:3333/dashboard' }).pathname, '/dashboard');
assert.throws(() => validateConnection({ url: 'https://example.com/dashboard' }), /local loopback/);
assert.throws(() => validateConnection({ url: 'http://127.0.0.1:3333/health' }), /local loopback/);

console.log('Dashboard window security tests passed.');
