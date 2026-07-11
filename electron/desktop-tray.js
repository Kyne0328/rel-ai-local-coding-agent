'use strict';

function createDesktopTray(deps) {
  const {
    Tray, Menu, nativeImage, clipboard, iconPath, getStatus,
    openDashboard, focusPrimaryWindow, showRecovery, openSettings,
    startServer, stopServer, quit, onError = () => {}
  } = deps;
  let tray = null;

  function setup() {
    if (tray) return tray;
    const raw = nativeImage.createFromPath(iconPath);
    const image = raw.isEmpty() ? raw : raw.resize({ width: 32, height: 32 });
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.setToolTip('Rel.AI MCP');
    tray.on('double-click', focusPrimaryWindow);
    update();
    return tray;
  }

  function update() {
    if (!tray) return;
    const status = getStatus();
    const menu = Menu.buildFromTemplate([
      { label: status.serverRunning ? 'Service: running' : 'Service: stopped', enabled: false },
      { label: `Tunnel: ${status.tunnelStatus || 'stopped'}`, enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => void openDashboard().catch(onError) },
      {
        label: 'Copy MCP endpoint',
        enabled: Boolean(status.mcpUrl),
        click: () => { if (status.mcpUrl) clipboard.writeText(status.mcpUrl); }
      },
      {
        label: status.serverRunning ? 'Stop Service' : 'Start Service',
        click: () => status.serverRunning ? stopServer() : void startServer().catch(onError)
      },
      { type: 'separator' },
      { label: 'Connection Recovery', click: showRecovery },
      { label: 'Settings', click: openSettings },
      { type: 'separator' },
      { label: 'Quit Rel.AI MCP', click: quit }
    ]);
    tray.setContextMenu(menu);
  }

  return { setup, update };
}

module.exports = { createDesktopTray };
