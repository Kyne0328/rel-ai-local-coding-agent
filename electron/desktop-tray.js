

function createDesktopTray(deps) {
  const {
    Tray, Menu, nativeImage, clipboard, iconPath, getStatus,
    openDashboard, focusPrimaryWindow, openDiagnostics, openSettings,
    startServer, stopServer, getUpdateStatus = () => null,
    checkForUpdates, downloadUpdate, installUpdate,
    quit, onError = () => {}
  } = deps;
  let tray = null;
  let menuKey = '';

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
    if (!tray) return false;
    const status = getStatus();
    const updateStatus = getUpdateStatus() || {};
    const nextMenuKey = menuSignature(status, updateStatus);
    if (nextMenuKey === menuKey) return false;
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
      updateMenuItem(updateStatus),
      { label: 'Troubleshooting', click: () => void openDiagnostics().catch(onError) },
      { label: 'Settings', click: () => void openSettings().catch(onError) },
      { type: 'separator' },
      { label: 'Quit Rel.AI MCP', click: quit }
    ]);
    tray.setContextMenu(menu);
    menuKey = nextMenuKey;
    return true;
  }

  function updateMenuItem(status = {}) {
    const version = status.availableVersion ? ` v${status.availableVersion}` : '';
    if (status.state === 'checking') return { label: 'Checking for updates…', enabled: false };
    if (status.state === 'downloading') return { label: `Downloading update… ${Math.round(status.progress?.percent || 0)}%`, enabled: false };
    if (status.state === 'installing') return { label: 'Installing update…', enabled: false };
    if (status.state === 'downloaded') return { label: `Restart to install${version}`, click: () => runUpdateAction(installUpdate) };
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

  return { setup, update };
}

function menuSignature(status = {}, updateStatus = {}) {
  return JSON.stringify([
    status.serverRunning === true,
    String(status.tunnelStatus || 'stopped'),
    String(status.localMcpUrl || ''),
    String(updateStatus.state || ''),
    String(updateStatus.availableVersion || ''),
    Math.round(Number(updateStatus.progress?.percent || 0))
  ]);
}

export { createDesktopTray };
