function registerAnalyticsIpc({ ipcMain, dashboardOnly, getLocalUsage }) {
  ipcMain.handle('desktop:analytics:local', (event, month) => dashboardOnly(event, () => getLocalUsage(normalizeAnalyticsMonth(month))));
}

function registerDesktopSettingsIpc({
  ipcMain,
  dashboardOnly,
  getDesktopSettings,
  saveDesktopSettings,
  getLifecycleStatus,
  setLaunchAtLogin,
  getNotificationsEnabled,
  setNotificationsEnabled,
  getNotificationPreferences,
  updateNotificationPreferences
}) {
  ipcMain.handle('desktop:settings:get', event => dashboardOnly(event, getDesktopSettings));
  ipcMain.handle('desktop:settings:save', (event, settings) => dashboardOnly(event, () => saveDesktopSettings(settings)));
  ipcMain.handle('desktop:lifecycle:get', event => dashboardOnly(event, getLifecycleStatus));
  ipcMain.handle('desktop:startup:set', (event, enabled) => dashboardOnly(event, () => setLaunchAtLogin(enabled)));
  ipcMain.handle('desktop:notifications:get', event => dashboardOnly(event, () => ({ ok: true, enabled: getNotificationsEnabled() })));
  ipcMain.handle('desktop:notifications:set', (event, enabled) => dashboardOnly(event, () => ({ ok: true, enabled: setNotificationsEnabled(enabled) })));
  ipcMain.handle('desktop:notification-preferences:get', event => dashboardOnly(event, () => ({ ok: true, preferences: getNotificationPreferences() })));
  ipcMain.handle('desktop:notification-preferences:set', (event, patch) => dashboardOnly(event, () => updateNotificationPreferences(patch)));
}

function registerUpdaterIpc({ ipcMain, dashboardOnly, getUpdateStatus, checkForUpdates, downloadUpdate, installUpdate }) {
  ipcMain.handle('desktop:update:get', event => dashboardOnly(event, getUpdateStatus));
  ipcMain.handle('desktop:update:check', event => dashboardOnly(event, checkForUpdates));
  ipcMain.handle('desktop:update:download', event => dashboardOnly(event, downloadUpdate));
  ipcMain.handle('desktop:update:install', event => dashboardOnly(event, installUpdate));
}

function registerDiagnosticsIpc({ ipcMain, dashboardOnly, exportDiagnosticState, openDiagnosticsFolder }) {
  ipcMain.handle('desktop:diagnostics:export', (event, report) => dashboardOnly(event, () => exportDiagnosticState(report)));
  ipcMain.handle('desktop:diagnostics:open-folder', event => dashboardOnly(event, openDiagnosticsFolder));
}

function normalizeAnalyticsMonth(month) {
  const value = String(month || '').trim();
  if (value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('Analytics month must use YYYY-MM.');
  return value;
}

export { registerAnalyticsIpc, registerDesktopSettingsIpc, registerDiagnosticsIpc, registerUpdaterIpc };
