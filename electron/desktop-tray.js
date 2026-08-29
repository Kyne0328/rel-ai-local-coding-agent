

function createDesktopTray(deps) {
  const {
    Tray, Menu, nativeImage, clipboard, iconPath, getStatus,
    openDashboard, focusPrimaryWindow, openDiagnostics, openSettings,
    startServer, stopServer, getUpdateStatus = () => null,
    checkForUpdates, downloadUpdate, installUpdate,
    quit, onError = () => {}
  } = deps;
  let tray = null;

  function setup() {
    if (tray) return tray;
    const raw = nativeImage.createFromPath(iconPath);
    if (raw.isEmpty()) {
      onError(new Error(`Tray icon could not be loaded: ${iconPath}`));
      return null;
    }
    const image = raw.resize({ width: 32, height: 32 });
    if (image.isEmpty()) {
      onError(new Error(`Tray icon could not be prepared: ${iconPath}`));
      return null;
    }
    try {
      tray = new Tray(image);
      tray.setToolTip('Rel.AI MCP');
      tray.on('double-click', focusPrimaryWindow);
      update();
      return tray;
    } catch (error) {
      tray?.destroy?.();
      tray = null;
      onError(error);
      return null;
    }
  }

  function update() {
    if (!tray) return false;
    const status = getStatus();
    const menu = Menu.buildFromTemplate([
      { label: status.serverRunning ? 'Rel.AI: running' : 'Rel.AI: stopped', enabled: false },
      { label: `Connection: ${status.tunnelStatus || 'stopped'}`, enabled: false },
      { type: 'separator' },
      { label: 'Open Dashboard', click: () => void openDashboard().catch(onError) },
      {
        label: 'Copy local MCP address',
        enabled: Boolean(status.localMcpUrl),
        click: () => { if (status.localMcpUrl) clipboard.writeText(status.localMcpUrl); }
      },
      {
        label: status.serverRunning ? 'Stop Rel.AI' : 'Start Rel.AI',
        click: () => status.serverRunning
          ? void Promise.resolve(stopServer()).catch(onError)
          : void startServer().catch(onError)
      },
      { type: 'separator' },
      updateMenuItem(),
      { label: 'Troubleshooting', click: () => void openDiagnostics().catch(onError) },
      { label: 'Settings', click: () => void openSettings().catch(onError) },
      { type: 'separator' },
      { label: 'Quit Rel.AI MCP', click: quit }
    ]);
    tray.setContextMenu(menu);
    return true;
  }

  function updateMenuItem() {
    const status = getUpdateStatus() || {};
    const version = status.availableVersion ? ` v${status.availableVersion}` : '';
    if (status.state === 'checking') return { label: 'Checking for updates…', enabled: false };
    if (status.state === 'downloading') return { label: `Downloading update… ${Math.round(status.progress?.percent || 0)}%`, enabled: false };
    if (status.state === 'installing') return { label: 'Installing update…', enabled: false };
    if (status.state === 'downloaded') {
      const label = status.installMode === 'open_dmg' ? `Open update DMG${version}` : `Restart to install${version}`;
      return { label, click: () => runUpdateAction(installUpdate) };
    }
    if (status.state === 'available') return { label: `Download update${version}`, click: () => runUpdateAction(downloadUpdate) };
    if (status.state === 'unsupported') return { label: 'Updates require the installed app', enabled: false };
    return { label: 'Check for updates', click: () => runUpdateAction(checkForUpdates) };
  }

  function runUpdateAction(action) {
    if (typeof action !== 'function') return;
    Promise.resolve(action()).then(result => {
      if (result?.ok === false) return openSettings().catch(onError);
      update();
    }).catch(onError);
  }

  return { setup, update, isAvailable: () => Boolean(tray) };
}

export { createDesktopTray };
