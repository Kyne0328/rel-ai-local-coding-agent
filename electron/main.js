const { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, shell, nativeImage, screen } = require('electron');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

function resolveResourcePath(name) {
  const packagedPath = process.resourcesPath ? path.join(process.resourcesPath, name) : '';
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;
  return path.join(__dirname, '..', name);
}

const srcPath = resolveResourcePath('src');
const connection = require(path.join(srcPath, 'connectionProfile'));
const configModule = require(path.join(srcPath, 'config'));
const { startHttpServer } = require(path.join(srcPath, 'httpServer'));
const tunnelManager = require(path.join(srcPath, 'tunnelManager'));
const {
  hasExistingConfig,
  readGuiConfig,
  buildTunnelCommand,
  buildMcpUrl,
  normalizeNgrokDomain,
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

const WINDOW_SIZE_LIMITS = {
  wizard: {
    minWidth: 480,
    maxWidth: 720,
    minHeight: 420,
    maxHeight: 900,
    paddingWidth: 24,
    paddingHeight: 24
  },
  status: {
    minWidth: 440,
    maxWidth: 760,
    minHeight: 500,
    maxHeight: 940,
    paddingWidth: 20,
    paddingHeight: 20
  }
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
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const image = nativeImage.createFromPath(iconPath);
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

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function normalizeWizardConfig(config = {}) {
  const port = normalizePort(config.port || 3333);
  const ngrokDomain = normalizeNgrokDomain(config.ngrokDomain || config.domain || '');
  const token = String(config.token || '').trim() || connection.generateToken(32);
  const chatgptSecret = connection.resolveChatGPTSecret({ value: config.chatgptSecret || '' });
  return { port, ngrokDomain, token, chatgptSecret };
}

function saveLauncherConfig(config = {}) {
  const normalized = normalizeWizardConfig(config);
  const publicUrl = `https://${normalized.ngrokDomain}`;
  const tunnelCommand = buildTunnelCommand(normalized.ngrokDomain, normalized.port);

  connection.writeLaunchEnv({
    REL_AI_MCP_PORT: String(normalized.port),
    REL_AI_MCP_TOKEN: normalized.token,
    REL_AI_MCP_CHATGPT_SECRET: normalized.chatgptSecret,
    REL_AI_MCP_NGROK_DOMAIN: normalized.ngrokDomain,
    REL_AI_MCP_PUBLIC_URL: publicUrl,
    REL_AI_MCP_TUNNEL_COMMAND: tunnelCommand
  });

  // Do NOT write port here — port in connectionProfile must only come from the running server.
  // Writing wizard-configured port here would make readGuiConfig return the desired port
  // before the server has restarted, causing dashboard and ngrok to target the wrong port.
  connection.writeConnectionProfile({
    host: '127.0.0.1',
    publicUrl,
    ngrokDomain: normalized.ngrokDomain,
    tunnelProvider: 'custom',
    chatgptSecret: normalized.chatgptSecret,
    configPath: configModule.getConfigPath()
  });

  return normalized;
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
      if (!guiConfig.token) {
        guiConfig.token = connection.generateToken(32);
        connection.writeLaunchEnv({ REL_AI_MCP_TOKEN: guiConfig.token });
      }
      if (!guiConfig.chatgptSecret) {
        guiConfig.chatgptSecret = connection.resolveChatGPTSecret({});
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
        chatgptSecret: guiConfig.chatgptSecret,
        publicUrl: `https://${guiConfig.ngrokDomain}`,
        exitOnError: false,
        // Native folder picker for the dashboard "Browse" buttons. Runs in the main
        // process; the dashboard reaches it via POST /api/pick-folder.
        pickFolder: async () => {
          const { dialog } = require('electron');
          const result = await dialog.showOpenDialog({
            title: 'Select workspace folder',
            properties: ['openDirectory']
          });
          return result && !result.canceled && result.filePaths && result.filePaths[0] ? result.filePaths[0] : null;
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

    tunnelManager.killOrphanedNgrok();

    const command = buildTunnelCommand(guiConfig.ngrokDomain, actualPort);
    const result = await tunnelManager.startTunnel({
      provider: 'custom',
      command,
      port: actualPort,
      localUrl: `http://127.0.0.1:${actualPort}`,
      timeoutMs: 30000,
      onLog: (chunk) => {
        if (statusWindow && !statusWindow.isDestroyed()) {
          statusWindow.webContents.send('server:log', String(chunk || '').trim());
        }
      },
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
      const mcpUrl = buildMcpUrl(publicBaseUrl, guiConfig.chatgptSecret);
      connection.writeConnectionProfile({
        host: '127.0.0.1',
        port: actualPort,
        publicUrl: publicBaseUrl,
        ngrokDomain: guiConfig.ngrokDomain,
        tunnelProvider: 'custom',
        chatgptSecret: guiConfig.chatgptSecret,
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
    } catch (_) {}
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
    const port = (httpServer && httpServer.listening && httpServer.address() && httpServer.address().port)
      || readGuiConfig().port
      || 3333;
    const token = connection.readLaunchEnv().REL_AI_MCP_TOKEN || readGuiConfig().token || '';
    shell.openExternal(
      `http://127.0.0.1:${port}/dashboard${token ? `?token=${encodeURIComponent(token)}` : ''}`
    );
  } catch (error) {
    setStatus({ error: formatError(error) });
  }
}

function openSettingsWindow() {
  let config;
  try {
    config = readGuiConfig();
  } catch (_) {
    config = { port: 3333, token: '', ngrokDomain: '' };
  }
  createWizardWindow({
    edit: true,
    parent: statusWindow || undefined,
    query: {
      edit: '1',
      port: String(config.port || 3333),
      token: config.token || '',
      domain: config.ngrokDomain || ''
    }
  });
}

function fitWindowToContent(win, options = {}) {
  if (!win || win.isDestroyed()) return;

  const type = options.type === 'wizard' ? 'wizard' : 'status';
  const limits = WINDOW_SIZE_LIMITS[type];
  const display = screen.getDisplayMatching(win.getBounds());
  const maxDisplayWidth = Math.max(limits.minWidth, (display?.workAreaSize?.width || limits.maxWidth) - 80);
  const maxDisplayHeight = Math.max(limits.minHeight, (display?.workAreaSize?.height || limits.maxHeight) - 80);

  const requestedWidth = Number.isFinite(options.width) ? options.width : win.getContentBounds().width;
  const requestedHeight = Number.isFinite(options.height) ? options.height : win.getContentBounds().height;

  const width = Math.max(
    limits.minWidth,
    Math.min(Math.ceil(requestedWidth + limits.paddingWidth), limits.maxWidth, maxDisplayWidth)
  );
  const height = Math.max(
    limits.minHeight,
    Math.min(Math.ceil(requestedHeight + limits.paddingHeight), limits.maxHeight, maxDisplayHeight)
  );

  const currentBounds = win.getContentBounds();
  if (currentBounds.width === width && currentBounds.height === height) return;

  win.setContentSize(width, height, true);
  win.center();
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

ipcMain.handle('wizard:save-config', (_event, config) => {
  saveLauncherConfig(config);
  return { ok: true };
});

ipcMain.handle('wizard:done', async (_event, config) => {
  saveLauncherConfig(config);
  if (wizardWindow && !wizardWindow.isDestroyed()) {
    wizardWindow.destroy();
    wizardWindow = null;
  }
  const win = createStatusWindow();
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => startServer());
  } else {
    startServer();
  }
  return { ok: true };
});

ipcMain.handle('wizard:open-settings', () => {
  openSettingsWindow();
  return { ok: true };
});

ipcMain.handle('server:start', async () => startServer());

ipcMain.handle('server:stop', () => stopServer());

ipcMain.handle('url:copy', (_event, url) => {
  clipboard.writeText(String(url || ''));
  return { ok: true };
});

ipcMain.handle('url:open-dashboard', () => {
  openDashboardUrl();
  return { ok: true };
});

ipcMain.handle('extension:get-path', () => {
  return resolveResourcePath(path.join('public', 'extensions', 'chrome-auto-approve'));
});

// Open the unpacked-extension folder in the OS file manager. This is the reliable
// import helper — Chrome forbids an external app from installing an unpacked/CRX
// extension into the user's real browser, so the best we can do is reveal the folder
// for a one-shot "Load unpacked".
ipcMain.handle('extension:reveal-folder', async () => {
  const dir = resolveResourcePath(path.join('public', 'extensions', 'chrome-auto-approve'));
  const err = await shell.openPath(dir); // '' on success
  return { ok: !err, path: dir, error: err || '' };
});

// Best-effort jump to chrome://extensions. The chrome:// scheme has no OS protocol
// handler (so shell.openExternal can't reach it) — launch a Chromium browser directly
// with the URL. Falls back to ok:false; the UI still offers reveal-folder + copy-path.
ipcMain.handle('extension:open-extensions-page', async () => {
  const url = 'chrome://extensions/';
  const { spawn } = require('node:child_process');
  const attempts = process.platform === 'win32'
    ? [['cmd', ['/c', 'start', '', 'chrome', url]]]
    : process.platform === 'darwin'
      ? [['open', ['-a', 'Google Chrome', url]]]
      : [['google-chrome', [url]], ['chromium', [url]], ['chromium-browser', [url]]];
  for (const [cmd, args] of attempts) {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    } catch (_) { /* try next */ }
  }
  return { ok: false };
});

ipcMain.on('window:fit-content', (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const isWizard = win === wizardWindow;
  const isStatus = win === statusWindow;
  if (!isWizard && !isStatus) return;

  fitWindowToContent(win, {
    type: isWizard ? 'wizard' : 'status',
    width: Number(payload.width),
    height: Number(payload.height)
  });
});

module.exports = { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
