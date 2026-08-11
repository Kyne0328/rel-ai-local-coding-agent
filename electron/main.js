import { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, powerSaveBlocker, Notification, dialog, screen, protocol, safeStorage, systemPreferences } from 'electron';
import electronUpdater from 'electron-updater';
import * as os from 'node:os';
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
import { desktopStatusFailure, gatewayAuthorizationRequired, initialDesktopStatus, normalizeDesktopStatus, safeGatewayDesktopStatus } from './desktop-status.js';
import { createApprovalTokenManager } from './approval-token.js';
import { createRecoveryWindowManager } from './recovery-window.js';
import { createRuntimeLogBuffer } from './runtime-log-buffer.js';
import { createDiagnosticFiles } from './diagnostic-files.js';
import { readDesktopSettings, saveDesktopSettings } from './desktop-settings.js';
import { createAppUpdater } from './app-updater.js';
import { createUpdateSupportPolicy } from './update-support-policy.js';
import { createDesktopLifecycleManager } from './desktop-lifecycle.js';
import { createDesktopNotifications } from './desktop-notifications.js';
import { closeHttpServer, createShutdownCoordinator } from './shutdown-coordinator.js';
import { STARTUP_BACKGROUND_COLOR } from './startup-background.js';
import { removeControllerRuntimeMarker, writeControllerRuntimeMarker } from './controller-runtime.js';
import * as managedNgrok from './managed-ngrok.js';
import { createGatewayClient } from './gateway-client.js';
import { configureGatewaySafeStorage, createGatewayDeviceIdentityStore } from './gateway-device-identity.js';
import { createPublicConnectionRuntime } from './public-connection-runtime.js';
import { hasExistingConfig, readGuiConfig, buildMcpUrl, normalizeNgrokDomain, normalizeNgrokAuthtoken, normalizePort } from './launcher-utils.js';
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
const { shutdownTelemetry } = await importResourceModule('src/telemetry.js');let wizardWindow = null, wizardRecoveryMode = false, wizardReturnToFallback = false;
let httpServer = null, startPromise = null;
let lifecycleToken = 0, isQuitting = false, appUpdater = null, updateSupportPolicy = null;
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
  startDirect: config => managedNgrok.startManagedNgrokTunnel({
    domain: config.ngrokDomain,
    port: config.port,
    timeoutMs: 30000,
    onLog: chunk => publicConnectionLog('ngrok', chunk)
  }),
  stopDirect: child => terminateProcessTree(child, { graceMs: 1000, forceWaitMs: 2000 }),
  onStatus: ({ mode, status }) => {
    if (mode === 'cloud') applyGatewayStatus(status);
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
  currentStatus = normalizeDesktopStatus({ ...currentStatus, ...next }); desktopNotifications.handleDesktopStatusChange(previous, currentStatus); runtimeLogs.recordStatusTransition(previous, currentStatus); pushStatus(options);
}

function gatewayStatusForDashboard() {
  let config = {};
  try { config = readGuiConfig(); } catch {}
  const raw = publicConnectionRuntime.gatewaySnapshot() || currentStatus.gateway || {};
  return {
    ok: true,
    connectionMode: String(config.connectionMode || currentStatus.connectionMode || ''),
    gateway: safeGatewayDesktopStatus(raw, config.gatewayOrigin || raw.gatewayOrigin || '')
  };
}

async function beginGatewayPairing(options = {}) {
  const pairing = await publicConnectionRuntime.gatewayCall('beginPairing', options);
  return { ok: true, pairing };
}

function cancelGatewayPairing() {
  const status = publicConnectionRuntime.gatewayCall('cancelPairing');
  return { ok: true, gateway: safeGatewayDesktopStatus(status, readGuiConfig().gatewayOrigin) };
}

async function listGatewayDevices() {
  const devices = await publicConnectionRuntime.gatewayCall('listDevices');
  return { ok: true, devices: Array.isArray(devices) ? devices.map(safeGatewayDevice) : [] };
}

async function revokeGatewayDevice(deviceId) {
  const result = await publicConnectionRuntime.gatewayCall('revokeDevice', deviceId);
  return { ok: result?.ok === true, deviceId: String(result?.deviceId || deviceId), selfRevoked: result?.selfRevoked === true };
}

async function setGatewayMode(mode) {
  const current = readGuiConfig();
  saveLauncherConfig({
    connectionMode: mode,
    gatewayOrigin: current.gatewayOrigin,
    port: current.port,
    token: current.token,
    ngrokDomain: current.ngrokDomain,
    ngrokAuthtoken: current.ngrokAuthtoken
  });
  const status = await launchConfiguredDesktop({ restart: true });
  if (!status.serverRunning) throw new Error(status.error || 'Rel.AI connection mode could not be restarted.');
  return { ok: true, connectionMode: mode, status: gatewayStatusForDashboard() };
}

async function getGatewayRecovery() {
  await gatewayDeviceIdentity.open();
  const principal = gatewayDeviceIdentity.principalState();
  if (!principal.principalId || !principal.recoverySecret) throw new Error('No paired Rel.AI recovery code is available on this device.');
  return { ok: true, recoveryCode: formatRecoveryCode(principal.principalId, principal.recoverySecret) };
}

async function ensureWizardCloudRuntime() {
  let current = {};
  try { current = readGuiConfig(); } catch {}
  saveLauncherConfig({
    connectionMode: 'cloud',
    gatewayOrigin: current.gatewayOrigin,
    port: current.port || 3333,
    token: current.token,
    ngrokDomain: current.ngrokDomain,
    ngrokAuthtoken: current.ngrokAuthtoken
  });
  const runtime = publicConnectionRuntime.snapshot();
  const restart = Boolean(httpServer?.listening && runtime.mode !== 'cloud');
  const status = await launchConfiguredDesktop({ restart, background: true });
  if (!status.serverRunning || publicConnectionRuntime.snapshot().mode !== 'cloud') {
    throw new Error(status.error || 'Rel.AI Cloud could not be started.');
  }
  return status;
}

async function startWizardCloudPairing(options = {}) {
  await ensureWizardCloudRuntime();
  return beginGatewayPairing(options);
}

async function recoverWizardCloudIdentity(recoveryCode) {
  const code = String(recoveryCode || '').trim();
  if (!code || code.length > 8192) throw new Error('A valid Rel.AI recovery code is required.');
  return startWizardCloudPairing({ recoveryCode: code });
}

function getWizardCloudStatus() {
  return gatewayStatusForDashboard();
}

function cancelWizardCloudPairing() {
  return cancelGatewayPairing();
}

async function getWizardRecoveryCode() {
  return getGatewayRecovery();
}

async function createWizardDeviceLink() {
  await gatewayDeviceIdentity.open();
  const principal = gatewayDeviceIdentity.principalState();
  if (!principal.principalId) throw new Error('Pair this device with Rel.AI Cloud before creating a link code.');
  const result = await publicConnectionRuntime.gatewayCall('createDeviceLink');
  if (!result?.ok || !result.linkCode) throw new Error('A one-time device link code could not be created.');
  return {
    ok: true,
    linkCode: formatDeviceLinkCode(principal.principalId, result.linkCode),
    expiresAt: Number(result.expiresAt || 0)
  };
}

async function getGatewayUsage(month) {
  try {
    const usage = await publicConnectionRuntime.gatewayCall('requestUsage', month);
    return { ok: true, ...usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/gateway is not connected|rel\.ai cloud is not connected/i.test(message)) {
      return { ok: false, errorCode: 'GATEWAY_NOT_CONNECTED', error: 'Rel.AI Cloud is not connected.' };
    }
    throw error;
  }
}

function safeGatewayDevice(device = {}) {
  return {
    deviceId: String(device.deviceId || ''),
    displayName: String(device.displayName || ''),
    appVersion: String(device.appVersion || ''),
    protocolVersion: Number(device.protocolVersion || 0),
    mcpProtocolVersion: String(device.mcpProtocolVersion || ''),
    capabilities: device.capabilities && typeof device.capabilities === 'object' ? { ...device.capabilities } : {},
    lastSeenAt: device.lastSeenAt == null ? null : Number(device.lastSeenAt),
    revokedAt: device.revokedAt == null ? null : Number(device.revokedAt)
  };
}

function publicConnectionLog(source, chunk) {
  const entry = runtimeLogs.append(chunk, { source });
  if (entry) recoveryWindowManager.sendLog(entry);
}

function applyGatewayStatus(status = {}) {
  const gateway = safeGatewayDesktopStatus(status, status.gatewayOrigin);
  const mcpUrl = gateway.gatewayOrigin ? buildMcpUrl(gateway.gatewayOrigin) : '';
  dashboardWindowManager.getWindow()?.webContents.send('desktop:gateway-status', gateway);
  if (gateway.state === 'connected') {
    setStatus({
      connectionMode: 'cloud',
      gateway,
      tunnelStatus: 'running',
      mcpUrl,
      authenticationRequired: false,
      error: '',
      errorCode: ''
    }, { dashboard: false });
    return;
  }
  if (gateway.state === 'pairing_required' || gateway.state === 'pairing') {
    setStatus({
      connectionMode: 'cloud',
      gateway,
      tunnelStatus: 'running',
      mcpUrl,
      authenticationRequired: true,
      error: '',
      errorCode: ''
    }, { dashboard: false });
    return;
  }
  if (gateway.state === 'device_update_required' || gateway.state === 'error') {
    setStatus(desktopStatusFailure(
      ERROR_CODES.PUBLIC_ENDPOINT_FAILED,
      gateway.error || (gateway.state === 'device_update_required' ? 'Rel.AI Desktop must be updated for the gateway protocol.' : 'Rel.AI gateway connection failed.'),
      { connectionMode: 'cloud', gateway, serverRunning: true, tunnelStatus: 'failed', mcpUrl, authenticationRequired: false }
    ), { dashboard: false });
    return;
  }
  setStatus({
    connectionMode: 'cloud',
    gateway,
    tunnelStatus: 'connecting',
    mcpUrl,
    authenticationRequired: gatewayAuthorizationRequired(gateway),
    error: '',
    errorCode: ''
  }, { dashboard: false });
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
      if (guiConfig.connectionMode === 'direct') {
        guiConfig.ngrokDomain = normalizeNgrokDomain(guiConfig.ngrokDomain || '');
        guiConfig.ngrokAuthtoken = normalizeNgrokAuthtoken(guiConfig.ngrokAuthtoken || '');
      }
      if (!guiConfig.token) {
        guiConfig.token = connection.generateToken(32);
        connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: guiConfig.token });
      }
    } catch (error) {
      setStatus(desktopStatusFailure(ERROR_CODES.CONFIGURATION_INVALID, error, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    const available = await isPortAvailable(guiConfig.port);
    if (!available) {
      setStatus(desktopStatusFailure(ERROR_CODES.LOCAL_PORT_IN_USE, `Port ${guiConfig.port} is already in use.`, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    let actualPort;
    try {
      httpServer = startHttpServer({
        host: '127.0.0.1',
        port: guiConfig.port,
        token: guiConfig.token,
        publicUrl: guiConfig.connectionMode === 'direct' ? `https://${guiConfig.ngrokDomain}` : '',
        exitOnError: false,
        pickFolder: () => dashboardWindowManager.pickFolder(),
        openFolder: folderPath => dashboardWindowManager.openFolder(folderPath),
        getTaskActivity: toolActivityRuntime.getStatus, getDesktopStatus: () => currentStatus, getRuntimeAccess: updateRuntimeAccess,
        resetTaskActivity: toolActivityRuntime.resetHistory, getRuntimeLogs: runtimeLogs.snapshot, clearRuntimeLogs: runtimeLogs.clear,
        onOAuthAuthorized: () => {
          if (guiConfig.connectionMode === 'direct') setStatus({ authenticationRequired: false, error: '', errorCode: '' });
        }
      });
      actualPort = await new Promise((resolve, reject) => {
        httpServer.once('listening', () => resolve(httpServer.address().port));
        httpServer.once('error', reject);
      });
    } catch (error) {
      httpServer = null;
      setStatus(desktopStatusFailure(ERROR_CODES.LOCAL_SERVICE_START_FAILED, error, { serverRunning: false, tunnelStatus: 'failed', mcpUrl: '' }));
      startPromise = null;
      return currentStatus;
    }

    const localUrl = `http://127.0.0.1:${actualPort}`;
    const initialMcpUrl = guiConfig.connectionMode === 'cloud' ? buildMcpUrl(guiConfig.gatewayOrigin) : '';
    setStatus({
      serverRunning: true,
      connectionMode: guiConfig.connectionMode,
      gateway: guiConfig.connectionMode === 'cloud' ? safeGatewayDesktopStatus({ state: 'connecting', gatewayOrigin: guiConfig.gatewayOrigin }, guiConfig.gatewayOrigin) : null,
      tunnelStatus: 'connecting',
      mcpUrl: initialMcpUrl,
      authenticationRequired: guiConfig.connectionMode === 'cloud' ? false : approvalTokenManager.status().required,
      error: '',
      errorCode: '',
      localUrl
    });

    let result;
    try {
      result = await publicConnectionRuntime.start({ ...guiConfig, port: actualPort });
    } catch (error) {
      setStatus(desktopStatusFailure(ERROR_CODES.PUBLIC_ENDPOINT_FAILED, error, {
        serverRunning: true,
        connectionMode: guiConfig.connectionMode,
        tunnelStatus: 'failed',
        mcpUrl: guiConfig.connectionMode === 'cloud' ? initialMcpUrl : ''
      }));
      startPromise = null;
      return currentStatus;
    }

    if (runToken !== lifecycleToken) {
      await publicConnectionRuntime.stop().catch(() => {});
      startPromise = null;
      return currentStatus;
    }

    if (guiConfig.connectionMode === 'cloud') {
      connection.writeConnectionProfile({
        host: '127.0.0.1',
        port: actualPort,
        connectionMode: 'cloud',
        gatewayOrigin: guiConfig.gatewayOrigin,
        publicUrl: '',
        tunnelProvider: 'rel-ai-gateway',
        configPath: configModule.getConfigPath()
      });
      if (result.status) applyGatewayStatus(result.status);
    } else if (result.ok) {
      const publicBaseUrl = `https://${guiConfig.ngrokDomain}`;
      const mcpUrl = buildMcpUrl(publicBaseUrl);
      connection.writeConnectionProfile({
        host: '127.0.0.1',
        port: actualPort,
        connectionMode: 'direct',
        gatewayOrigin: guiConfig.gatewayOrigin,
        publicUrl: publicBaseUrl,
        ngrokDomain: guiConfig.ngrokDomain,
        tunnelProvider: 'managed-ngrok',
        configPath: configModule.getConfigPath()
      });
      setStatus({ serverRunning: true, connectionMode: 'direct', gateway: null, tunnelStatus: 'running', mcpUrl, authenticationRequired: approvalTokenManager.status().required, error: '', errorCode: '' });
    } else {
      setStatus(desktopStatusFailure(ERROR_CODES.PUBLIC_ENDPOINT_FAILED, result.error || 'Tunnel failed before publishing a public URL.', { serverRunning: true, connectionMode: 'direct', gateway: null, tunnelStatus: 'failed', mcpUrl: '' }));
    }

    startPromise = null;
    return currentStatus;
  })();

  return startPromise;
}

async function stopServer(options = {}) {
  lifecycleToken += 1;
  const runtimeConfig = configModule.readConfig();
  const ownedServer = httpServer;
  httpServer = null;
  startPromise = null;

  const [managedProcesses, publicConnection, localService] = await Promise.all([
    stopAllManagedProcesses(runtimeConfig).catch(error => ({ attempted: 0, stopped: 0, orphaned: 1, error: formatError(error) })),
    publicConnectionRuntime.stop().catch(error => ({ mode: publicConnectionRuntime.snapshot().mode, stopped: false, exited: false, error: formatError(error) })),
    closeHttpServer(ownedServer)
  ]);

  if (!options.preserveDashboard) dashboardWindowManager.close();
  dashboardSessions.clearDashboardSessions();
  const previousStatus = currentStatus;
  currentStatus = initialDesktopStatus(app.getVersion());
  if (!options.silent) desktopNotifications.handleDesktopStatusChange(previousStatus, currentStatus);
  if (!options.silent) pushStatus();
  else desktopTray.update();
  const directExited = publicConnection.mode !== 'direct' || publicConnection.exited !== false;
  const publicStopped = publicConnection.stopped !== false;
  return {
    ...currentStatus,
    cleanup: {
      clean: managedProcesses.orphaned === 0 && publicStopped && directExited && localService.closed !== false,
      managedProcesses,
      publicConnection,
      tunnel: publicConnection.mode === 'direct' ? publicConnection : { exited: true, forced: false },
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
  getWizardWindow: () => wizardWindow,
  closeWizard,
  getFallbackWindow: recoveryWindowManager.getWindow,
  getDashboardWindow: dashboardWindowManager.getWindow,
  getDashboardWindowState: dashboardWindowManager.getState,
  minimizeDashboardWindow: dashboardWindowManager.minimize,
  toggleDashboardMaximize: dashboardWindowManager.toggleMaximize,
  requestDashboardClose: dashboardWindowManager.requestClose,
  getRecoveryConfig,
  startWizardCloudPairing,
  getWizardCloudStatus,
  cancelWizardCloudPairing,
  getWizardRecoveryCode,
  createWizardDeviceLink,
  recoverWizardCloudIdentity,
  openRecoverySetup,
  startServer,
  stopServer,
  launchConfiguredDesktop,
  openSettingsWindow,
  openDashboardWindow,
  getGatewayStatus: gatewayStatusForDashboard,
  beginGatewayPairing,
  cancelGatewayPairing,
  listGatewayDevices,
  revokeGatewayDevice,
  setGatewayMode,
  getGatewayRecovery,
  getGatewayUsage,
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
