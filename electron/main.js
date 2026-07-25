const { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, powerSaveBlocker, Notification, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const { resolveResourcePath } = require('./resource-path');
const { isPortAvailable, normalizeWizardConfig, saveLauncherConfig } = require('./launcher-config');
const { fitWindowToContent, WINDOW_SIZE_LIMITS } = require('./window-size');
const { localWindowWebPreferences, secureLocalWindow } = require('./window-security');
const { registerIpcHandlers } = require('./ipc-handlers');
const { runInstalledSmoke, writeInstalledSmokeFailure } = require('./installed-smoke'); const { runWindowSmoke } = require('./window-smoke'); const { writeWindowSmokeFailure } = require('./smoke-evidence');
const { createTaskActivityRuntime } = require('./tool-sleep-blocker');
const { createDashboardWindowManager } = require('./dashboard-window');
const { createDesktopTray } = require('./desktop-tray');
const { createDesktopStatusModel } = require('./desktop-status');
const { createApprovalTokenManager } = require('./approval-token');
const { createRecoveryWindowManager } = require('./recovery-window');
const { createRuntimeLogBuffer } = require('./runtime-log-buffer'); const { createDiagnosticFiles } = require('./diagnostic-files');
const { createDesktopSettingsManager } = require('./desktop-settings'); const { createAppUpdater } = require('./app-updater'); const { createDesktopLifecycleManager } = require('./desktop-lifecycle');
const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');
app.setName('Rel.AI MCP'); if (process.platform === 'win32') app.setAppUserModelId('com.relai.mcp');
const srcPath = resolveResourcePath('src');
const connection = require(path.join(srcPath, 'connectionProfile'));
const toolActivity = require(path.join(srcPath, 'toolActivity'));
const dashboardSessions = require(path.join(srcPath, 'http', 'dashboardSessions'));
const configModule = require(path.join(srcPath, 'config')); const diagnosticsModule = require(path.join(srcPath, 'diagnostics'));
const { ERROR_CODES, deriveConnectionState } = require(path.join(srcPath, 'desktopUxContracts'));
const oauthProvider = require(path.join(srcPath, 'oauthProvider')); const { startHttpServer } = require(path.join(srcPath, 'httpServer'));
const { killProcess } = require(path.join(srcPath, 'processKill'));
const managedNgrok = require('./managed-ngrok');
const {
  hasExistingConfig,
  readGuiConfig,
  buildTunnelCommand,
  buildMcpUrl,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  normalizePort
} = require('./launcher-utils');
let wizardWindow = null, wizardRecoveryMode = false, wizardReturnToFallback = false;
let httpServer = null, tunnelProcess = null, startPromise = null;
let lifecycleToken = 0, isQuitting = false, appUpdater = null; const smokeWindowRoles = new WeakMap();
const desktopStatusModel = createDesktopStatusModel({ version: app.getVersion(), deriveConnectionState, formatError });
const diagnosticFiles = createDiagnosticFiles({ app, shell, sanitizeDiagnosticValue: diagnosticsModule.sanitizeDiagnosticValue }); let currentStatus = desktopStatusModel.initial(); const runtimeLogs = createRuntimeLogBuffer({ filePath: () => diagnosticFiles.serviceLogPath() });
const approvalTokenManager = createApprovalTokenManager({ readGuiConfig, saveLauncherConfig, generateToken: connection.generateToken, oauthProvider, restartDesktop: () => launchConfiguredDesktop({ restart: true }) });
const recoveryWindowManager = createRecoveryWindowManager({
  BrowserWindow,
  preloadPath: path.join(__dirname, 'preload.js'),
  rendererPath: path.join(__dirname, 'renderer', 'status.html'),
  limits: WINDOW_SIZE_LIMITS.status,
  isQuitting: () => isQuitting,
  onReady: pushStatus,
  onSecurityError: error => runtimeLogs.append(error.message, { level: 'warning', source: 'electron-security' })
});
const dashboardWindowManager = createDashboardWindowManager({
  BrowserWindow,
  shell,
  app,
  dialog,
  getConnection: buildDashboardConnection,
  isQuitting: () => isQuitting,
  onError: error => setStatus({ error: formatError(error), errorCode: ERROR_CODES.UNKNOWN }),
  onLoadError: error => {
    setStatus({ error: formatError(error), errorCode: ERROR_CODES.DASHBOARD_UNAVAILABLE });
    recoveryWindowManager.show();
  }
});
const desktopTray = createDesktopTray({
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
  toolActivity,
  powerSaveBlocker,
  Notification,
  iconPath: APP_ICON_PATH,
  isReady: () => app.isReady(),
  onNotificationClick: focusActiveWindow,
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
  errorCodes: ERROR_CODES });
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.show();
      wizardWindow.focus();
      return;
    }
    focusActiveWindow();
  });

  app.whenReady().then(async () => {
    if (process.argv.includes('--window-smoke')) {
      try {
        await runWindowSmoke({ registerWindowRole: (window, role) => smokeWindowRoles.set(window, role) });
        app.exit(0);
      } catch (error) {
        writeWindowSmokeFailure(error);
        console.error(`[rel-ai-mcp] window smoke failed: ${formatError(error)}`);
        app.exit(1);
      }
      return;
    }
    if (process.argv.includes('--installed-smoke')) {
      try {
        await runInstalledSmoke(app);
        app.exit(0);
      } catch (error) {
        writeInstalledSmokeFailure(error);
        console.error(`[rel-ai-mcp] installed smoke failed: ${formatError(error)}`);
        app.exit(1);
      }
      return;
    }
    const lifecycleStatus = desktopLifecycle.start();
    desktopTray.setup();
    appUpdater.start();
    if (hasExistingConfig()) void launchConfiguredDesktop({ background: lifecycleStatus.openedAtLogin });
    else createWizardWindow();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  desktopLifecycle.markCleanShutdown();
  appUpdater?.stop();
  toolActivityRuntime.stop();
  dashboardWindowManager.close();
  recoveryWindowManager.close();
  stopServer({ silent: true });
});

app.on('window-all-closed', () => {
  // Keep the tray app alive after all windows are hidden or closed.
});

function createWizardWindow(options = {}) {
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.show();
    wizardWindow.focus();
    return wizardWindow;
  }

  wizardRecoveryMode = options.recovery === true;
  wizardReturnToFallback = wizardRecoveryMode;
  const wizardRenderer = path.join(__dirname, 'renderer', 'wizard.html');
  wizardWindow = new BrowserWindow({
    width: WINDOW_SIZE_LIMITS.wizard.minWidth,
    height: 620,
    minWidth: WINDOW_SIZE_LIMITS.wizard.minWidth,
    minHeight: WINDOW_SIZE_LIMITS.wizard.minHeight,
    resizable: false,
    useContentSize: true,
    webPreferences: localWindowWebPreferences(path.join(__dirname, 'preload.js'), 'relai-setup'),
    title: wizardRecoveryMode ? 'Rel.AI MCP - Connection Recovery' : 'Rel.AI MCP - Setup',
    autoHideMenuBar: true
  });
  secureLocalWindow(wizardWindow, { allowedFile: wizardRenderer, onError: error => runtimeLogs.append(error.message, { level: 'warning', source: 'electron-security' }) });

  const loadOptions = wizardRecoveryMode ? { query: { recovery: '1' } } : undefined;
  wizardWindow.loadFile(wizardRenderer, loadOptions);
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
  return {
    ok: true,
    port: settings.port,
    token,
    ngrokDomain: settings.ngrokDomain,
    ngrokAuthtoken: settings.ngrokAuthtoken
  };
}

function openRecoverySetup() {
  recoveryWindowManager.hide();
  createWizardWindow({ recovery: true });
  return { ok: true };
}

function focusActiveWindow() {
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

function pushUpdateStatus(status) {
  dashboardWindowManager.getWindow()?.webContents.send('desktop:update-status', status);
  desktopTray.update();
}

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

    setStatus({ serverRunning: true, tunnelStatus: 'connecting', mcpUrl: '', authenticationRequired: approvalTokenManager.status().required, error: '', errorCode: '', localUrl: `http://127.0.0.1:${actualPort}` });

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
      if (result.process) killProcess(result.process);
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

function stopServer(options = {}) {
  if (tunnelProcess) {
    killProcess(tunnelProcess);
  }
  tunnelProcess = null;

  if (httpServer) {
    try {
      httpServer.close();
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] server close:', error);
    }
  }
  httpServer = null;
  startPromise = null;
  lifecycleToken += 1;

  if (!options.preserveDashboard) dashboardWindowManager.close();
  dashboardSessions.clearDashboardSessions();
  currentStatus = desktopStatusModel.initial();
  if (!options.silent) pushStatus();
  else desktopTray.update();
  return currentStatus;
}

function buildDashboardConnection() {
  const port = (httpServer?.listening && httpServer.address()?.port) || readGuiConfig().port || 3333;
  const token = connection.readLaunchEnv().REL_AI_MCP_TOKEN || readGuiConfig().token || '';
  const bootstrap = dashboardSessions.createDashboardBootstrap(token);
  return { url: `http://127.0.0.1:${port}/dashboard?surface=desktop&bootstrap=${encodeURIComponent(bootstrap)}` };
}

async function showDashboardWindow(routeHash = '') {
  await dashboardWindowManager.open(routeHash);
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
    if (options.restart) stopServer({ silent: true, preserveDashboard: true });
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

function quitApplication() {
  isQuitting = true;
  desktopLifecycle.markCleanShutdown();
  appUpdater?.stop();
  stopServer({ silent: true });
  app.exit(0);
}

function openSettingsWindow() { return openDashboardSettings(); }

function formatError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

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
  getSmokeWindowRole: window => process.argv.includes('--window-smoke') ? smokeWindowRoles.get(window) || '' : '', fitWindowToContent
});

module.exports = { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
