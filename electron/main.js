import { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, powerSaveBlocker, Notification, dialog, screen, protocol } from 'electron';
import electronUpdater from 'electron-updater';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importResourceModule } from './resource-path.js';
import { isPortAvailable, normalizeWizardConfig, saveLauncherConfig } from './launcher-config.js';
import { fitWindowToContent, WINDOW_SIZE_LIMITS } from './window-size.js';
import { localWindowWebPreferences, secureLocalWindow } from './window-security.js';
import { installLocalProtocol, localRendererUrl, registerLocalScheme } from './local-protocol.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createTaskActivityRuntime } from './tool-sleep-blocker.js';
import { createTaskbarCompletionBadge } from './taskbar-completion-badge.js';
import { createDashboardWindowManager } from './dashboard-window.js';
import { createDesktopTray } from './desktop-tray.js';
import { createDesktopStatusModel } from './desktop-status.js';
import { createApprovalTokenManager } from './approval-token.js';
import { createRecoveryWindowManager } from './recovery-window.js';
import { createRuntimeLogBuffer } from './runtime-log-buffer.js';
import { createDiagnosticFiles } from './diagnostic-files.js';
import { createDesktopSettingsManager } from './desktop-settings.js';
import { createAppUpdater } from './app-updater.js';
import { createDesktopLifecycleManager } from './desktop-lifecycle.js';
import { closeHttpServer, createShutdownCoordinator } from './shutdown-coordinator.js';
import { STARTUP_BACKGROUND_COLOR } from './startup-background.js';
import { removeControllerRuntimeMarker, writeControllerRuntimeMarker } from './controller-runtime.js';
import * as managedNgrok from './managed-ngrok.js';
import { hasExistingConfig, readGuiConfig, buildMcpUrl, normalizeNgrokDomain, normalizeNgrokAuthtoken, normalizePort } from './launcher-utils.js';
const { autoUpdater } = electronUpdater;
const electronRoot = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(electronRoot, 'preload.cjs');
const APP_ICON_PATH = path.join(electronRoot, 'build', 'icon.png');
const RENDERER_ROOT = path.join(electronRoot, 'renderer');

registerLocalScheme(protocol);
app.setName('Rel.AI MCP');
if (process.platform === 'win32') app.setAppUserModelId('com.relai.mcp');

const connection = await importResourceModule('src/connectionProfile.js');
const toolActivity = await importResourceModule('src/toolActivity.js');
const dashboardSessions = await importResourceModule('src/http/dashboardSessions.js');
const configModule = await importResourceModule('src/config.js');
const diagnosticsModule = await importResourceModule('src/diagnostics.js');
const { ERROR_CODES, deriveConnectionState } = await importResourceModule('src/desktopUxContracts.js');
const oauthProvider = await importResourceModule('src/oauthProvider.js');
const { startHttpServer } = await importResourceModule('src/httpServer.js');
const { terminateProcessTree } = await importResourceModule('src/process.js');
const { stopAllManagedProcesses } = await importResourceModule('src/processManager.js');
const { shutdownTelemetry } = await importResourceModule('src/telemetry.js');let wizardWindow = null, wizardRecoveryMode = false, wizardReturnToFallback = false;
let httpServer = null, tunnelProcess = null, startPromise = null;
let lifecycleToken = 0, isQuitting = false, appUpdater = null;
const desktopStatusModel = createDesktopStatusModel({ version: app.getVersion(), deriveConnectionState, formatError });
const diagnosticFiles = createDiagnosticFiles({ app, shell, sanitizeDiagnosticValue: diagnosticsModule.sanitizeDiagnosticValue }); let currentStatus = desktopStatusModel.initial(); const runtimeLogs = createRuntimeLogBuffer({ filePath: () => diagnosticFiles.serviceLogPath() });
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
  nativeImage, platform: process.platform,
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
  getUpdateStatus: () => appUpdater?.getStatus(),
  checkForUpdates: () => appUpdater?.checkForUpdates(),
  downloadUpdate: () => appUpdater?.downloadUpdate(),
  installUpdate: () => appUpdater?.installUpdate(),
  quit: quitApplication,
  onError: error => setStatus({ error: formatError(error), errorCode: ERROR_CODES.UNKNOWN })
});
const toolActivityRuntime = createTaskActivityRuntime({
  toolActivity, powerSaveBlocker, Notification, iconPath: APP_ICON_PATH,
  isReady: () => app.isReady(), onNotificationClick: focusActiveWindow,
  onTaskCompleted: task => taskbarCompletionBadge.markCompleted(task),
  onStatusChange: taskActivity => setStatus({ taskActivity })
});
const desktopSettings = createDesktopSettingsManager({ readGuiConfig, saveLauncherConfig,
  getApprovalRequired: () => approvalTokenManager.status().required,
  getNotificationsEnabled: toolActivityRuntime.getNotificationsEnabled,
  setNotificationsEnabled: toolActivityRuntime.setNotificationsEnabled,
  restartDesktop: () => launchConfiguredDesktop({ restart: true }) });
const desktopLifecycle = createDesktopLifecycleManager({ app,
  onLog: (message, options) => runtimeLogs.append(message, options), errorCodes: ERROR_CODES });
appUpdater = createAppUpdater({ app, autoUpdater, getTaskActivity: toolActivityRuntime.getStatus,
  onStatusChange: pushUpdateStatus, onLog: (message, options) => runtimeLogs.append(message, options),
  onBeforeInstall: () => shutdownCoordinator.prepare('update_install'),
  errorCodes: ERROR_CODES });
const shutdownCoordinator = createShutdownCoordinator({
  stopService: () => stopServer({ silent: true }),
  stopUpdater: () => appUpdater?.stop(),
  stopActivity: () => toolActivityRuntime.stop(),
  closeWindows() {
    dashboardWindowManager.close();
    recoveryWindowManager.close();
    closeWizard({ returnToFallback: false });
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
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.show();
      wizardWindow.focus();
      return;
    }
    focusActiveWindow();
  });

  app.whenReady().then(async () => {
    writeControllerRuntimeMarker(app);
    installLocalProtocol(protocol, RENDERER_ROOT);
    const lifecycleStatus = desktopLifecycle.start();
    desktopTray.setup();
    appUpdater.start();
    if (hasExistingConfig()) void launchConfiguredDesktop({ background: lifecycleStatus.openedAtLogin });
    else createWizardWindow();
  });
}

app.on('before-quit', event => {
  if (shutdownCoordinator.isPrepared()) return;
  event.preventDefault();
  isQuitting = true;
  void quitApplication();
});

app.on('window-all-closed', () => {}); // Keep the tray app alive after windows close.

function createWizardWindow(options = {}) {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.show();
    wizardWindow.focus();
    return wizardWindow;
  }

  wizardRecoveryMode = options.recovery === true;
  wizardReturnToFallback = wizardRecoveryMode;
  const wizardRendererUrl = localRendererUrl('wizard.html', wizardRecoveryMode ? { recovery: '1' } : {});  wizardWindow = new BrowserWindow({
    width: WINDOW_SIZE_LIMITS.wizard.minWidth,
    height: 620,
    minWidth: WINDOW_SIZE_LIMITS.wizard.minWidth,
    minHeight: WINDOW_SIZE_LIMITS.wizard.minHeight,
    resizable: true, maximizable: true,
    useContentSize: true,
    webPreferences: localWindowWebPreferences(preloadPath, 'relai-setup', 'application'),
    backgroundColor: STARTUP_BACKGROUND_COLOR,
    title: wizardRecoveryMode ? 'Rel.AI MCP - Connection Recovery' : 'Rel.AI MCP - Setup',
    autoHideMenuBar: true
  });
  installLocalProtocol(wizardWindow.webContents.session.protocol, RENDERER_ROOT);
  secureLocalWindow(wizardWindow, { allowedUrl: wizardRendererUrl, onError: error => runtimeLogs.append(error.message, { level: 'warning', source: 'electron-security' }) });
  void wizardWindow.loadURL(wizardRendererUrl).catch(error => {
    runtimeLogs.append(`Setup renderer failed to load: ${formatError(error)}`, { level: 'error', source: 'electron-renderer' });
  });
  wizardWindow.webContents.on('did-finish-load', () => {
    fitWindowToContent(wizardWindow, { type: 'wizard' });
  });
  wizardWindow.on('closed', () => {
    const returnToFallback = wizardReturnToFallback;
    wizardWindow = null;
    wizardRecoveryMode = false;
    wizardReturnToFallback = false;
    if (returnToFallback && !isQuitting) recoveryWindowManager.show();
  });
  return wizardWindow;
}

function closeWizard(options = {}) {
  wizardReturnToFallback = options.returnToFallback === true && wizardRecoveryMode;
  if (wizardWindow && !wizardWindow.isDestroyed()) wizardWindow.destroy();
  else {
    const returnToFallback = wizardReturnToFallback;
    wizardWindow = null;
    wizardRecoveryMode = false;
    wizardReturnToFallback = false;
    if (returnToFallback && !isQuitting) recoveryWindowManager.show();
  }
}

function getRecoveryConfig() {
  const settings = desktopSettings.get(), token = settings.approvalToken || connection.generateToken(32);
  return { ok: true, port: settings.port, token, ngrokDomain: settings.ngrokDomain, ngrokAuthtoken: settings.ngrokAuthtoken };
}

function openRecoverySetup() { recoveryWindowManager.hide(); createWizardWindow({ recovery: true }); return { ok: true }; }

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

function pushStatus() {
  recoveryWindowManager.sendStatus(currentStatus);
  const dashboardWindow = dashboardWindowManager.getWindow();
  if (dashboardWindow) dashboardWindow.webContents.send('server:status', currentStatus);
  desktopTray.update();
}

function pushUpdateStatus(status) { dashboardWindowManager.getWindow()?.webContents.send('desktop:update-status', status); desktopTray.update(); }

function setStatus(next) {
  const previous = currentStatus;
  currentStatus = desktopStatusModel.normalize({ ...currentStatus, ...next }); runtimeLogs.recordStatusTransition(previous, currentStatus); pushStatus();
}

async function startServer() {
  if (httpServer?.listening) {
    pushStatus();
    return currentStatus;
  }
  if (startPromise) return startPromise;
  const runToken = ++lifecycleToken;
  startPromise = (async () => {
    let guiConfig;
    try {
      configModule.ensureConfig();
      guiConfig = readGuiConfig();
      guiConfig.port = normalizePort(guiConfig.port || 3333);
      guiConfig.ngrokDomain = normalizeNgrokDomain(guiConfig.ngrokDomain || '');
      guiConfig.ngrokAuthtoken = normalizeNgrokAuthtoken(guiConfig.ngrokAuthtoken || '');
      if (!guiConfig.token) {
        guiConfig.token = connection.generateToken(32);
        connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: guiConfig.token });
      }
    } catch (error) {
      setStatus(desktopStatusModel.failure(ERROR_CODES.CONFIGURATION_INVALID, error, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    const available = await isPortAvailable(guiConfig.port);
    if (!available) {
      setStatus(desktopStatusModel.failure(ERROR_CODES.LOCAL_PORT_IN_USE, `Port ${guiConfig.port} is already in use.`, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    let actualPort;
    try {
      httpServer = startHttpServer({
        host: '127.0.0.1',
        port: guiConfig.port,
        token: guiConfig.token,
        publicUrl: `https://${guiConfig.ngrokDomain}`,
        exitOnError: false,
        pickFolder: () => dashboardWindowManager.pickFolder(),
        openFolder: folderPath => dashboardWindowManager.openFolder(folderPath),
        getTaskActivity: toolActivityRuntime.getStatus, getDesktopStatus: () => currentStatus,
        resetTaskActivity: toolActivityRuntime.resetHistory, getRuntimeLogs: runtimeLogs.snapshot, clearRuntimeLogs: runtimeLogs.clear,
        onOAuthAuthorized: () => setStatus({ authenticationRequired: false, error: '', errorCode: '' })
      });
      actualPort = await new Promise((resolve, reject) => {
        httpServer.once('listening', () => resolve(httpServer.address().port));
        httpServer.once('error', reject);
      });
    } catch (error) {
      httpServer = null;
      setStatus(desktopStatusModel.failure(ERROR_CODES.LOCAL_SERVICE_START_FAILED, error, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    const localUrl = `http://127.0.0.1:${actualPort}`; setStatus({ serverRunning: true, tunnelStatus: 'connecting', mcpUrl: '', authenticationRequired: approvalTokenManager.status().required, error: '', errorCode: '', localUrl });

    const tunnelLog = chunk => {
      const entry = runtimeLogs.append(chunk, { source: 'ngrok' }); if (entry) recoveryWindowManager.sendLog(entry);
    };

    try {
      await managedNgrok.prepareManagedNgrok({
        authtoken: guiConfig.ngrokAuthtoken,
        onLog: tunnelLog
      });
    } catch (error) {
      setStatus(desktopStatusModel.failure(ERROR_CODES.PUBLIC_ENDPOINT_FAILED, error, { serverRunning: true, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    const result = await managedNgrok.startManagedNgrokTunnel({
      domain: guiConfig.ngrokDomain,
      port: actualPort,
      timeoutMs: 30000,
      onLog: tunnelLog,
      onProcess: (child) => {
        tunnelProcess = child;
      }
    });

    if (runToken !== lifecycleToken) {
      if (result.process) await terminateProcessTree(result.process, { graceMs: 500, forceWaitMs: 1500 });
      startPromise = null;
      return currentStatus;
    }

    if (result.ok) {
      tunnelProcess = result.process;
      const publicBaseUrl = `https://${guiConfig.ngrokDomain}`;
      const mcpUrl = buildMcpUrl(publicBaseUrl);
      connection.writeConnectionProfile({
        host: '127.0.0.1',
        port: actualPort,
        publicUrl: publicBaseUrl,
        ngrokDomain: guiConfig.ngrokDomain,
        tunnelProvider: 'managed-ngrok',
        configPath: configModule.getConfigPath()
      });
      setStatus({ serverRunning: true, tunnelStatus: 'running', mcpUrl, authenticationRequired: approvalTokenManager.status().required, error: '', errorCode: '' });
    } else {
      setStatus(desktopStatusModel.failure(ERROR_CODES.PUBLIC_ENDPOINT_FAILED, result.error || 'Tunnel failed before publishing a public URL.', { serverRunning: true, tunnelStatus: 'failed', mcpUrl: '' }));
    }

    startPromise = null;
    return currentStatus;
  })();

  return startPromise;
}

async function stopServer(options = {}) {
  lifecycleToken += 1;
  const runtimeConfig = configModule.readConfig();
  const ownedTunnel = tunnelProcess;
  const ownedServer = httpServer;
  tunnelProcess = null;
  httpServer = null;
  startPromise = null;

  const [managedProcesses, tunnel, localService] = await Promise.all([
    stopAllManagedProcesses(runtimeConfig).catch(error => ({ attempted: 0, stopped: 0, orphaned: 1, error: formatError(error) })),
    ownedTunnel
      ? terminateProcessTree(ownedTunnel, { graceMs: 1000, forceWaitMs: 2000 }).catch(error => ({ exited: false, error: formatError(error) }))
      : Promise.resolve({ exited: true, forced: false }),
    closeHttpServer(ownedServer)
  ]);

  if (!options.preserveDashboard) dashboardWindowManager.close();
  dashboardSessions.clearDashboardSessions();
  currentStatus = desktopStatusModel.initial();
  if (!options.silent) pushStatus();
  else desktopTray.update();
  return {
    ...currentStatus,
    cleanup: {
      clean: managedProcesses.orphaned === 0 && tunnel.exited !== false && localService.closed !== false,
      managedProcesses,
      tunnel,
      localService
    }
  };
}

function buildDashboardConnection() {
  const port = (httpServer?.listening && httpServer.address()?.port) || readGuiConfig().port || 3333;
  const token = connection.readLaunchEnv().REL_AI_MCP_TOKEN || readGuiConfig().token || '';
  const bootstrap = dashboardSessions.createDashboardBootstrap(token);
  const chrome = dashboardWindowManager.getState();
  const chromeMode = chrome.customTitleBar ? 'custom' : 'native';
  return { url: `http://127.0.0.1:${port}/dashboard?surface=desktop&chrome=${chromeMode}&platform=${encodeURIComponent(chrome.platform)}&bootstrap=${encodeURIComponent(bootstrap)}` };
}

async function showDashboardWindow(routeHash = '') {
  await dashboardWindowManager.open(routeHash); taskbarCompletionBadge.clear();
  recoveryWindowManager.hide();
}

async function openDashboardWindow(routeHash = '') {
  if (!httpServer?.listening) await startServer();
  if (!httpServer?.listening) {
    recoveryWindowManager.show();
    throw new Error(currentStatus.error || 'Rel.AI local service is not running.');
  }
  try {
    await showDashboardWindow(routeHash);
    return { ok: true };
  } catch (error) {
    setStatus(desktopStatusModel.failure(ERROR_CODES.DASHBOARD_UNAVAILABLE, `Dashboard failed to open: ${formatError(error)}`));
    recoveryWindowManager.show();
    throw error;
  }
}

async function openDashboardSettings() { return openDashboardWindow('#settings'); }
async function openDashboardDiagnostics() { return openDashboardWindow('#settings/diagnostics'); }

async function launchConfiguredDesktop(options = {}) {
  try {
    if (options.restart) await stopServer({ silent: true, preserveDashboard: true });
    const status = await startServer();
    if (!status.serverRunning) {
      recoveryWindowManager.show();
      return status;
    }
    if (!options.background) await showDashboardWindow(options.firstRun ? '#settings/connection' : '');
    else recoveryWindowManager.hide();
    return status;
  } catch (error) {
    if (currentStatus.errorCode !== ERROR_CODES.DASHBOARD_UNAVAILABLE) {
      setStatus(desktopStatusModel.failure(ERROR_CODES.LOCAL_SERVICE_START_FAILED, error, { serverRunning: false, tunnelStatus: 'failed' }));
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
  getWizardWindow: () => wizardWindow,
  closeWizard,
  getFallbackWindow: recoveryWindowManager.getWindow,
  getDashboardWindow: dashboardWindowManager.getWindow,
  getDashboardWindowState: dashboardWindowManager.getState,
  minimizeDashboardWindow: dashboardWindowManager.minimize,
  toggleDashboardMaximize: dashboardWindowManager.toggleMaximize,
  requestDashboardClose: dashboardWindowManager.requestClose,
  getRecoveryConfig,
  openRecoverySetup,
  startServer,
  stopServer,
  launchConfiguredDesktop,
  openSettingsWindow,
  openDashboardWindow,
  getDesktopSettings: desktopSettings.get,
  saveDesktopSettings: desktopSettings.save,
  replaceApprovalToken: approvalTokenManager.replace,
  getUpdateStatus: appUpdater.getStatus,
  checkForUpdates: appUpdater.checkForUpdates,
  downloadUpdate: appUpdater.downloadUpdate,
  installUpdate: appUpdater.installUpdate,
  getLifecycleStatus: desktopLifecycle.getStatus,
  setLaunchAtLogin: desktopLifecycle.setLaunchAtLogin,
  getCurrentStatus: () => currentStatus,
  getNotificationsEnabled: toolActivityRuntime.getNotificationsEnabled,
  setNotificationsEnabled: toolActivityRuntime.setNotificationsEnabled,
  exportDiagnosticState: diagnosticFiles.exportReport, openDiagnosticsFolder: diagnosticFiles.openFolder,
  fitWindowToContent
});

export { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
