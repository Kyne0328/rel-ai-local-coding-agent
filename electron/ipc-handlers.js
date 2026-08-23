import { MAX_CLIPBOARD_TEXT_BYTES, createWindowGuards, logIpcFailure } from './ipc-security.js';
import { registerAnalyticsIpc, registerDesktopSettingsIpc, registerDiagnosticsIpc, registerUpdaterIpc } from './ipc-handlers-dashboard.js';
import { registerCodeWorkspaceIpc } from './ipc-handlers-code.js';

const OPENAI_SETUP_URLS = Object.freeze({
  tunnels: 'https://platform.openai.com/settings/organization/tunnels',
  apiKeys: 'https://platform.openai.com/settings/organization/api-keys',
  supportProject: 'https://github.com/Kyne0328/rel-ai-mcp'
});

function registerIpcHandlers(deps) {
  const { isSenderWindow, windowOnly, allowedWindows } = createWindowGuards(deps.BrowserWindow);
  const dashboardOnly = (event, action) => windowOnly(event, deps.getDashboardWindow, 'Secured dashboard controls', action);

  registerSetupIpc({
    ipcMain: deps.ipcMain,
    shell: deps.shell,
    windowOnly,
    getWizardWindow: deps.getWizardWindow,
    closeWizard: deps.closeWizard,
    getRecoveryConfig: deps.getRecoveryConfig,
    setTunnelApiKey: deps.setTunnelApiKey,
    saveLauncherConfig: deps.saveLauncherConfig,
    launchConfiguredDesktop: deps.launchConfiguredDesktop
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
    restartConnection: deps.restartConnection,
    relaunchApplication: deps.relaunchApplication,
    quitApplication: deps.quitApplication
  });
  registerDashboardWindowIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    getCurrentStatus: deps.getCurrentStatus,
    getDashboardWindowState: deps.getDashboardWindowState,
    minimizeDashboardWindow: deps.minimizeDashboardWindow,
    toggleDashboardMaximize: deps.toggleDashboardMaximize,
    requestDashboardClose: deps.requestDashboardClose,
    openSettingsWindow: deps.openSettingsWindow,
    openDashboardWindow: deps.openDashboardWindow
  });
  registerAnalyticsIpc({ ipcMain: deps.ipcMain, dashboardOnly, getLocalUsage: deps.getLocalUsage });
  registerDesktopSettingsIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    getDesktopSettings: deps.getDesktopSettings,
    saveDesktopSettings: deps.saveDesktopSettings,
    getLifecycleStatus: deps.getLifecycleStatus,
    setLaunchAtLogin: deps.setLaunchAtLogin,
    setKeepAwake: deps.setKeepAwake,
    getNotificationsEnabled: deps.getNotificationsEnabled,
    setNotificationsEnabled: deps.setNotificationsEnabled,
    getNotificationPreferences: deps.getNotificationPreferences,
    updateNotificationPreferences: deps.updateNotificationPreferences
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
  registerCodeWorkspaceIpc({
    ipcMain: deps.ipcMain,
    dashboardOnly,
    getTaskCodeWorkspace: deps.getTaskCodeWorkspace,
    readTaskCodeDiff: deps.readTaskCodeDiff,
    listCodeEditors: deps.listCodeEditors,
    openTaskCodeIde: deps.openTaskCodeIde
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

function registerSetupIpc({ ipcMain, shell, windowOnly, getWizardWindow, closeWizard, getRecoveryConfig, setTunnelApiKey, saveLauncherConfig, launchConfiguredDesktop }) {
  ipcMain.handle('wizard:done', (event, config = {}) => windowOnly(event, getWizardWindow, 'Setup completion', async () => {
    const apiKey = String(config.tunnelApiKey || '').trim();
    if (apiKey) setTunnelApiKey(apiKey);
    saveLauncherConfig(config);
    closeWizard({ returnToFallback: false });
    const status = await launchConfiguredDesktop({ restart: config?.restart === true, firstRun: config?.restart !== true });
    return { ok: status?.serverRunning === true, status };
  }));
  ipcMain.handle('wizard:cancel', event => windowOnly(event, getWizardWindow, 'Setup cancellation', () => {
    closeWizard({ returnToFallback: true });
    return { ok: true };
  }));
  ipcMain.handle('wizard:open-openai-setup', (event, destination) => windowOnly(event, getWizardWindow, 'OpenAI setup navigation', async () => {
    const url = OPENAI_SETUP_URLS[String(destination || '')];
    if (!url) throw new Error('Unknown OpenAI setup destination.');
    await shell.openExternal(url);
    return { ok: true };
  }));
  ipcMain.handle('recovery:get-config', event => windowOnly(event, getWizardWindow, 'Recovery configuration', getRecoveryConfig));
}

function registerRecoveryIpc({ ipcMain, windowOnly, getFallbackWindow, openRecoverySetup, openDashboardWindow, getNotificationsEnabled, setNotificationsEnabled }) {
  ipcMain.handle('recovery:open-setup', event => windowOnly(event, getFallbackWindow, 'Connection recovery', openRecoverySetup));
  ipcMain.handle('url:open-dashboard', event => windowOnly(event, getFallbackWindow, 'Dashboard opening', openDashboardWindow));
  ipcMain.handle('notifications:get-enabled', event => windowOnly(event, getFallbackWindow, 'Notification preferences', () => ({ ok: true, enabled: getNotificationsEnabled() })));
  ipcMain.handle('notifications:set-enabled', (event, enabled) => windowOnly(event, getFallbackWindow, 'Notification preferences', () => ({ ok: true, enabled: setNotificationsEnabled(enabled) })));
}

function registerServiceIpc({ ipcMain, windowOnly, isSenderWindow, getFallbackWindow, getDashboardWindow, startServer, stopServer, restartConnection, relaunchApplication, quitApplication }) {
  ipcMain.handle('server:start', event => windowOnly(event, getFallbackWindow, 'Service startup', startServer));
  ipcMain.handle('server:stop', event => windowOnly(event, getFallbackWindow, 'Service shutdown', stopServer));
  ipcMain.handle('recovery:restart-connection', event => windowOnly(event, getFallbackWindow, 'Connection retry', restartConnection));
  ipcMain.handle('desktop:restart-connection', event => windowOnly(event, getDashboardWindow, 'Connection retry', restartConnection));
  ipcMain.handle('recovery:relaunch', event => windowOnly(event, getFallbackWindow, 'Application restart', relaunchApplication));
  ipcMain.handle('desktop:relaunch', event => windowOnly(event, getDashboardWindow, 'Application restart', relaunchApplication));
  ipcMain.handle('desktop:quit', event => windowOnly(event, getDashboardWindow, 'Application quit', quitApplication));
  ipcMain.on('desktop:stop-service', event => {
    if (!isSenderWindow(event, getDashboardWindow)) return;
    setImmediate(() => Promise.resolve(stopServer()).catch(logIpcFailure));
  });
}

function registerDashboardWindowIpc({ ipcMain, dashboardOnly, getCurrentStatus, getDashboardWindowState, minimizeDashboardWindow, toggleDashboardMaximize, requestDashboardClose, openSettingsWindow, openDashboardWindow }) {
  ipcMain.handle('desktop:get-status', event => dashboardOnly(event, getCurrentStatus));
  ipcMain.handle('desktop:window:get-state', event => dashboardOnly(event, getDashboardWindowState));
  ipcMain.handle('desktop:window:minimize', event => dashboardOnly(event, minimizeDashboardWindow));
  ipcMain.handle('desktop:window:toggle-maximize', event => dashboardOnly(event, toggleDashboardMaximize));
  ipcMain.handle('desktop:window:close', event => dashboardOnly(event, requestDashboardClose));
  ipcMain.handle('desktop:open-settings', event => dashboardOnly(event, openSettingsWindow));
  ipcMain.handle('desktop:reload-dashboard', (event, routeHash = '') => dashboardOnly(event, () => openDashboardWindow(routeHash, { forceReload: true })));
}

function registerSharedUtilityIpc({ ipcMain, BrowserWindow, clipboard, allowedWindows, isSenderWindow, getWizardWindow, getFallbackWindow, getDashboardWindow, fitWindowToContent }) {
  ipcMain.handle('url:copy', (event, value) => allowedWindows(event, [getWizardWindow, getFallbackWindow, getDashboardWindow], 'Clipboard access', () => {
    const text = String(value || '').split('\u0000').join('');
    if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) throw new Error('Clipboard text exceeds the 64 KiB safety limit.');
    clipboard.writeText(text);
    return { ok: true };
  }));
  ipcMain.on('window:fit-content', (event, payload = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const isWizard = isSenderWindow(event, getWizardWindow);
    const isFallback = isSenderWindow(event, getFallbackWindow);
    if (!isWizard && !isFallback) return;
    fitWindowToContent(win, { type: isWizard ? 'wizard' : 'status', width: Number(payload.width), height: Number(payload.height) });
  });
}

export { MAX_CLIPBOARD_TEXT_BYTES, registerIpcHandlers };
