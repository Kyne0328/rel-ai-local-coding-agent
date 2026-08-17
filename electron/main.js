import { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, powerSaveBlocker, Notification, dialog, screen, protocol, safeStorage, utilityProcess } from 'electron';
import electronUpdater from 'electron-updater';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importResourceModule } from './resource-path.js';
import { normalizeWizardConfig, saveLauncherConfig } from './launcher-config.js';
import { createDesktopServiceRuntime } from './service-runtime.js';
import { createServiceProcessClient } from './service-process-client.js';
import { createSetupWindowManager } from './setup-window.js';
import { fitWindowToContent, WINDOW_SIZE_LIMITS } from './window-size.js';
import { installLocalProtocol, localRendererUrl, registerLocalScheme } from './local-protocol.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createTaskActivityRuntime, taskActivityBlockReason } from './tool-sleep-blocker.js';
import { createTaskbarCompletionBadge } from './taskbar-completion-badge.js';
import { createDashboardWindowManager } from './dashboard-window.js';
import { createDesktopTray } from './desktop-tray.js';
import { desktopStatusFailure, initialDesktopStatus, normalizeDesktopStatus } from './desktop-status.js';
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
import { configureTunnelSafeStorage, createTunnelCredentialStore } from './tunnel-credentials.js';
import { createSecureTunnelRuntime } from './secure-tunnel-runtime.js';
import { createTunnelRecoverySupervisor } from './tunnel-recovery-supervisor.js';
import { hasExistingConfig } from './launcher-utils.js';
const { autoUpdater } = electronUpdater;
const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(electronRoot, 'preload.cjs');
const APP_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'app-icon.png')
  : path.join(electronRoot, 'build', 'icon.png');
const RENDERER_ROOT = path.join(electronRoot, 'renderer');

registerLocalScheme(protocol);
app.setName('Rel.AI MCP');
if (process.platform === 'win32') app.setAppUserModelId('com.relai.mcp');

const [
  connection,
  configModule,
  desktopUxContracts,
  processModule,
  localAnalytics,
  telemetry,
  processEnvironment
] = await Promise.all([
  importResourceModule('src/connectionProfile.js'),
  importResourceModule('src/config.js'),
  importResourceModule('src/desktopUxContracts.js'),
  importResourceModule('src/process.js'),
  importResourceModule('src/localAnalytics.js'),
  importResourceModule('src/telemetry.js'),
  importResourceModule('src/processEnvironment.js')
]);
const { ERROR_CODES } = desktopUxContracts;
const { terminateProcessTree } = processModule;
const { readLocalUsageSnapshotAsync } = localAnalytics;
const { shutdownTelemetry } = telemetry;
const { makeServiceProcessEnvironment, makeTunnelProcessEnvironment } = processEnvironment;
let serviceRuntime = null, desktopTray = null, tunnelRecoverySupervisor = null;
let isQuitting = false, appUpdater = null, updateSupportPolicy = null;
let lastServiceContextKey = '';
const diagnosticFiles = createDiagnosticFiles({ app, shell }); let currentStatus = initialDesktopStatus(app.getVersion()); const runtimeLogs = createRuntimeLogBuffer({ filePath: () => diagnosticFiles.serviceLogPath() });
const desktopNotifications = createDesktopNotifications({
  app, Notification, iconPath: APP_ICON_PATH, isReady: () => app.isReady(), onNotificationClick: focusActiveWindow,
  onLog: (message, options) => runtimeLogs.append(message, options)
});
const tunnelCredentials = createTunnelCredentialStore({ safeStorage });
const recoveryWindowManager = createRecoveryWindowManager({
  BrowserWindow,
  iconPath: APP_ICON_PATH,
  preloadPath,
  rendererUrl: localRendererUrl('status.html'),
  limits: WINDOW_SIZE_LIMITS.status,
  installProtocol: sessionProtocol => installLocalProtocol(sessionProtocol, RENDERER_ROOT),
  isQuitting: () => isQuitting,
  onReady: hydrateRecoveryWindow,
  onSecurityError: error => runtimeLogs.append(error.message, { level: 'warning', source: 'electron-security' })
});
const setupWindowManager = createSetupWindowManager({
  BrowserWindow,
  iconPath: APP_ICON_PATH,
  preloadPath,
  rendererRoot: RENDERER_ROOT,
  runtimeLogs,
  isQuitting: () => isQuitting,
  recoveryWindowManager
});
const secureTunnelRuntime = createSecureTunnelRuntime({
  stopProcess: terminateProcessTree,
  makeEnvironment: makeTunnelProcessEnvironment,
  onLog: entry => publicConnectionLog('openai-tunnel', entry),
  onStatus: status => {
    const common = { tunnelStatus: status.state, tunnelId: status.tunnelId, tunnelHealthUrl: status.healthUrl || '' };
    if (status.state === 'running') {
      setStatus({ ...common, tunnelRetryAttempt: 0, tunnelNextRetryAt: null, error: '', errorCode: '' });
      tunnelRecoverySupervisor?.observe(status);
    } else if (['starting', 'locally_ready', 'authenticating'].includes(status.state)) {
      setStatus({ ...common, error: '', errorCode: '' });
    } else if (status.state === 'degraded') {
      setStatus({ ...common, error: status.error, errorCode: status.errorCode || ERROR_CODES.TUNNEL_CONNECTION_INTERRUPTED });
    } else if (status.state === 'failed') {
      const recovery = tunnelRecoverySupervisor?.observe(status);
      if (!recovery?.scheduled && !recovery?.inFlight) {
        setStatus({ ...common, tunnelRetryAttempt: 0, tunnelNextRetryAt: null, error: status.error, errorCode: status.errorCode || ERROR_CODES.SECURE_TUNNEL_FAILED });
      }
    } else if (status.state === 'stopped') {
      setStatus({ ...common, error: '', errorCode: '' });
      tunnelRecoverySupervisor?.observe(status);
    }
  }
});
const dashboardWindowManager = createDashboardWindowManager({
  BrowserWindow,
  shell,
  app, dialog, screen,
  iconPath: APP_ICON_PATH,
  canHideOnClose: () => desktopTray?.isAvailable() === true,
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
  getWindow: () => dashboardWindowManager.getWindow() || BrowserWindow.getAllWindows().find(win => !win.isDestroyed()) || null,
  isApplicationOpen: () => BrowserWindow.getAllWindows().some(win => !win.isDestroyed() && win.isVisible() && win.isFocused())
});
const serviceProcessClient = createServiceProcessClient({
  utilityProcess,
  modulePath: path.join(electronRoot, 'service-process.js'),
  cwd: path.dirname(electronRoot),
  env: makeServiceProcessEnvironment({}, { allow: configuredProcessEnvironmentAllow() }),
  nativeHandlers: {
    pickFolder: () => dashboardWindowManager.pickFolder(),
    openFolder: payload => dashboardWindowManager.openFolder(payload.path),
    clearRuntimeLogs: () => runtimeLogs.clear()
  },
  onLog: (message, options) => publicConnectionLog(options.source || 'local-service', message, options),
  onExit: ({ code }) => {
    if (isQuitting || !currentStatus.serverRunning) return;
    setStatus(desktopStatusFailure(
      ERROR_CODES.LOCAL_SERVICE_START_FAILED,
      `Local service process exited unexpectedly with code ${code}.`,
      { serverRunning: false, tunnelStatus: 'failed' }
    ));
  }
});
runtimeLogs.onChange(change => serviceProcessClient.updateContext({ runtimeLogChange: change }));
desktopTray = createDesktopTray({
  Tray,
  Menu,
  nativeImage,
  clipboard,
  platform: process.platform,
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
  toolActivity: serviceProcessClient.activitySource,
  powerSaveBlocker,
  notify: desktopNotifications.show,
  onTaskCompleted: task => taskbarCompletionBadge.markCompleted(task),
  onStatusChange: setTaskActivityStatus
});
serviceRuntime = createDesktopServiceRuntime({
  app,
  connection,
  configModule,
  serviceProcessClient,
  dashboardWindowManager,
  runtimeLogs,
  secureTunnelRuntime,
  tunnelCredentials,
  errorCodes: ERROR_CODES,
  getCurrentStatus: () => currentStatus,
  setStatus,
  replaceCurrentStatus,
  pushStatus
});
tunnelRecoverySupervisor = createTunnelRecoverySupervisor({
  restartConnection: () => serviceRuntime.restartConnection(),
  onSchedule: ({ attempt, delayMs, nextRetryAt, lastError }) => {
    runtimeLogs.append('Secure MCP Tunnel reconnect scheduled.', {
      level: 'warning',
      source: 'openai-tunnel',
      code: ERROR_CODES.TUNNEL_CONNECTION_INTERRUPTED,
      details: { retryAttempt: attempt, retryInMs: delayMs, lastError }
    });
    setStatus({
      serverRunning: currentStatus.serverRunning,
      tunnelStatus: 'degraded',
      tunnelRetryAttempt: attempt,
      tunnelNextRetryAt: nextRetryAt,
      error: 'Secure MCP Tunnel is unavailable. Rel.AI is retrying automatically.',
      errorCode: ERROR_CODES.TUNNEL_CONNECTION_INTERRUPTED
    });
  }
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
  stopService: () => stopServer({ silent: true, terminateUtility: true }),
  stopUpdater: () => { appUpdater?.stop(); updateSupportPolicy?.stop(); },
  stopActivity: () => toolActivityRuntime.stop(),
  async closeWindows() {
    await dashboardWindowManager.close();
    recoveryWindowManager.close();
    setupWindowManager.close({ returnToFallback: false });
  },
  removeRuntimeMarker: removeControllerRuntimeMarker,
  shutdownTelemetry,
  markCleanShutdown: () => desktopLifecycle.markCleanShutdown(),
  flushLogs: () => runtimeLogs.flush(),
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
    const basicPasswordStoreEnabled = configureTunnelSafeStorage({
      safeStorage,
      platform: process.platform,
      passwordStore: app.commandLine.getSwitchValue('password-store')
    });
    if (basicPasswordStoreEnabled) {
      runtimeLogs.append('The explicitly requested basic Linux password store is not backed by an OS keyring.', {
        level: 'warning',
        source: 'tunnel-credentials'
      });
    }
    installLocalProtocol(protocol, RENDERER_ROOT);
    const [, lifecycleStatus] = await Promise.all([
      writeControllerRuntimeMarker(app),
      desktopLifecycle.start()
    ]);
    desktopTray.setup();
    if (hasExistingConfig()) void launchConfiguredDesktop({ background: lifecycleStatus.openedAtLogin });
    else setupWindowManager.create();
    setImmediate(() => {
      appUpdater.start();
      updateSupportPolicy.start();
    });
  });
}

app.on('before-quit', event => {
  if (shutdownCoordinator.isPrepared()) return;
  event.preventDefault();
  isQuitting = true;
  void quitApplication();
});

app.on('window-all-closed', () => {}); // Keep the tray app alive after windows close.

function configuredProcessEnvironmentAllow() {
  try {
    return configModule.readConfig({ allowMissing: true }).processEnvironment?.allow || [];
  } catch {
    return [];
  }
}

function currentDesktopSettings() {
  return readDesktopSettings({
    tunnelApiKeyConfigured: tunnelCredentials.status().apiKeyConfigured,
    notificationsEnabled: desktopNotifications.getPreferences().enabled,
    tunnelErrorCode: currentStatus.errorCode,
    tunnelError: currentStatus.error
  });
}

function updateDesktopSettings(settings) {
  return saveDesktopSettings(settings, {
    setNotificationsEnabled: desktopNotifications.setEnabled,
    getNotificationsEnabled: () => desktopNotifications.getPreferences().enabled,
    setTunnelApiKey: tunnelCredentials.setApiKey,
    getTunnelApiKey: tunnelCredentials.getApiKey,
    clearTunnelApiKey: tunnelCredentials.clear,
    canRestart: action => taskActivityBlockReason(toolActivityRuntime.getStatus(), action),
    getCurrentStatus: () => currentStatus,
    restartConnection,
    restartDesktop: () => launchConfiguredDesktop({ restart: true })
  });
}

function getRecoveryConfig() {
  const settings = currentDesktopSettings();
  return {
    ok: true,
    port: settings.port,
    tunnelId: settings.tunnelId,
    tunnelApiKeyConfigured: settings.tunnelApiKeyConfigured
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

function hydrateRecoveryWindow() {
  pushStatus();
  for (const entry of runtimeLogs.snapshot({ limit: 100 }).entries) recoveryWindowManager.sendLog(entry);
}

function setTaskActivityStatus(taskActivity) {
  currentStatus = normalizeDesktopStatus({ ...currentStatus, taskActivity });
  recoveryWindowManager.sendStatus(currentStatus);
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
  syncServiceContext();
}

function setStatus(next, options = {}) {
  const previous = currentStatus;
  currentStatus = normalizeDesktopStatus({ ...currentStatus, ...next });
  desktopNotifications.handleDesktopStatusChange(previous, currentStatus);
  runtimeLogs.recordStatusTransition(previous, currentStatus);
  syncServiceContext();
  pushStatus(options);
}

function replaceCurrentStatus(next, options = {}) {
  const previous = currentStatus;
  currentStatus = normalizeDesktopStatus(next);
  if (!options.silent) desktopNotifications.handleDesktopStatusChange(previous, currentStatus);
  runtimeLogs.recordStatusTransition(previous, currentStatus);
  syncServiceContext();
  if (!options.silent) pushStatus();
  else desktopTray.update();
}

function publicConnectionLog(source, value, options = {}) {
  const payload = value && typeof value === 'object' ? value : { message: value };
  const entry = runtimeLogs.append(payload.message, {
    ...payload,
    ...options,
    source: payload.source || source
  });
  if (entry) recoveryWindowManager.sendLog(entry);
}

function syncServiceContext() {
  const { taskActivity: _taskActivity, ...status } = currentStatus;
  const context = { status, runtimeAccess: updateRuntimeAccess() };
  const key = JSON.stringify(context);
  if (key === lastServiceContextKey) return false;
  lastServiceContextKey = key;
  serviceProcessClient.updateContext(context);
  return true;
}

function startServer() {
  syncServiceContext();
  return serviceRuntime.startServer();
}

function restartConnection() {
  return tunnelRecoverySupervisor?.retryNow() || serviceRuntime.restartConnection();
}

function stopServer(options = {}) {
  tunnelRecoverySupervisor?.cancel();
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
  if (!serviceRuntime.isListening()) {
    void startServer();
    await serviceRuntime.waitUntilListening();
  }
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
  if (options.restart) {
    const restartBlock = taskActivityBlockReason(toolActivityRuntime.getStatus(), 'restarting the connection');
    if (restartBlock) throw new Error(restartBlock);
  }
  try {
    if (options.restart) await stopServer({ silent: true, preserveDashboard: true });
    const pendingStart = startServer();
    const status = options.firstRun || options.background
      ? await pendingStart
      : await serviceRuntime.waitUntilListening();
    if (!serviceRuntime.isListening()) {
      recoveryWindowManager.show();
      return status;
    }
    if (!options.background) await showDashboardWindow(options.firstRun ? '#connection' : '');
    else recoveryWindowManager.hide();
    return currentStatus;
  } catch (error) {
    if (currentStatus.errorCode !== ERROR_CODES.DASHBOARD_UNAVAILABLE) {
      setStatus(desktopStatusFailure(ERROR_CODES.LOCAL_SERVICE_START_FAILED, error, { serverRunning: false, tunnelStatus: 'failed' }));
    }
    recoveryWindowManager.show();
    return currentStatus;
  }
}

async function relaunchApplication() {
  const restartBlock = taskActivityBlockReason(toolActivityRuntime.getStatus(), 'restarting Rel.AI');
  if (restartBlock) throw new Error(restartBlock);
  isQuitting = true;
  const shutdown = await shutdownCoordinator.prepare('relaunch');
  app.relaunch();
  app.exit(0);
  return { ok: true, clean: shutdown.clean !== false };
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
  setTunnelApiKey: tunnelCredentials.setApiKey,
  openRecoverySetup,
  startServer,
  stopServer,
  launchConfiguredDesktop,
  restartConnection,
  relaunchApplication,
  openSettingsWindow,
  openDashboardWindow,
  getDesktopSettings: currentDesktopSettings,
  saveDesktopSettings: updateDesktopSettings,
  getLocalUsage: month => readLocalUsageSnapshotAsync(configModule.readConfig(), month),
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

export { normalizeWizardConfig, saveLauncherConfig };
