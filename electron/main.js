import { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, powerSaveBlocker, Notification, dialog, screen, protocol, safeStorage, systemPreferences } from 'electron';
import electronUpdater from 'electron-updater';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importResourceModule } from './resource-path.js';
import { isPortAvailable, normalizeWizardConfig, saveLauncherConfig } from './launcher-config.js';
import { createGatewayActions } from './gateway-actions.js';
import { createDesktopServiceRuntime } from './service-runtime.js';
import { createSetupWindowManager } from './setup-window.js';
import { fitWindowToContent, WINDOW_SIZE_LIMITS } from './window-size.js';
import { installLocalProtocol, localRendererUrl, registerLocalScheme } from './local-protocol.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createTaskActivityRuntime } from './tool-sleep-blocker.js';
import { createTaskbarCompletionBadge } from './taskbar-completion-badge.js';
import { createDashboardWindowManager } from './dashboard-window.js';
import { createDesktopTray } from './desktop-tray.js';
import { desktopStatusFailure, initialDesktopStatus, normalizeDesktopStatus } from './desktop-status.js';
import { createApprovalTokenManager } from './approval-token.js';
import { createRecoveryWindowManager } from './recovery-window.js';
import { createRuntimeLogBuffer } from './runtime-log-buffer.js';
import { createDiagnosticFiles } from './diagnostic-files.js';
import { readDesktopSettings, saveDesktopSettings } from './desktop-settings.js';
import { createAppUpdater } from './app-updater.js';
import { createUpdateSupportPolicy } from './update-support-policy.js';
import { createDesktopLifecycleManager } from './desktop-lifecycle.js';
import { createDesktopNotifications } from './desktop-notifications.js';
import { createShutdownCoordinator } from './shutdown-coordinator.js';
import { removeControllerRuntimeMarker, writeControllerRuntimeMarker } from './controller-runtime.js';
import * as managedNgrok from './managed-ngrok.js';
import { createGatewayClient } from './gateway-client.js';
import { configureGatewaySafeStorage, createGatewayDeviceIdentityStore } from './gateway-device-identity.js';
import { createPublicConnectionRuntime } from './public-connection-runtime.js';
import { hasExistingConfig, readGuiConfig } from './launcher-utils.js';
const { autoUpdater } = electronUpdater;
const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(electronRoot, 'preload.cjs');
const APP_ICON_PATH = path.join(electronRoot, 'build', 'icon.png');
const RENDERER_ROOT = path.join(electronRoot, 'renderer');

function gatewayDeviceDisplayName() {
  return String(os.hostname() || '').trim() || 'Rel.AI device';
}

registerLocalScheme(protocol);
app.setName('Rel.AI MCP');
if (process.platform === 'win32') app.setAppUserModelId('com.relai.mcp');

const connection = await importResourceModule('src/connectionProfile.js');
const toolActivity = await importResourceModule('src/toolActivity.js');
const dashboardSessions = await importResourceModule('src/http/dashboardSessions.js');
const configModule = await importResourceModule('src/config.js');
const { createGatewayLocalExecutor } = await importResourceModule('src/gateway/localExecution.js');
const { formatDeviceLinkCode, formatRecoveryCode } = await importResourceModule('src/gateway/protocol.js');
const { ERROR_CODES } = await importResourceModule('src/desktopUxContracts.js');
const oauthProvider = await importResourceModule('src/oauthProvider.js');
const { startHttpServer } = await importResourceModule('src/httpServer.js');
const { terminateProcessTree } = await importResourceModule('src/process.js');
const { stopAllManagedProcesses } = await importResourceModule('src/processManager.js');
const { shutdownTelemetry } = await importResourceModule('src/telemetry.js');
let serviceRuntime = null, gatewayActions = null;
let isQuitting = false, appUpdater = null, updateSupportPolicy = null;
const diagnosticFiles = createDiagnosticFiles({ app, shell }); let currentStatus = initialDesktopStatus(app.getVersion()); const runtimeLogs = createRuntimeLogBuffer({ filePath: () => diagnosticFiles.serviceLogPath() });
const desktopNotifications = createDesktopNotifications({
  app, Notification, iconPath: APP_ICON_PATH, isReady: () => app.isReady(), onNotificationClick: focusActiveWindow,
  onLog: (message, options) => runtimeLogs.append(message, options)
});
const approvalTokenManager = createApprovalTokenManager({ readGuiConfig, saveLauncherConfig, generateToken: connection.generateToken, oauthProvider, restartDesktop: () => launchConfiguredDesktop({ restart: true }) });
const recoveryWindowManager = createRecoveryWindowManager({
  BrowserWindow,
  preloadPath,
  rendererUrl: localRendererUrl('status.html'),
  limits: WINDOW_SIZE_LIMITS.status,
  installProtocol: sessionProtocol => installLocalProtocol(sessionProtocol, RENDERER_ROOT),
  isQuitting: () => isQuitting,
  onReady: pushStatus,
  onSecurityError: error => runtimeLogs.append(error.message, { level: 'warning', source: 'electron-security' })
});
const setupWindowManager = createSetupWindowManager({
  BrowserWindow,
  preloadPath,
  rendererRoot: RENDERER_ROOT,
  runtimeLogs,
  isQuitting: () => isQuitting,
  recoveryWindowManager
});
const gatewayDeviceIdentity = createGatewayDeviceIdentityStore({ safeStorage });
const publicConnectionRuntime = createPublicConnectionRuntime({
  createGatewayConnection({ config, onStatus }) {
    return createGatewayClient({
      gatewayOrigin: config.gatewayOrigin,
      identity: gatewayDeviceIdentity,
      appVersion: app.getVersion(),
      displayName: gatewayDeviceDisplayName(),
      getWorkspaces: () => configModule.allWorkspaceAliases(configModule.readConfig()),
      onStatus,
      onRequest: request => {
        const runtimeAccess = updateRuntimeAccess();
        if (runtimeAccess.blocked) {
          return { ok: false, error: { code: 'UPDATE_REQUIRED', message: runtimeAccess.message } };
        }
        const principalId = String(gatewayDeviceIdentity.snapshot().principalId || '');
        if (!principalId) {
          return { ok: false, error: { code: 'PAIRING_REQUIRED', message: 'This Rel.AI device is not paired with ChatGPT.' } };
        }
        const execute = createGatewayLocalExecutor({
          gatewayOrigin: config.gatewayOrigin,
          pairedPrincipalId: principalId,
          config: configModule.readConfig()
        });
        return execute(request);
      }
    });
  },
  prepareDirect: config => managedNgrok.prepareManagedNgrok({
    authtoken: config.ngrokAuthtoken,
    onLog: chunk => publicConnectionLog('ngrok', chunk)
  }),
  startDirect: (config, { onProcess } = {}) => managedNgrok.startManagedNgrokTunnel({
    domain: config.ngrokDomain,
    port: config.port,
    timeoutMs: 30000,
    onLog: chunk => publicConnectionLog('ngrok', chunk),
    onProcess
  }),
  stopDirect: child => terminateProcessTree(child, { graceMs: 1000, forceWaitMs: 2000 }),
  onStatus: ({ mode, status }) => {
    if (mode === 'cloud') gatewayActions?.applyStatus(status);
  }
});
const dashboardWindowManager = createDashboardWindowManager({
  BrowserWindow,
  shell,
  app, dialog, screen,
  getConnection: buildDashboardConnection,
  isQuitting: () => isQuitting,
  onError: error => setStatus({ error: formatError(error), errorCode: ERROR_CODES.UNKNOWN }),
  onLoadError: error => {
    setStatus({ error: formatError(error), errorCode: ERROR_CODES.DASHBOARD_UNAVAILABLE });
    recoveryWindowManager.show();
  }
});
const taskbarCompletionBadge = createTaskbarCompletionBadge({
  app,
  nativeImage, platform: process.platform,
  getBadgeColor: () => systemPreferences.getAccentColor(),
  getWindow: () => dashboardWindowManager.getWindow() || BrowserWindow.getAllWindows().find(win => !win.isDestroyed()) || null,
  isApplicationOpen: () => BrowserWindow.getAllWindows().some(win => !win.isDestroyed() && win.isVisible() && win.isFocused())
}); const desktopTray = createDesktopTray({
  Tray,
  Menu,
  nativeImage,
  clipboard,
  iconPath: APP_ICON_PATH,
  getStatus: () => currentStatus,
  openDashboard: openDashboardWindow,
  focusPrimaryWindow: focusActiveWindow,
  openDiagnostics: openDashboardDiagnostics,
  openSettings: openDashboardSettings,
  startServer,
  stopServer,
  getUpdateStatus: combinedUpdateStatus,
  checkForUpdates: checkApplicationUpdates,
  downloadUpdate: downloadApplicationUpdate,
  installUpdate: installApplicationUpdate,
  quit: quitApplication,
  onError: error => setStatus({ error: formatError(error), errorCode: ERROR_CODES.UNKNOWN })
});
const toolActivityRuntime = createTaskActivityRuntime({
  toolActivity,
  powerSaveBlocker,
  notify: desktopNotifications.show,
  onTaskCompleted: task => taskbarCompletionBadge.markCompleted(task),
  onStatusChange: taskActivity => setStatus({ taskActivity })
});
gatewayActions = createGatewayActions({
  publicConnectionRuntime,
  gatewayDeviceIdentity,
  shell,
  dashboardWindowManager,
  formatDeviceLinkCode,
  formatRecoveryCode,
  errorCodes: ERROR_CODES,
  getCurrentStatus: () => currentStatus,
  setStatus,
  launchConfiguredDesktop: options => launchConfiguredDesktop(options),
  isHttpServerListening: () => serviceRuntime?.isListening() === true
});
serviceRuntime = createDesktopServiceRuntime({
  app,
  connection,
  configModule,
  startHttpServer,
  stopAllManagedProcesses,
  dashboardSessions,
  dashboardWindowManager,
  toolActivityRuntime,
  runtimeLogs,
  approvalTokenManager,
  publicConnectionRuntime,
  errorCodes: ERROR_CODES,
  getRuntimeAccess: updateRuntimeAccess,
  getCurrentStatus: () => currentStatus,
  setStatus,
  replaceCurrentStatus,
  pushStatus,
  applyGatewayStatus: gatewayActions.applyStatus
});
const desktopLifecycle = createDesktopLifecycleManager({ app,
  onLog: (message, options) => runtimeLogs.append(message, options), errorCodes: ERROR_CODES });
appUpdater = createAppUpdater({ app, autoUpdater, getTaskActivity: toolActivityRuntime.getStatus,
  onStatusChange: pushUpdateStatus, onLog: (message, options) => runtimeLogs.append(message, options),
  onBeforeInstall: () => shutdownCoordinator.prepare('update_install'),
  errorCodes: ERROR_CODES });
updateSupportPolicy = createUpdateSupportPolicy({
  app,
  onStatusChange: () => pushUpdateStatus(appUpdater?.getStatus()),
  onLog: (message, options) => runtimeLogs.append(message, options)
});
const shutdownCoordinator = createShutdownCoordinator({
  stopService: () => stopServer({ silent: true }),
  stopUpdater: () => { appUpdater?.stop(); updateSupportPolicy?.stop(); },
  stopActivity: () => toolActivityRuntime.stop(),
  closeWindows() {
    dashboardWindowManager.close();
    recoveryWindowManager.close();
    setupWindowManager.close({ returnToFallback: false });
  },
  removeRuntimeMarker: removeControllerRuntimeMarker,
  shutdownTelemetry,
  markCleanShutdown: () => desktopLifecycle.markCleanShutdown(),
  onLog: (message, options) => runtimeLogs.append(message, options)
});
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('browser-window-created', (_event, win) => taskbarCompletionBadge.apply(win));
  app.on('browser-window-focus', () => taskbarCompletionBadge.clear());
  app.on('second-instance', () => {
    const setupWindow = setupWindowManager.getWindow();
    if (setupWindow) {
      setupWindow.show();
      setupWindow.focus();
      return;
    }
    focusActiveWindow();
  });

  app.whenReady().then(async () => {
    const basicPasswordStoreEnabled = configureGatewaySafeStorage({
      safeStorage,
      platform: process.platform,
      passwordStore: app.commandLine.getSwitchValue('password-store')
    });
    if (basicPasswordStoreEnabled) {
      runtimeLogs.append('The explicitly requested basic Linux password store is not backed by an OS keyring.', {
        level: 'warning',
        source: 'gateway-identity'
      });
    }
    writeControllerRuntimeMarker(app);
    installLocalProtocol(protocol, RENDERER_ROOT);
    const lifecycleStatus = desktopLifecycle.start();
    desktopTray.setup();
    appUpdater.start();
    updateSupportPolicy.start();
    if (hasExistingConfig()) void launchConfiguredDesktop({ background: lifecycleStatus.openedAtLogin });
    else setupWindowManager.create();
  });
}

app.on('before-quit', event => {
  if (shutdownCoordinator.isPrepared()) return;
  event.preventDefault();
  isQuitting = true;
  void quitApplication();
});

app.on('window-all-closed', () => {}); // Keep the tray app alive after windows close.

function currentDesktopSettings() {
  return readDesktopSettings({
    approvalRequired: approvalTokenManager.status().required,
    notificationsEnabled: desktopNotifications.getPreferences().enabled
  });
}

function updateDesktopSettings(settings) {
  return saveDesktopSettings(settings, {
    setNotificationsEnabled: desktopNotifications.setEnabled,
    restartDesktop: () => launchConfiguredDesktop({ restart: true })
  });
}

function getRecoveryConfig() {
  const settings = currentDesktopSettings(), token = settings.approvalToken || connection.generateToken(32);
  return {
    ok: true,
    connectionMode: settings.connectionMode,
    gatewayOrigin: settings.gatewayOrigin,
    port: settings.port,
    token,
    ngrokDomain: settings.ngrokDomain,
    ngrokAuthtoken: settings.ngrokAuthtoken
  };
}

function openRecoverySetup() { recoveryWindowManager.hide(); setupWindowManager.create({ recovery: true }); return { ok: true }; }

function focusActiveWindow() {
  taskbarCompletionBadge.clear();
  const dashboardWindow = dashboardWindowManager.getWindow();
  if (dashboardWindow) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return;
  }
  const fallbackWindow = recoveryWindowManager.getWindow();
  if (fallbackWindow?.isVisible()) {
    recoveryWindowManager.show();
    return;
  }
  void openDashboardWindow().catch(() => recoveryWindowManager.show());
}

function pushStatus(options = {}) {
  recoveryWindowManager.sendStatus(currentStatus);
  const dashboardWindow = dashboardWindowManager.getWindow();
  if (options.dashboard !== false && dashboardWindow) dashboardWindow.webContents.send('server:status', currentStatus);
  desktopTray.update();
}

function combinedUpdateStatus(baseStatus = appUpdater?.getStatus()) {
  return { ...(baseStatus || {}), supportPolicy: updateSupportPolicy?.getStatus() || null };
}

function combineUpdateActionResult(result) {
  if (!result || typeof result !== 'object') return result;
  return { ...result, status: combinedUpdateStatus(result.status) };
}

async function checkApplicationUpdates() {
  return combineUpdateActionResult(await appUpdater?.checkForUpdates());
}

async function downloadApplicationUpdate() {
  return combineUpdateActionResult(await appUpdater?.downloadUpdate());
}

function installApplicationUpdate() {
  return combineUpdateActionResult(appUpdater?.installUpdate());
}

function updateRuntimeAccess() {
  const policy = updateSupportPolicy?.getStatus();
  if (policy?.requiresUpdate !== true) return { blocked: false, errorCode: '', message: '' };
  const minimum = policy.minimumSupportedVersion ? ` v${policy.minimumSupportedVersion} or newer` : ' a supported version';
  return {
    blocked: true,
    errorCode: ERROR_CODES.UPDATE_REQUIRED,
    message: policy.message || `This Rel.AI MCP version is no longer supported. Update to${minimum} before MCP work can continue.`
  };
}

function pushUpdateStatus(status) {
  const merged = combinedUpdateStatus(status);
  desktopNotifications.handleUpdateStatus(merged);
  dashboardWindowManager.getWindow()?.webContents.send('desktop:update-status', merged);
  desktopTray.update();
}

function setStatus(next, options = {}) {
  const previous = currentStatus;
  currentStatus = normalizeDesktopStatus({ ...currentStatus, ...next });
  desktopNotifications.handleDesktopStatusChange(previous, currentStatus);
  runtimeLogs.recordStatusTransition(previous, currentStatus);
  pushStatus(options);
}

function replaceCurrentStatus(next, options = {}) {
  const previous = currentStatus;
  currentStatus = normalizeDesktopStatus(next);
  if (!options.silent) desktopNotifications.handleDesktopStatusChange(previous, currentStatus);
  runtimeLogs.recordStatusTransition(previous, currentStatus);
  if (!options.silent) pushStatus();
  else desktopTray.update();
}

function publicConnectionLog(source, chunk) {
  const entry = runtimeLogs.append(chunk, { source });
  if (entry) recoveryWindowManager.sendLog(entry);
}

function startServer() {
  return serviceRuntime.startServer();
}

function stopServer(options = {}) {
  return serviceRuntime.stopServer(options);
}

function buildDashboardConnection() {
  return serviceRuntime.buildDashboardConnection();
}

async function showDashboardWindow(routeHash = '') {
  await dashboardWindowManager.open(routeHash); taskbarCompletionBadge.clear();
  recoveryWindowManager.hide();
}

async function openDashboardWindow(routeHash = '') {
  if (!serviceRuntime.isListening()) await startServer();
  if (!serviceRuntime.isListening()) {
    recoveryWindowManager.show();
    throw new Error(currentStatus.error || 'Rel.AI connection is not running.');
  }
  try {
    await showDashboardWindow(routeHash);
    return { ok: true };
  } catch (error) {
    setStatus(desktopStatusFailure(ERROR_CODES.DASHBOARD_UNAVAILABLE, `Dashboard failed to open: ${formatError(error)}`));
    recoveryWindowManager.show();
    throw error;
  }
}

async function openDashboardSettings() { return openDashboardWindow('#settings'); }
async function openDashboardDiagnostics() { return openDashboardWindow('#diagnostics'); }

async function launchConfiguredDesktop(options = {}) {
  try {
    if (options.restart) await stopServer({ silent: true, preserveDashboard: true });
    const status = await startServer();
    if (!status.serverRunning) {
      recoveryWindowManager.show();
      return status;
    }
    if (!options.background) await showDashboardWindow('');
    else recoveryWindowManager.hide();
    return status;
  } catch (error) {
    if (currentStatus.errorCode !== ERROR_CODES.DASHBOARD_UNAVAILABLE) {
      setStatus(desktopStatusFailure(ERROR_CODES.LOCAL_SERVICE_START_FAILED, error, { serverRunning: false, tunnelStatus: 'failed' }));
    }
    recoveryWindowManager.show();
    return currentStatus;
  }
}

async function quitApplication() {
  isQuitting = true;
  await shutdownCoordinator.prepare('quit');
  app.exit(0);
}

function openSettingsWindow() { return openDashboardSettings(); }

function formatError(error) { return error instanceof Error ? error.message : String(error || 'Unknown error'); }

registerIpcHandlers({
  ipcMain,
  BrowserWindow,
  clipboard,
  shell,
  saveLauncherConfig,
  getWizardWindow: setupWindowManager.getWindow,
  closeWizard: setupWindowManager.close,
  getFallbackWindow: recoveryWindowManager.getWindow,
  getDashboardWindow: dashboardWindowManager.getWindow,
  getDashboardWindowState: dashboardWindowManager.getState,
  minimizeDashboardWindow: dashboardWindowManager.minimize,
  toggleDashboardMaximize: dashboardWindowManager.toggleMaximize,
  requestDashboardClose: dashboardWindowManager.requestClose,
  getRecoveryConfig,
  startWizardCloudEnrollment: gatewayActions.startWizardCloudEnrollment,
  startWizardCloudPairing: gatewayActions.startWizardCloudPairing,
  getWizardCloudStatus: gatewayActions.getWizardCloudStatus,
  cancelWizardCloudPairing: gatewayActions.cancelWizardCloudPairing,
  getWizardRecoveryCode: gatewayActions.getWizardRecoveryCode,
  createWizardDeviceLink: gatewayActions.createWizardDeviceLink,
  recoverWizardCloudIdentity: gatewayActions.recoverWizardCloudIdentity,
  openRecoverySetup,
  startServer,
  stopServer,
  launchConfiguredDesktop,
  openSettingsWindow,
  openDashboardWindow,
  getGatewayStatus: gatewayActions.statusForDashboard,
  beginGatewayEnrollment: gatewayActions.beginEnrollment,
  beginGatewayPairing: gatewayActions.beginPairing,
  openGatewayAccount: gatewayActions.openAccount,
  cancelGatewayPairing: gatewayActions.cancelPairing,
  listGatewayDevices: gatewayActions.listDevices,
  revokeGatewayDevice: gatewayActions.revokeDevice,
  setGatewayMode: gatewayActions.setMode,
  getGatewayRecovery: gatewayActions.getRecovery,
  getGatewayUsage: gatewayActions.getUsage,
  getDesktopSettings: currentDesktopSettings,
  saveDesktopSettings: updateDesktopSettings,
  replaceApprovalToken: approvalTokenManager.replace,
  getUpdateStatus: combinedUpdateStatus,
  checkForUpdates: checkApplicationUpdates,
  downloadUpdate: downloadApplicationUpdate,
  installUpdate: installApplicationUpdate,
  getLifecycleStatus: desktopLifecycle.getStatus,
  setLaunchAtLogin: desktopLifecycle.setLaunchAtLogin,
  getCurrentStatus: () => currentStatus,
  getNotificationsEnabled: () => desktopNotifications.getPreferences().enabled,
  setNotificationsEnabled: desktopNotifications.setEnabled,
  getNotificationPreferences: desktopNotifications.getPreferences,
  updateNotificationPreferences: desktopNotifications.updatePreferences,
  exportDiagnosticState: diagnosticFiles.exportReport, openDiagnosticsFolder: diagnosticFiles.openFolder,
  fitWindowToContent
});

export { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
