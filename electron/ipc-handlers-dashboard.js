function registerGatewayIpc({
  ipcMain,
  dashboardOnly,
  getGatewayStatus,
  beginGatewayEnrollment,
  beginGatewayPairing,
  openGatewayAccount,
  cancelGatewayPairing,
  listGatewayDevices,
  revokeGatewayDevice,
  setGatewayMode,
  getGatewayRecovery,
  getGatewayUsage,
  getLocalUsage
}) {
  ipcMain.handle('desktop:gateway:get', event => dashboardOnly(event, getGatewayStatus));
  ipcMain.handle('desktop:gateway:enroll', event => dashboardOnly(event, beginGatewayEnrollment));
  ipcMain.handle('desktop:gateway:pair', event => dashboardOnly(event, beginGatewayPairing));
  ipcMain.handle('desktop:gateway:account-open', event => dashboardOnly(event, openGatewayAccount));
  ipcMain.handle('desktop:gateway:pair-cancel', event => dashboardOnly(event, cancelGatewayPairing));
  ipcMain.handle('desktop:gateway:devices', event => dashboardOnly(event, listGatewayDevices));
  ipcMain.handle('desktop:gateway:device-revoke', (event, request = {}) => dashboardOnly(event, () => {
    const deviceId = String(request.deviceId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw new Error('A valid gateway device ID is required.');
    return revokeGatewayDevice(deviceId);
  }));
  ipcMain.handle('desktop:gateway:mode-set', (event, request = {}) => dashboardOnly(event, () => {
    const mode = String(request.mode || '').trim();
    if (!['cloud', 'direct'].includes(mode)) throw new Error('Gateway mode must be cloud or direct.');
    return setGatewayMode(mode);
  }));
  ipcMain.handle('desktop:gateway:recovery-get', event => dashboardOnly(event, getGatewayRecovery));
  ipcMain.handle('desktop:gateway:usage', (event, month) => dashboardOnly(event, () => getGatewayUsage(normalizeAnalyticsMonth(month))));
  ipcMain.handle('desktop:analytics:local', (event, month) => dashboardOnly(event, () => getLocalUsage(normalizeAnalyticsMonth(month))));
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
  setNotificationsEnabled,
  getNotificationPreferences,
  updateNotificationPreferences
}) {
  ipcMain.handle('desktop:settings:get', event => dashboardOnly(event, getDesktopSettings));
  ipcMain.handle('desktop:settings:save', (event, settings) => dashboardOnly(event, () => saveDesktopSettings(settings)));
  ipcMain.handle('desktop:approval-token:replace', (event, request) => dashboardOnly(event, () => replaceApprovalToken(request)));
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

export { registerDesktopSettingsIpc, registerDiagnosticsIpc, registerGatewayIpc, registerUpdaterIpc };
