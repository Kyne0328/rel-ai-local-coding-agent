import assert from 'node:assert/strict';

import { createDesktopTray } from '../electron/desktop-tray.js';

let status = { serverRunning: true, tunnelStatus: 'running', localMcpUrl: 'http://127.0.0.1:3333/mcp' };
let updateStatus = { state: 'downloading', availableVersion: '0.27.0', progress: { percent: 12.1 } };
let buildCount = 0;
let currentMenu = null;
let clipboardText = '';

class FakeTray {
  constructor() { this.menu = null; }
  setToolTip() {}
  on() {}
  setContextMenu(menu) { this.menu = menu; currentMenu = menu; }
}

const tray = createDesktopTray({
  Tray: FakeTray,
  Menu: {
    buildFromTemplate(template) {
      buildCount += 1;
      return template;
    }
  },
  nativeImage: {
    createFromPath() { return { isEmpty: () => true }; },
    createEmpty() { return {}; }
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
});

tray.setup();
assert.equal(buildCount, 1, 'tray setup builds the initial menu once');
updateStatus = { ...updateStatus, progress: { percent: 12.4 } };
assert.equal(tray.update(), false, 'sub-percent updater progress that renders identically must not rebuild the native menu');
assert.equal(buildCount, 1);

updateStatus = { ...updateStatus, progress: { percent: 12.6 } };
assert.equal(tray.update(), true, 'a visible updater percentage change must refresh the native menu');
assert.equal(buildCount, 2);
assert.ok(currentMenu.some(item => item.label === 'Downloading update… 13%'));

status = { ...status, localMcpUrl: 'http://127.0.0.1:4444/mcp' };
assert.equal(tray.update(), true, 'menu actions must refresh when their captured desktop state changes');
const copyItem = currentMenu.find(item => item.label === 'Copy local MCP address');
copyItem.click();
assert.equal(clipboardText, status.localMcpUrl);

console.log('Desktop tray avoids redundant native menu rebuilds while preserving visible state changes.');
