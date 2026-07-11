function registerIpcHandlers(deps) {
  const {
    ipcMain, BrowserWindow, clipboard, shell, saveLauncherConfig,
    getWizardWindow, closeWizard, getStatusWindow, createStatusWindow,
    startServer, stopServer, openSettingsWindow, openDashboardWindow,
    getNotificationsEnabled, setNotificationsEnabled, fitWindowToContent
  } = deps;

  ipcMain.handle('wizard:save-config', (_event, config) => {
    saveLauncherConfig(config);
    return { ok: true };
  });

  ipcMain.handle('wizard:done', async (_event, config) => {
    saveLauncherConfig(config);
    if (config?.restart === true) stopServer({ silent: true });
    closeWizard();
    const win = createStatusWindow();
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => startServer());
    else startServer();
    return { ok: true };
  });
  ipcMain.handle('wizard:cancel', () => { closeWizard(); return { ok: true }; });

  ipcMain.handle('wizard:open-settings', () => { openSettingsWindow(); return { ok: true }; });
  ipcMain.handle('server:start', async () => startServer());
  ipcMain.handle('server:stop', () => stopServer());
  ipcMain.handle('url:copy', (_event, url) => { clipboard.writeText(String(url || '')); return { ok: true }; });
  ipcMain.handle('url:open-dashboard', async () => openDashboardWindow());
  ipcMain.handle('notifications:get-enabled', () => ({ ok: true, enabled: getNotificationsEnabled() }));
  ipcMain.handle('notifications:set-enabled', (_event, enabled) => ({ ok: true, enabled: setNotificationsEnabled(enabled) }));
  ipcMain.handle('url:open-link', (_event, url) => {
    const target = String(url || '').trim();
    const allowed = target.startsWith('https://dashboard.ngrok.com/') || target.startsWith('https://ngrok.com/');
    if (!allowed) throw new Error('Only ngrok setup links can be opened from the setup wizard.');
    shell.openExternal(target);
    return { ok: true };
  });
  ipcMain.on('window:fit-content', (event, payload = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const wizardWindow = getWizardWindow();
    const statusWindow = getStatusWindow();
    const isWizard = win === wizardWindow;
    const isStatus = win === statusWindow;
    if (!isWizard && !isStatus) return;
    fitWindowToContent(win, {
      type: isWizard ? 'wizard' : 'status',
      width: Number(payload.width),
      height: Number(payload.height)
    });
  });
}

module.exports = { registerIpcHandlers };
