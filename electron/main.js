const { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage } = require('electron');
const path = require('node:path');
const { resolveResourcePath } = require('./resource-path');
const { isPortAvailable, normalizeWizardConfig, saveLauncherConfig } = require('./launcher-config');
const { fitWindowToContent } = require('./window-size');
const { registerIpcHandlers } = require('./ipc-handlers');

const srcPath = resolveResourcePath('src');
const connection = require(path.join(srcPath, 'connectionProfile'));
const configModule = require(path.join(srcPath, 'config'));
const { startHttpServer } = require(path.join(srcPath, 'httpServer'));
const tunnelManager = require(path.join(srcPath, 'tunnelManager'));
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
let tray = null;
let httpServer = null;
let tunnelProcess = null;
let startPromise = null;
let lifecycleToken = 0;
let isQuitting = false;
let currentStatus = {
  serverRunning: false,
  tunnelStatus: 'stopped',
  mcpUrl: '',
  error: ''
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.show();
      statusWindow.focus();
      return;
    }
    if (wizardWindow && !wizardWindow.isDestroyed()) {
      wizardWindow.show();
      wizardWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (hasExistingConfig()) {
      createStatusWindow();
      startServer();
    } else {
      createWizardWindow();
    }
  });
}

app.on('before-quit', () => {
  isQuitting = true;
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
  wizardWindow.loadFile(path.join(__dirname, 'renderer', 'wizard.html'), loadOptions);
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
  setupTray();
  return statusWindow;
}

function pushStatus() {
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send('server:status', currentStatus);
  }
  updateTrayMenu();
}

function setStatus(next) {
  currentStatus = { ...currentStatus, ...next };
  pushStatus();
}

function setupTray() {
  if (tray) return;
  // Use the same logo as the dashboard (build/icon.png), resized for the tray.
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const raw = nativeImage.createFromPath(iconPath);
  const image = raw.isEmpty() ? raw : raw.resize({ width: 32, height: 32 });
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Rel.AI MCP');
  tray.on('double-click', () => {
    const win = createStatusWindow();
    win.show();
    win.focus();
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const statusLabel = currentStatus.serverRunning ? 'Server: running' : 'Server: stopped';
  const menu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { label: `Tunnel: ${currentStatus.tunnelStatus || 'stopped'}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Copy MCP URL',
      enabled: Boolean(currentStatus.mcpUrl),
      click: () => {
        if (currentStatus.mcpUrl) clipboard.writeText(currentStatus.mcpUrl);
      }
    },
    {
      label: 'Open Dashboard',
      click: () => openDashboardUrl()
    },
    {
      label: currentStatus.serverRunning ? 'Stop Server' : 'Start Server',
      click: () => {
        if (currentStatus.serverRunning) stopServer();
        else startServer();
      }
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        const win = createStatusWindow();
        win.show();
        win.focus();
      }
    },
    {
      label: 'Settings',
      click: () => openSettingsWindow()
    },
    {
      label: 'Stop and Quit',
      click: () => {
        isQuitting = true;
        stopServer({ silent: true });
        app.exit(0);
      }
    }
  ]);
  tray.setContextMenu(menu);
}

async function startServer() {
  if (httpServer) {
    pushStatus();
    return currentStatus;
  }
  if (startPromise) return startPromise;

  const runToken = ++lifecycleToken;
  startPromise = (async () => {
    let guiConfig;
    try {
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
        // Native folder picker for the dashboard "Browse" buttons. Runs in the main
        // process; the dashboard reaches it via POST /api/pick-folder.
        pickFolder: async () => {
          const { dialog } = require('electron');
          // The dashboard runs in the external browser, so this dialog has no natural
          // parent window. Parentless, Windows refuses to pull the background Electron
          // app to the foreground — it shows the dialog behind the browser and flashes
          // the taskbar instead. Spawn a hidden, focusable anchor window, force the app
          // foreground, and parent the modal dialog to it so it opens on top.
          const anchor = new BrowserWindow({
            width: 1,
            height: 1,
            show: false,
            frame: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            focusable: true
          });
          try {
            anchor.showInactive();
            anchor.moveTop();
            app.focus({ steal: true });
            anchor.focus();
            const result = await dialog.showOpenDialog(anchor, {
              title: 'Select workspace folder',
              properties: ['openDirectory']
            });
            return result && !result.canceled && result.filePaths?.[0] ? result.filePaths[0] : null;
          } finally {
            if (!anchor.isDestroyed()) anchor.destroy();
          }
        }
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

    setStatus({ serverRunning: true, tunnelStatus: 'connecting', mcpUrl: '', error: '' });

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
      if (result.process) tunnelManager.killProcess(result.process);
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
    tunnelManager.killProcess(tunnelProcess);
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

  currentStatus = { serverRunning: false, tunnelStatus: 'stopped', mcpUrl: '', error: '' };
  if (!options.silent) pushStatus();
  else updateTrayMenu();
  return currentStatus;
}

function openDashboardUrl() {
  try {
    // Use the actual bound port from the in-memory server object — this is always authoritative.
    // Fallback to guiConfig only when the server isn't running (e.g. user clicks Dashboard early).
    const port = (httpServer?.listening && httpServer.address()?.port)
      || readGuiConfig().port
      || 3333;
    const token = connection.readLaunchEnv().REL_AI_MCP_TOKEN || readGuiConfig().token || '';
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    shell.openExternal(`http://127.0.0.1:${port}/dashboard${tokenQuery}`);
  } catch (error) {
    setStatus({ error: formatError(error) });
  }
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
    parent: statusWindow || undefined,
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
  createStatusWindow,
  startServer,
  stopServer,
  openSettingsWindow,
  openDashboardUrl,
  fitWindowToContent
});

module.exports = { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
