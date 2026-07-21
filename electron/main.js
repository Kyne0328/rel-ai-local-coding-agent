const { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, powerSaveBlocker, Notification, dialog } = require('electron');
const path = require('node:path');
const { resolveResourcePath } = require('./resource-path');
const { isPortAvailable, normalizeWizardConfig, saveLauncherConfig } = require('./launcher-config');
const { fitWindowToContent, WINDOW_SIZE_LIMITS } = require('./window-size');
const { registerIpcHandlers } = require('./ipc-handlers');
const { runInstalledSmoke, writeInstalledSmokeFailure } = require('./installed-smoke');
const { runWindowSmoke } = require('./window-smoke');
const { createTaskActivityRuntime } = require('./tool-sleep-blocker');
const { createDashboardWindowManager } = require('./dashboard-window');
const { createDesktopTray } = require('./desktop-tray');
const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');
app.setName('Rel.AI MCP');
if (process.platform === 'win32') app.setAppUserModelId('com.relai.mcp');
const srcPath = resolveResourcePath('src');
const connection = require(path.join(srcPath, 'connectionProfile'));
const toolActivity = require(path.join(srcPath, 'toolActivity'));
const dashboardSessions = require(path.join(srcPath, 'http', 'dashboardSessions'));
const configModule = require(path.join(srcPath, 'config'));
const { startHttpServer } = require(path.join(srcPath, 'httpServer'));
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

let wizardWindow = null;
let statusWindow = null;
let httpServer = null;
let tunnelProcess = null;
let startPromise = null;
let lifecycleToken = 0;
let isQuitting = false;
const BASE_STATUS = {
  serverRunning: false,
  tunnelStatus: 'stopped',
  mcpUrl: '',
  error: '',
  localUrl: '',
  version: app.getVersion(),
  taskActivity: { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], workspace: '', tool: '', startedAt: null, lastTask: null }
};
let currentStatus = { ...BASE_STATUS };
const dashboardWindowManager = createDashboardWindowManager({
  BrowserWindow,
  shell,
  app,
  dialog,
  getConnection: buildDashboardConnection,
  isQuitting: () => isQuitting,
  onError: error => setStatus({ error: formatError(error) })
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
  showRecovery: showStatusWindow,
  openSettings: openSettingsWindow,
  startServer,
  stopServer,
  quit: quitApplication,
  onError: error => setStatus({ error: formatError(error) })
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
        await runWindowSmoke();
        app.exit(0);
      } catch (error) {
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
    desktopTray.setup();
    if (hasExistingConfig()) void launchConfiguredDesktop();
    else createWizardWindow();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  toolActivityRuntime.stop();
  dashboardWindowManager.close();
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

  wizardWindow = new BrowserWindow({
    width: WINDOW_SIZE_LIMITS.wizard.minWidth,
    height: 620,
    minWidth: WINDOW_SIZE_LIMITS.wizard.minWidth,
    minHeight: WINDOW_SIZE_LIMITS.wizard.minHeight,
    resizable: false,
    useContentSize: true,
    parent: options.parent || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: options.edit ? 'Rel.AI MCP - Settings' : 'Rel.AI MCP - Setup',
    autoHideMenuBar: true
  });

  const loadOptions = options.query ? { query: options.query } : undefined;
  wizardWindow.loadFile(path.join(__dirname, 'renderer', options.edit ? 'settings.html' : 'wizard.html'), loadOptions);
  wizardWindow.webContents.on('did-finish-load', () => {
    fitWindowToContent(wizardWindow, { type: 'wizard' });
  });
  wizardWindow.on('closed', () => {
    wizardWindow = null;
  });
  return wizardWindow;
}

function createStatusWindow() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.show();
    statusWindow.focus();
    pushStatus();
    return statusWindow;
  }

  statusWindow = new BrowserWindow({
    width: WINDOW_SIZE_LIMITS.status.minWidth,
    height: 620,
    minWidth: WINDOW_SIZE_LIMITS.status.minWidth,
    minHeight: WINDOW_SIZE_LIMITS.status.minHeight,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'Rel.AI MCP',
    autoHideMenuBar: true
  });

  statusWindow.loadFile(path.join(__dirname, 'renderer', 'status.html'));
  statusWindow.webContents.on('did-finish-load', () => {
    pushStatus();
  });
  statusWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    statusWindow.hide();
  });
  statusWindow.on('closed', () => {
    statusWindow = null;
  });
  return statusWindow;
}

function showStatusWindow() {
  const dashboardWindow = dashboardWindowManager.getWindow();
  if (dashboardWindow) dashboardWindow.hide();
  const win = createStatusWindow();
  win.show();
  win.focus();
}

function focusActiveWindow() {
  const dashboardWindow = dashboardWindowManager.getWindow();
  if (dashboardWindow && dashboardWindow.isVisible()) {
    dashboardWindow.show(); dashboardWindow.focus(); return;
  }
  if (statusWindow && !statusWindow.isDestroyed() && statusWindow.isVisible()) {
    statusWindow.show(); statusWindow.focus(); return;
  }
  if (dashboardWindow) {
    dashboardWindow.show(); dashboardWindow.focus(); return;
  }
  showStatusWindow();
}

function pushStatus() {
  if (statusWindow && !statusWindow.isDestroyed()) statusWindow.webContents.send('server:status', currentStatus);
  const dashboardWindow = dashboardWindowManager.getWindow();
  if (dashboardWindow) dashboardWindow.webContents.send('server:status', currentStatus);
  desktopTray.update();
}

function setStatus(next) {
  currentStatus = { ...currentStatus, ...next };
  pushStatus();
}

async function startServer(options = {}) {
  if (httpServer?.listening) {
    if (options.openDashboard) await showDashboardWindow();
    pushStatus();
    return currentStatus;
  }
  if (startPromise) {
    if (options.openDashboard && httpServer?.listening) await showDashboardWindow();
    return startPromise;
  }
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
      setStatus({ serverRunning: false, tunnelStatus: 'failed', mcpUrl: '', error: formatError(error) });
      startPromise = null;
      return currentStatus;
    }

    const available = await isPortAvailable(guiConfig.port);
    if (!available) {
      setStatus({
        serverRunning: false,
        tunnelStatus: 'failed',
        mcpUrl: '',
        error: `Port ${guiConfig.port} is already in use.`
      });
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
        resetTaskActivity: toolActivityRuntime.resetHistory
      });
      actualPort = await new Promise((resolve, reject) => {
        httpServer.once('listening', () => resolve(httpServer.address().port));
        httpServer.once('error', reject);
      });
    } catch (error) {
      httpServer = null;
      setStatus({ serverRunning: false, tunnelStatus: 'failed', mcpUrl: '', error: formatError(error) });
      startPromise = null;
      return currentStatus;
    }

    setStatus({
      serverRunning: true,
      tunnelStatus: 'connecting',
      mcpUrl: '',
      error: '',
      localUrl: `http://127.0.0.1:${actualPort}`
    });
    if (options.openDashboard) {
      try {
        await showDashboardWindow();
      } catch (error) {
        setStatus({ error: `Dashboard failed to open: ${formatError(error)}` });
        showStatusWindow();
      }
    }

    const tunnelLog = (chunk) => {
      if (statusWindow && !statusWindow.isDestroyed()) {
        statusWindow.webContents.send('server:log', String(chunk || '').trim());
      }
    };

    try {
      await managedNgrok.prepareManagedNgrok({
        authtoken: guiConfig.ngrokAuthtoken,
        onLog: tunnelLog
      });
    } catch (error) {
      setStatus({ serverRunning: true, tunnelStatus: 'failed', mcpUrl: '', error: formatError(error) });
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
      setStatus({ serverRunning: true, tunnelStatus: 'running', mcpUrl, error: '' });
    } else {
      setStatus({
        serverRunning: true,
        tunnelStatus: 'failed',
        mcpUrl: '',
        error: result.error || 'Tunnel failed before publishing a public URL.'
      });
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

  dashboardWindowManager.close();
  dashboardSessions.clearDashboardSessions();
  currentStatus = { ...BASE_STATUS };
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

async function showDashboardWindow() {
  await dashboardWindowManager.open();
  if (statusWindow && !statusWindow.isDestroyed()) statusWindow.hide();
}

async function openDashboardWindow() {
  if (!httpServer?.listening) await startServer({ openDashboard: true });
  else await showDashboardWindow();
  if (!httpServer?.listening) throw new Error(currentStatus.error || 'Rel.AI local service is not running.');
  return { ok: true };
}

async function launchConfiguredDesktop(options = {}) {
  try {
    if (options.restart) stopServer({ silent: true });
    const status = await startServer({ openDashboard: true });
    if (!status.serverRunning) showStatusWindow();
    return status;
  } catch (error) {
    setStatus({ serverRunning: false, tunnelStatus: 'failed', error: formatError(error) });
    showStatusWindow();
    return currentStatus;
  }
}

function quitApplication() {
  isQuitting = true;
  stopServer({ silent: true });
  app.exit(0);
}

function openSettingsWindow() {
  let config;
  try {
    config = readGuiConfig();
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] read gui config:', error);
    config = { port: 3333, token: '', ngrokDomain: '', ngrokAuthtoken: '' };
  }
  createWizardWindow({
    edit: true,
    parent: dashboardWindowManager.getWindow() || statusWindow || undefined,
    query: {
      edit: '1',
      port: String(config.port || 3333),
      token: config.token || '',
      ngrokToken: config.ngrokAuthtoken || '',
      domain: config.ngrokDomain || ''
    }
  });
}

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
  closeWizard: () => {
    if (wizardWindow && !wizardWindow.isDestroyed()) wizardWindow.destroy();
    wizardWindow = null;
  },
  getStatusWindow: () => statusWindow,
  startServer,
  stopServer,
  launchConfiguredDesktop,
  openSettingsWindow,
  openDashboardWindow,
  showStatusWindow,
  getCurrentStatus: () => currentStatus,
  getNotificationsEnabled: toolActivityRuntime.getNotificationsEnabled,
  setNotificationsEnabled: toolActivityRuntime.setNotificationsEnabled,
  fitWindowToContent
});

module.exports = { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
