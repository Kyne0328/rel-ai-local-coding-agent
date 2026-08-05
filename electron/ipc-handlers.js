import { MAX_CLIPBOARD_TEXT_BYTES, createWindowGuards, isAllowedNgrokUrl, logIpcFailure } from './ipc-security.js';

function registerIpcHandlers(deps) {
  const { isSenderWindow, windowOnly, allowedWindows } = createWindowGuards(deps.BrowserWindow);
  const dashboardOnly = (event, action) => windowOnly(
    event,
    deps.getDashboardWindow,
    'Secured dashboard controls',
    action
  );

  registerSetupIpc({
    ipcMain: deps.ipcMain,
    windowOnly,
    getWizardWindow: deps.getWizardWindow,
    closeWizard: deps.closeWizard,
    getRecoveryConfig: deps.getRecoveryConfig,
    saveLauncherConfig: deps.saveLauncherConfig,
    launchConfiguredDesktop: deps.launchConfiguredDesktop,
    shell: deps.shell
  });
  registerRecoveryIpc({
    ipcMain: deps.ipcMain,
    windowOnly,
    getFallbackWindow: deps.getFallbackWindow,
    openRecoverySetup: deps.openRecoverySetup,
    openDashboardWindow: deps.openDashboardWindow,
    getNotificationsEnabled: deps.getNotificationsEnabled,
    setNotificationsEnabled: deps.setNotificationsEnabled
  });
  registerServiceIpc({
    ipcMain: deps.ipcMain,
    windowOnly,
    isSenderWindow,
    getFallbackWindow: deps.getFallbackWindow,
    getDashboardWindow: deps.getDashboardWindow,
    startServer: deps.startServer,
    stopServer: deps.stopServer,
    launchConfiguredDesktop: deps.launchConfiguredDesktop
  });
  registerDashboardWindowIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    getCurrentStatus: deps.getCurrentStatus,
    getDashboardWindowState: deps.getDashboardWindowState,
    minimizeDashboardWindow: deps.minimizeDashboardWindow,
    toggleDashboardMaximize: deps.toggleDashboardMaximize,
    requestDashboardClose: deps.requestDashboardClose,
    openSettingsWindow: deps.openSettingsWindow
  });
  registerDesktopSettingsIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    getDesktopSettings: deps.getDesktopSettings,
    saveDesktopSettings: deps.saveDesktopSettings,
    replaceApprovalToken: deps.replaceApprovalToken,
    getLifecycleStatus: deps.getLifecycleStatus,
    setLaunchAtLogin: deps.setLaunchAtLogin,
    getNotificationsEnabled: deps.getNotificationsEnabled,
    setNotificationsEnabled: deps.setNotificationsEnabled
  });
  registerUpdaterIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    getUpdateStatus: deps.getUpdateStatus,
    checkForUpdates: deps.checkForUpdates,
    downloadUpdate: deps.downloadUpdate,
    installUpdate: deps.installUpdate
  });
  registerDiagnosticsIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    exportDiagnosticState: deps.exportDiagnosticState,
    openDiagnosticsFolder: deps.openDiagnosticsFolder
  });
  registerSharedUtilityIpc({
    ipcMain: deps.ipcMain,
    BrowserWindow: deps.BrowserWindow,
    clipboard: deps.clipboard,
    allowedWindows,
    isSenderWindow,
    getWizardWindow: deps.getWizardWindow,
    getFallbackWindow: deps.getFallbackWindow,
    getDashboardWindow: deps.getDashboardWindow,
    fitWindowToContent: deps.fitWindowToContent
  });
}

function registerSetupIpc({
  ipcMain,
  windowOnly,
  getWizardWindow,
  closeWizard,
  getRecoveryConfig,
  saveLauncherConfig,
  launchConfiguredDesktop,
  shell
}) {
  ipcMain.handle('wizard:done', (event, config) => windowOnly(event, getWizardWindow, 'Setup completion', async () => {
    saveLauncherConfig(config);
    closeWizard({ returnToFallback: false });
    await launchConfiguredDesktop({ restart: config?.restart === true, firstRun: config?.restart !== true });
    return { ok: true };
  }));
  ipcMain.handle('wizard:cancel', event => windowOnly(event, getWizardWindow, 'Setup cancellation', () => {
    closeWizard({ returnToFallback: true });
    return { ok: true };
  }));
  ipcMain.handle('recovery:get-config', event => windowOnly(event, getWizardWindow, 'Recovery configuration', getRecoveryConfig));
  ipcMain.handle('url:open-link', (event, value) => windowOnly(event, getWizardWindow, 'External setup links', async () => {
    const target = String(value || '').trim();
    if (!isAllowedNgrokUrl(target)) throw new Error('Only approved ngrok setup links can be opened from the setup wizard.');
    await shell.openExternal(target);
    return { ok: true };
  }));
}

function registerRecoveryIpc({
  ipcMain,
  windowOnly,
  getFallbackWindow,
  openRecoverySetup,
  openDashboardWindow,
  getNotificationsEnabled,
  setNotificationsEnabled
}) {
  ipcMain.handle('recovery:open-setup', event => windowOnly(event, getFallbackWindow, 'Connection recovery', openRecoverySetup));
  ipcMain.handle('url:open-dashboard', event => windowOnly(event, getFallbackWindow, 'Dashboard opening', openDashboardWindow));
  ipcMain.handle('notifications:get-enabled', event => windowOnly(
    event,
    getFallbackWindow,
    'Notification preferences',
    () => ({ ok: true, enabled: getNotificationsEnabled() })
  ));
  ipcMain.handle('notifications:set-enabled', (event, enabled) => windowOnly(
    event,
    getFallbackWindow,
    'Notification preferences',
    () => ({ ok: true, enabled: setNotificationsEnabled(enabled) })
  ));
}

function registerServiceIpc({
  ipcMain,
  windowOnly,
  isSenderWindow,
  getFallbackWindow,
  getDashboardWindow,
  startServer,
  stopServer,
  launchConfiguredDesktop
}) {
  ipcMain.handle('server:start', event => windowOnly(event, getFallbackWindow, 'Service startup', startServer));
  ipcMain.handle('server:stop', event => windowOnly(event, getFallbackWindow, 'Service shutdown', stopServer));
  ipcMain.on('desktop:restart-service', event => {
    if (!isSenderWindow(event, getDashboardWindow)) return;
    Promise.resolve(launchConfiguredDesktop({ restart: true })).catch(logIpcFailure);
  });
  ipcMain.on('desktop:stop-service', event => {
    if (!isSenderWindow(event, getDashboardWindow)) return;
    setImmediate(() => {
      Promise.resolve(stopServer()).catch(logIpcFailure);
    });
  });
}

function registerDashboardWindowIpc({
  ipcMain,
  dashboardOnly,
  getCurrentStatus,
  getDashboardWindowState,
  minimizeDashboardWindow,
  toggleDashboardMaximize,
  requestDashboardClose,
  openSettingsWindow
}) {
  ipcMain.handle('desktop:get-status', event => dashboardOnly(event, getCurrentStatus));
  ipcMain.handle('desktop:window:get-state', event => dashboardOnly(event, getDashboardWindowState));
  ipcMain.handle('desktop:window:minimize', event => dashboardOnly(event, minimizeDashboardWindow));
  ipcMain.handle('desktop:window:toggle-maximize', event => dashboardOnly(event, toggleDashboardMaximize));
  ipcMain.handle('desktop:window:close', event => dashboardOnly(event, requestDashboardClose));
  ipcMain.handle('desktop:open-settings', event => dashboardOnly(event, openSettingsWindow));
}

function registerDesktopSettingsIpc({
  ipcMain,
  dashboardOnly,
  getDesktopSettings,
  saveDesktopSettings,
  replaceApprovalToken,
  getLifecycleStatus,
  setLaunchAtLogin,
  getNotificationsEnabled,
  setNotificationsEnabled
}) {
  ipcMain.handle('desktop:settings:get', event => dashboardOnly(event, getDesktopSettings));
  ipcMain.handle('desktop:settings:save', (event, settings) => dashboardOnly(event, () => saveDesktopSettings(settings)));
  ipcMain.handle('desktop:approval-token:replace', (event, request) => dashboardOnly(event, () => replaceApprovalToken(request)));
  ipcMain.handle('desktop:lifecycle:get', event => dashboardOnly(event, getLifecycleStatus));
  ipcMain.handle('desktop:startup:set', (event, enabled) => dashboardOnly(event, () => setLaunchAtLogin(enabled)));
  ipcMain.handle('desktop:notifications:get', event => dashboardOnly(event, () => ({
    ok: true,
    enabled: getNotificationsEnabled()
  })));
  ipcMain.handle('desktop:notifications:set', (event, enabled) => dashboardOnly(event, () => ({
    ok: true,
    enabled: setNotificationsEnabled(enabled)
  })));
}

function registerUpdaterIpc({
  ipcMain,
  dashboardOnly,
  getUpdateStatus,
  checkForUpdates,
  downloadUpdate,
  installUpdate
}) {
  ipcMain.handle('desktop:update:get', event => dashboardOnly(event, getUpdateStatus));
  ipcMain.handle('desktop:update:check', event => dashboardOnly(event, checkForUpdates));
  ipcMain.handle('desktop:update:download', event => dashboardOnly(event, downloadUpdate));
  ipcMain.handle('desktop:update:install', event => dashboardOnly(event, installUpdate));
}

function registerDiagnosticsIpc({
  ipcMain,
  dashboardOnly,
  exportDiagnosticState,
  openDiagnosticsFolder
}) {
  ipcMain.handle('desktop:diagnostics:export', (event, report) => dashboardOnly(event, () => exportDiagnosticState(report)));
  ipcMain.handle('desktop:diagnostics:open-folder', event => dashboardOnly(event, openDiagnosticsFolder));
}

function registerSharedUtilityIpc({
  ipcMain,
  BrowserWindow,
  clipboard,
  allowedWindows,
  isSenderWindow,
  getWizardWindow,
  getFallbackWindow,
  getDashboardWindow,
  fitWindowToContent
}) {
  ipcMain.handle('url:copy', (event, value) => allowedWindows(
    event,
    [getWizardWindow, getFallbackWindow, getDashboardWindow],
    'Clipboard access',
    () => {
      const text = String(value || '').split('\u0000').join('');
      if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) {
        throw new Error('Clipboard text exceeds the 64 KiB safety limit.');
      }
      clipboard.writeText(text);
      return { ok: true };
    }
  ));
  ipcMain.on('window:fit-content', (event, payload = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const isWizard = isSenderWindow(event, getWizardWindow);
    const isFallback = isSenderWindow(event, getFallbackWindow);
    if (!isWizard && !isFallback) return;
    fitWindowToContent(win, {
      type: isWizard ? 'wizard' : 'status',
      width: Number(payload.width),
      height: Number(payload.height)
    });
  });
}

export { MAX_CLIPBOARD_TEXT_BYTES, isAllowedNgrokUrl, registerIpcHandlers };
