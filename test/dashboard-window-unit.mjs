import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDashboardWindowManager, validateConnection, normalizeRouteHash } from "../electron/dashboard-window.js";
import { DASHBOARD_WINDOW_STATE_VERSION, defaultDashboardBounds, restoreDashboardBounds } from "../electron/dashboard-window-bounds.js";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-dashboard-window-'));
const folderToOpen = path.join(sandbox, 'repo');
fs.mkdirSync(folderToOpen);
const external = [];
const openedPaths = [];
const windows = [];
let permissionHandler = null;
let permissionCheck = null;
let openHandler = null;
let dashboardLoadError = null;
const webContentsEvents = new Map();
let dashboardAuthGeneration = 1;
let dashboardBootstrap = 'one-time-code';
const workArea = { x: 0, y: 0, width: 1366, height: 728 };
const fakeScreen = {
  getPrimaryDisplay: () => ({ workArea }),
  getDisplayMatching: () => ({ workArea })
};

const fakeSession = {
  setPermissionRequestHandler(listener) { permissionHandler = listener; },
  setPermissionCheckHandler(listener) { permissionCheck = listener; }
};

class FakeWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.maximized = false;
    this.minimized = false;
    this.fullScreen = false;
    this.events = new Map();
    this.loadCount = 0;
    this.executedScripts = [];
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.normalBounds = { ...this.bounds };
    this.webContents = {
      session: fakeSession,
      url: '',
      on(name, listener) { webContentsEvents.set(name, listener); },
      setWindowOpenHandler(listener) { openHandler = listener; },
      sent: [],
      getURL: () => this.webContents.url,
      reload: () => { this.reloaded = true; },
      executeJavaScript: async source => {
        this.executedScripts.push(source);
        const match = /location\.hash = (.+)$/.exec(source);
        if (match && this.webContents.url) {
          const target = new URL(this.webContents.url);
          target.hash = JSON.parse(match[1]);
          this.webContents.url = target.href;
        }
      },
      send: (channel, payload) => this.webContents.sent.push({ channel, payload })
    };
    windows.push(this);
  }
  async loadURL(url) {
    this.loadCount += 1;
    this.webContents.url = url;
    if (this.nextLoadError) {
      const error = this.nextLoadError;
      this.nextLoadError = null;
      throw error;
    }
  }
  once(name, listener) { this.events.set(name, listener); }
  on(name, listener) { this.events.set(name, listener); }
  show() { this.shown = true; this.hidden = false; }
  hide() { this.hidden = true; }
  showInactive() { this.shownInactive = true; }
  moveTop() { this.movedTop = true; }
  focus() { this.focused = true; }
  emit(name, ...args) { this.events.get(name)?.(...args); }
  getBounds() { return this.bounds; }
  getNormalBounds() { return this.normalBounds; }
  isMaximized() { return this.maximized; }
  isMinimized() { return this.minimized; }
  isFullScreen() { return this.fullScreen; }
  minimize() { this.minimized = true; this.emit('minimize'); }
  maximize() { this.maximized = true; this.minimized = false; this.emit('maximize'); }
  unmaximize() { this.maximized = false; this.emit('unmaximize'); }
  close() {
    let prevented = false;
    this.emit('close', { preventDefault() { prevented = true; } });
    if (!prevented) this.destroy();
  }
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
  screen: fakeScreen,
  platform: 'win32',
  isQuitting: () => false,
  onLoadError: error => { dashboardLoadError = error; },
  getConnection: async () => ({
    url: `http://127.0.0.1:3333/dashboard?surface=desktop&bootstrap=${dashboardBootstrap}`,
    authGeneration: dashboardAuthGeneration
  })
};

try {
  const manager = createDashboardWindowManager(dependencies);
  const win = await manager.open();
  assert.equal(windows.length, 1);
  assert.deepEqual(
    { x: win.options.x, y: win.options.y, width: win.options.width, height: win.options.height },
    defaultDashboardBounds(fakeScreen)
  );
  assert.ok(win.options.width < workArea.width * 0.9, 'default dashboard width must be visibly windowed');
  assert.ok(win.options.height < workArea.height * 0.9, 'default dashboard height must be visibly windowed');
  assert.equal(win.options.frame, false);
  assert.equal(win.options.thickFrame, true);
  assert.equal(win.options.titleBarStyle, 'hidden');
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.ok(win.options.webPreferences.preload.endsWith('preload.cjs'));
  assert.deepEqual(win.options.webPreferences.additionalArguments, ['--relai-preload-surface=dashboard']);
  assert.match(win.options.backgroundColor, /^#[0-9a-f]{6}$/i, 'dashboard window must provide an opaque fallback background while the UI loads');
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.notEqual(win.options.webPreferences.backgroundThrottling, false, 'hidden dashboards should use Electron background throttling');
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
  assert.deepEqual(openHandler({ url: 'https://github.com/Kyne0328' }), { action: 'deny' });
  assert.deepEqual(external, ['https://example.com/docs', 'https://example.com/help', 'https://github.com/Kyne0328']);
  webContentsEvents.get('did-fail-load')({}, -105, 'Connection refused', 'http://127.0.0.1:3333/dashboard', true);
  assert.match(dashboardLoadError?.message || '', /Dashboard failed to load/);

  assert.equal(await manager.pickFolder(), folderToOpen);
  assert.equal(await manager.openFolder(folderToOpen), path.resolve(folderToOpen));
  assert.deepEqual(openedPaths, [path.resolve(folderToOpen)]);
  const initialLoadCount = win.loadCount;
  win.webContents.url = 'http://127.0.0.1:3333/dashboard?surface=desktop#activity';
  const reopenedVisibleRoute = await manager.open();
  assert.equal(reopenedVisibleRoute, win);
  assert.equal(win.loadCount, initialLoadCount, 'reopening an existing dashboard must not reload its active route');
  assert.equal(win.webContents.url.endsWith('#activity'), true, 'reopening without a route must preserve the current route');
  const reused = await manager.open('#connection');
  assert.equal(reused, win);
  assert.equal(windows.length, 1);
  assert.equal(win.loadCount, initialLoadCount, 'same-document route changes must not reload the dashboard');
  assert.equal(win.webContents.url.endsWith('#connection'), true);
  assert.match(win.executedScripts.at(-1) || '', /location\.hash/);

  dashboardAuthGeneration += 1;
  dashboardBootstrap = 'post-restart-code';
  const beforeAuthRefresh = win.loadCount;
  const refreshedAfterRestart = await manager.open();
  assert.equal(refreshedAfterRestart, win);
  assert.equal(win.loadCount, beforeAuthRefresh + 1, 'a new local-service auth generation must reload the one-time dashboard bootstrap');
  assert.equal(new URL(win.webContents.url).searchParams.get('bootstrap'), 'post-restart-code');
  assert.equal(win.webContents.url.endsWith('#connection'), true, 'authenticated reload must preserve the active dashboard route');
  const afterAuthRefresh = win.loadCount;
  await manager.open();
  assert.equal(win.loadCount, afterAuthRefresh, 'reopening within the same auth generation must not reload the dashboard');

  assert.deepEqual(manager.getState(), {
    platform: 'win32', customTitleBar: true, controls: 'custom',
    maximized: false, minimized: false, fullScreen: false
  });
  assert.equal(manager.minimize().minimized, true);
  assert.equal(manager.toggleMaximize().maximized, true);
  assert.equal(manager.toggleMaximize().maximized, false);
  win.maximized = true;
  win.emit('maximize');
  assert.equal(win.webContents.sent.at(-1).channel, 'desktop:window-state');
  assert.equal(win.webContents.sent.at(-1).payload.maximized, true, 'native state changes must synchronize to the renderer');
  win.maximized = false;
  win.emit('unmaximize');
  assert.equal(win.webContents.sent.at(-1).payload.maximized, false);
  assert.deepEqual(manager.requestClose(), { ok: true });
  assert.equal(win.hidden, true, 'normal close must hide the dashboard to the tray');

  win.bounds = { x: 0, y: 0, width: workArea.width, height: workArea.height };
  win.normalBounds = { x: 90, y: 54, width: 1080, height: 640 };
  manager.close();
  assert.equal(manager.getWindow(), null);
  const saved = JSON.parse(fs.readFileSync(path.join(sandbox, 'dashboard-window-state.json'), 'utf8'));
  assert.deepEqual(saved, {
    version: DASHBOARD_WINDOW_STATE_VERSION,
    x: 90,
    y: 54,
    width: 1080,
    height: 640
  });

  const reopened = await manager.open();
  assert.equal(windows.length, 2);
  assert.equal(reopened.options.x, 90);
  assert.equal(reopened.options.y, 54);
  assert.equal(reopened.options.width, 1080);
  assert.equal(reopened.options.height, 640);
  manager.close();

  assert.deepEqual(
    restoreDashboardBounds({ x: 0, y: 0, width: 1240, height: 820 }, fakeScreen),
    defaultDashboardBounds(fakeScreen),
    'legacy unversioned near-fullscreen bounds must migrate to the smaller default'
  );

  assert.equal(validateConnection({ url: 'http://localhost:3333/dashboard' }).pathname, '/dashboard');
  assert.equal(normalizeRouteHash('connection'), '#connection');
  assert.throws(() => normalizeRouteHash('connection?token=secret'), /Invalid dashboard route/);
  assert.throws(() => validateConnection({ url: 'https://example.com/dashboard' }), /local loopback/);
  assert.throws(() => validateConnection({ url: 'http://127.0.0.1:3333/health' }), /local loopback/);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Dashboard window security and persistence tests passed.');
