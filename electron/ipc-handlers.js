'use strict';

const {
  MAX_CLIPBOARD_TEXT_BYTES,
  createWindowGuards,
  isAllowedNgrokUrl,
  logIpcFailure
} = require('./ipc-security');

function registerIpcHandlers(deps) {
  const {
    ipcMain, BrowserWindow, clipboard, shell,
    getWizardWindow, closeWizard, getFallbackWindow, getDashboardWindow,
    getRecoveryConfig, openRecoverySetup, startServer, stopServer,
    launchConfiguredDesktop, openSettingsWindow, openDashboardWindow,
    getDesktopSettings, saveDesktopSettings, replaceApprovalToken,
    getUpdateStatus, checkForUpdates, downloadUpdate, installUpdate,
    getLifecycleStatus, setLaunchAtLogin,
    getCurrentStatus, getNotificationsEnabled, setNotificationsEnabled,
    exportDiagnosticState, openDiagnosticsFolder, fitWindowToContent,
    getSmokeWindowRole = () => ''
  } = deps;
  const { isSenderWindow, windowOnly, allowedWindows } = createWindowGuards(BrowserWindow, getSmokeWindowRole);

  ipcMain.handle('wizard:done', (event, config) => windowOnly(event, getWizardWindow, 'Setup completion', async () => {
    deps.saveLauncherConfig(config);
    closeWizard({ returnToFallback: false });
    await launchConfiguredDesktop({ restart: config?.restart === true, firstRun: config?.restart !== true });
    return { ok: true };
  }, 'wizard'));
  ipcMain.handle('wizard:cancel', event => windowOnly(event, getWizardWindow, 'Setup cancellation', () => {
    closeWizard({ returnToFallback: true });
    return { ok: true };
  }, 'wizard'));
  ipcMain.handle('recovery:get-config', event => windowOnly(event, getWizardWindow, 'Recovery configuration', getRecoveryConfig, 'wizard'));
  ipcMain.handle('recovery:open-setup', event => windowOnly(event, getFallbackWindow, 'Connection recovery', openRecoverySetup, 'fallback'));
  ipcMain.handle('server:start', event => windowOnly(event, getFallbackWindow, 'Service startup', startServer, 'fallback'));
  ipcMain.handle('server:stop', event => windowOnly(event, getFallbackWindow, 'Service shutdown', stopServer, 'fallback'));
  ipcMain.handle('url:copy', (event, value) => allowedWindows(event, [getWizardWindow, getFallbackWindow, getDashboardWindow], 'Clipboard access', () => {
    const text = String(value || '').replace(/\u0000/g, '');
    if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) throw new Error('Clipboard text exceeds the 64 KiB safety limit.');
    clipboard.writeText(text);
    return { ok: true };
  }, ['wizard', 'fallback', 'dashboard']));
  ipcMain.handle('url:open-dashboard', event => windowOnly(event, getFallbackWindow, 'Dashboard opening', openDashboardWindow, 'fallback'));
  ipcMain.handle('desktop:get-status', event => dashboardOnly(event, getCurrentStatus));
  ipcMain.handle('desktop:open-settings', event => dashboardOnly(event, openSettingsWindow));
  ipcMain.handle('desktop:settings:get', event => dashboardOnly(event, getDesktopSettings));
  ipcMain.handle('desktop:settings:save', (event, settings) => dashboardOnly(event, () => saveDesktopSettings(settings)));
  ipcMain.handle('desktop:approval-token:replace', (event, request) => dashboardOnly(event, () => replaceApprovalToken(request)));
  ipcMain.handle('desktop:update:get', event => dashboardOnly(event, getUpdateStatus));
  ipcMain.handle('desktop:update:check', event => dashboardOnly(event, checkForUpdates));
  ipcMain.handle('desktop:update:download', event => dashboardOnly(event, downloadUpdate));
  ipcMain.handle('desktop:update:install', event => dashboardOnly(event, installUpdate));
  ipcMain.handle('desktop:lifecycle:get', event => dashboardOnly(event, getLifecycleStatus));
  ipcMain.handle('desktop:startup:set', (event, enabled) => dashboardOnly(event, () => setLaunchAtLogin(enabled)));
  ipcMain.handle('desktop:notifications:get', event => dashboardOnly(event, () => ({ ok: true, enabled: getNotificationsEnabled() })));
  ipcMain.handle('desktop:notifications:set', (event, enabled) => dashboardOnly(event, () => ({ ok: true, enabled: setNotificationsEnabled(enabled) })));
  ipcMain.handle('desktop:diagnostics:export', (event, report) => dashboardOnly(event, () => exportDiagnosticState(report)));
  ipcMain.handle('desktop:diagnostics:open-folder', event => dashboardOnly(event, openDiagnosticsFolder));
  ipcMain.on('desktop:restart-service', event => {
    if (!isSenderWindow(event, getDashboardWindow, 'dashboard')) return;
    Promise.resolve(launchConfiguredDesktop({ restart: true })).catch(logIpcFailure);
  });
  ipcMain.on('desktop:stop-service', event => {
    if (!isSenderWindow(event, getDashboardWindow, 'dashboard')) return;
    setImmediate(() => {
      try { stopServer(); } catch (error) { logIpcFailure(error); }
    });
  });
  ipcMain.handle('notifications:get-enabled', event => windowOnly(event, getFallbackWindow, 'Notification preferences', () => ({ ok: true, enabled: getNotificationsEnabled() }), 'fallback'));
  ipcMain.handle('notifications:set-enabled', (event, enabled) => windowOnly(event, getFallbackWindow, 'Notification preferences', () => ({ ok: true, enabled: setNotificationsEnabled(enabled) }), 'fallback'));
  ipcMain.handle('url:open-link', (event, value) => windowOnly(event, getWizardWindow, 'External setup links', async () => {
    const target = String(value || '').trim();
    if (!isAllowedNgrokUrl(target)) throw new Error('Only approved ngrok setup links can be opened from the setup wizard.');
    await shell.openExternal(target);
    return { ok: true };
  }, 'wizard'));
  ipcMain.on('window:fit-content', (event, payload = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const isWizard = isSenderWindow(event, getWizardWindow, 'wizard');
    const isFallback = isSenderWindow(event, getFallbackWindow, 'fallback');
    if (!isWizard && !isFallback) return;
    fitWindowToContent(win, {
      type: isWizard ? 'wizard' : 'status',
      width: Number(payload.width),
      height: Number(payload.height)
    });
  });

  function dashboardOnly(event, action) {
    return windowOnly(event, getDashboardWindow, 'Secured dashboard controls', action, 'dashboard');
  }

}

module.exports = { MAX_CLIPBOARD_TEXT_BYTES, isAllowedNgrokUrl, registerIpcHandlers };
