import assert from 'node:assert/strict';

import { createDesktopTray } from '../electron/desktop-tray.js';

let status = { serverRunning: true, tunnelStatus: 'running', localMcpUrl: 'http://127.0.0.1:3333/mcp' };
let updateStatus = { state: 'downloading', availableVersion: '0.27.0', progress: { percent: 12.1 } };
let buildCount = 0;
let currentMenu = null;
let clipboardText = '';
let trayConstructionCount = 0;
let trayEvents = [];

class FakeTray {
  constructor(image) { this.image = image; this.menu = null; trayConstructionCount += 1; }
  setToolTip() {}
  on(name) { trayEvents.push(name); }
  setContextMenu(menu) { this.menu = menu; currentMenu = menu; }
}

const dependencies = {
  Tray: FakeTray,
  Menu: {
    buildFromTemplate(template) {
      buildCount += 1;
      return template;
    }
  },
  nativeImage: {
    createFromPath() {
      return {
        isEmpty: () => false,
        resize(options) {
          assert.deepEqual(options, { width: 32, height: 32 });
          return this;
        }
      };
    }
  },
  clipboard: { writeText(value) { clipboardText = value; } },
  iconPath: 'icon.png',
  getStatus: () => status,
  getUpdateStatus: () => updateStatus,
  openDashboard: async () => {},
  focusPrimaryWindow() {},
  openDiagnostics: async () => {},
  openSettings: async () => {},
  startServer: async () => {},
  stopServer: async () => {},
  checkForUpdates: async () => ({ ok: true }),
  downloadUpdate: async () => ({ ok: true }),
  installUpdate: async () => ({ ok: true }),
  quit() {}
};

const tray = createDesktopTray(dependencies);
tray.setup();
assert.equal(buildCount, 1, 'tray setup builds the initial menu once');
assert.equal(tray.isAvailable(), true, 'successful tray construction must be observable by window close behavior');
assert.ok(trayEvents.includes('double-click'));
updateStatus = { ...updateStatus, progress: { percent: 12.4 } };
assert.equal(tray.update(), true, 'tray updates must rebuild the native context menu like the v0.25.1 implementation');
assert.equal(buildCount, 2);

updateStatus = { ...updateStatus, progress: { percent: 12.6 } };
assert.equal(tray.update(), true, 'a visible updater percentage change must refresh the native menu');
assert.equal(buildCount, 3);
assert.ok(currentMenu.some(item => item.label === 'Downloading update… 13%'));

status = { ...status, localMcpUrl: 'http://127.0.0.1:4444/mcp' };
assert.equal(tray.update(), true, 'menu actions must refresh when their captured desktop state changes');
const copyItem = currentMenu.find(item => item.label === 'Copy local MCP address');
copyItem.click();
assert.equal(clipboardText, status.localMcpUrl);

let trayIconError = null;
const constructionsBeforeMissingIcon = trayConstructionCount;
const missingIconTray = createDesktopTray({
  ...dependencies,
  nativeImage: { createFromPath() { return { isEmpty: () => true }; } },
  onError(error) { trayIconError = error; }
});
assert.equal(missingIconTray.setup(), null, 'an unreadable tray icon must not create an invisible tray item');
assert.equal(trayConstructionCount, constructionsBeforeMissingIcon, 'an unreadable tray icon must not construct a native tray');
assert.match(trayIconError?.message || '', /Tray icon could not be loaded/);
assert.equal(missingIconTray.isAvailable(), false);

trayEvents = [];
const linuxTray = createDesktopTray(dependencies);
linuxTray.setup();
assert.ok(trayEvents.includes('double-click'), 'Linux tray activation must preserve the v0.25.1 double-click behavior');
assert.equal(trayEvents.includes('click'), false, 'Linux tray activation must not substitute a platform-specific click handler');

console.log('Desktop tray preserves v0.25.1 activation/menu behavior with current icon safety.');
