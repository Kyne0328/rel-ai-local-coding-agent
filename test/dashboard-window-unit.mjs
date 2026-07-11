import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDashboardWindowManager, validateConnection } = require('../electron/dashboard-window.js');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-window-'));
const folderToOpen = path.join(sandbox, 'repo');
fs.mkdirSync(folderToOpen);
const external = [];
const openedPaths = [];
const windows = [];
let permissionHandler = null;
let permissionCheck = null;
let openHandler = null;
const webContentsEvents = new Map();

const fakeSession = {
  setPermissionRequestHandler(listener) { permissionHandler = listener; },
  setPermissionCheckHandler(listener) { permissionCheck = listener; }
};

class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.events = new Map();
    this.bounds = { x: 18, y: 24, width: options.width, height: options.height };
    this.webContents = {
      session: fakeSession,
      url: '',
      on(name, listener) { webContentsEvents.set(name, listener); },
      setWindowOpenHandler(listener) { openHandler = listener; },
      getURL: () => this.webContents.url,
      reload: () => { this.reloaded = true; }
    };
    windows.push(this);
  }
  async loadURL(url) { this.webContents.url = url; }
  once(name, listener) { this.events.set(name, listener); }
  on(name, listener) { this.events.set(name, listener); }
  show() { this.shown = true; this.hidden = false; }
  hide() { this.hidden = true; }
  showInactive() { this.shownInactive = true; }
  moveTop() { this.movedTop = true; }
  focus() { this.focused = true; }
  getBounds() { return this.bounds; }
  destroy() { this.destroyed = true; this.events.get('closed')?.(); }
  isDestroyed() { return this.destroyed; }
}

const dependencies = {
  BrowserWindow: FakeWindow,
  shell: {
    openExternal: url => external.push(url),
    async openPath(target) { openedPaths.push(target); return ''; }
  },
  app: {
    getPath(name) { assert.equal(name, 'userData'); return sandbox; },
    focus() {}
  },
  dialog: { async showOpenDialog() { return { canceled: false, filePaths: [folderToOpen] }; } },
  isQuitting: () => false,
  getConnection: async () => ({
    url: 'http://127.0.0.1:3333/dashboard?surface=desktop&bootstrap=one-time-code'
  })
};

try {
  const manager = createDashboardWindowManager(dependencies);
  const win = await manager.open();
  assert.equal(windows.length, 1);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.ok(win.options.webPreferences.preload.endsWith('dashboard-preload.js'));
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.partition, 'relai-dashboard');
  assert.equal(win.webContents.url, 'http://127.0.0.1:3333/dashboard?surface=desktop&bootstrap=one-time-code');
  assert.equal(win.webContents.url.includes('secret-token'), false);
  assert.equal(typeof permissionHandler, 'function');
  assert.equal(permissionCheck(), false);
  let permissionAllowed = true;
  permissionHandler(null, 'camera', value => { permissionAllowed = value; });
  assert.equal(permissionAllowed, false);

  const navigation = webContentsEvents.get('will-navigate');
  let prevented = false;
  navigation({ preventDefault() { prevented = true; } }, 'https://example.com/docs');
  assert.equal(prevented, true);
  assert.deepEqual(external, ['https://example.com/docs']);
  assert.deepEqual(openHandler({ url: 'https://example.com/help' }), { action: 'deny' });
  assert.deepEqual(external, ['https://example.com/docs', 'https://example.com/help']);

  assert.equal(await manager.pickFolder(), folderToOpen);
  assert.equal(await manager.openFolder(folderToOpen), path.resolve(folderToOpen));
  assert.deepEqual(openedPaths, [path.resolve(folderToOpen)]);
  const reused = await manager.open();
  assert.equal(reused, win);
  assert.equal(windows.length, 1);
  let closePrevented = false;
  win.events.get('close')({ preventDefault() { closePrevented = true; } });
  assert.equal(closePrevented, true);
  assert.equal(win.hidden, true, 'normal close must hide the dashboard to the tray');

  manager.close();
  assert.equal(manager.getWindow(), null);
  const saved = JSON.parse(fs.readFileSync(path.join(sandbox, 'dashboard-window-state.json'), 'utf8'));
  assert.deepEqual(saved, { x: 18, y: 24, width: 1240, height: 820 });

  const reopened = await manager.open();
  assert.equal(windows.length, 2);
  assert.equal(reopened.options.x, 18);
  assert.equal(reopened.options.y, 24);
  manager.close();

  assert.equal(validateConnection({ url: 'http://localhost:3333/dashboard' }).pathname, '/dashboard');
  assert.throws(() => validateConnection({ url: 'https://example.com/dashboard' }), /local loopback/);
  assert.throws(() => validateConnection({ url: 'http://127.0.0.1:3333/health' }), /local loopback/);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Dashboard window security and persistence tests passed.');
