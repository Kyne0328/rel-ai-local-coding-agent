'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

function createDashboardWindowManager(deps) {
  const { BrowserWindow, shell, app, dialog, getConnection, onError = () => {} } = deps;
  const userDataPath = typeof app.getPath === 'function' ? app.getPath('userData') : process.cwd();
  const statePath = path.join(userDataPath, 'dashboard-window-state.json');
  let dashboardWindow = null;
  let dashboardOrigin = '';
  let persistTimer = null;

  async function open() {
    const connection = await getConnection();
    const target = validateConnection(connection);
    dashboardOrigin = target.origin;
    const win = getOrCreateWindow();
    const current = safeUrl(win.webContents.getURL());
    if (!current || current.origin !== target.origin || current.pathname !== target.pathname) {
      await win.loadURL(target.href);
    }
    win.show();
    win.focus();
    return win;
  }

  function getOrCreateWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) return dashboardWindow;
    const bounds = readBounds();
    dashboardWindow = new BrowserWindow({
      ...bounds,
      width: bounds.width || 1240,
      height: bounds.height || 820,
      minWidth: 900,
      minHeight: 620,
      show: false,
      autoHideMenuBar: true,
      title: 'Rel.AI MCP Dashboard',
      backgroundColor: '#060912',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        partition: 'relai-dashboard'
      }
    });
    secureSession(dashboardWindow.webContents.session);
    configureNavigation(dashboardWindow);
    dashboardWindow.once('ready-to-show', () => dashboardWindow?.show());
    dashboardWindow.on('resize', schedulePersist);
    dashboardWindow.on('move', schedulePersist);
    dashboardWindow.on('close', persistBounds);
    dashboardWindow.on('closed', () => { dashboardWindow = null; });
    return dashboardWindow;
  }

  function secureSession(session) {
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
  }

  function configureNavigation(win) {
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('will-navigate', (event, target) => {
      if (safeOrigin(target) === dashboardOrigin) return;
      event.preventDefault();
      openExternal(target);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) onError(new Error(`Dashboard failed to load ${url}: ${description}`));
    });
    win.webContents.on('before-input-event', (event, input) => {
      const reload = input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r');
      if (!reload) return;
      event.preventDefault();
      win.webContents.reload();
    });
  }

  function openExternal(target) {
    try {
      const url = new URL(target);
      if (url.protocol === 'https:') Promise.resolve(shell.openExternal(url.href)).catch(onError);
    } catch {
      // Invalid and non-HTTPS targets stay blocked.
    }
  }

  async function pickFolder() {
    const parent = dashboardWindow && !dashboardWindow.isDestroyed() ? dashboardWindow : createPickerAnchor();
    try {
      if (parent !== dashboardWindow) {
        parent.showInactive();
        parent.moveTop();
        app.focus({ steal: true });
        parent.focus();
      }
      const result = await dialog.showOpenDialog(parent, {
        title: 'Select workspace folder',
        properties: ['openDirectory']
      });
      return result && !result.canceled && result.filePaths?.[0] ? result.filePaths[0] : null;
    } finally {
      if (parent !== dashboardWindow && !parent.isDestroyed()) parent.destroy();
    }
  }

  async function openFolder(folderPath) {
    const target = path.resolve(String(folderPath || ''));
    if (!target || !fs.existsSync(target)) throw new Error(`Workspace folder does not exist: ${target}`);
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return target;
  }

  function createPickerAnchor() {
    return new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true
    });
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistBounds, 250);
    persistTimer.unref?.();
  }

  function persistBounds() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    const win = getWindow();
    if (!win || typeof win.getBounds !== 'function') return;
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(win.getBounds(), null, 2));
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] dashboard bounds:', error);
    }
  }

  function readBounds() {
    try {
      const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (Number(value.width) >= 900 && Number(value.height) >= 620) return value;
    } catch { /* first launch or invalid state */ }
    return {};
  }

  function close() {
    persistBounds();
    if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.destroy();
    dashboardWindow = null;
  }

  function getWindow() {
    return dashboardWindow && !dashboardWindow.isDestroyed() ? dashboardWindow : null;
  }

  return { open, close, getWindow, pickFolder, openFolder };
}

function validateConnection(connection) {
  const target = new URL(String(connection?.url || ''));
  const loopback = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '[::1]';
  if (target.protocol !== 'http:' || !loopback || target.pathname !== '/dashboard') {
    throw new Error('Electron dashboard must use the local loopback /dashboard route.');
  }
  return target;
}

function safeUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function safeOrigin(value) {
  return safeUrl(value)?.origin || '';
}

module.exports = { createDashboardWindowManager, validateConnection };
