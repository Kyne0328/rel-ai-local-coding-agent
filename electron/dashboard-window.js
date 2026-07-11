'use strict';

const { URL } = require('node:url');

function createDashboardWindowManager(deps) {
  const {
    BrowserWindow,
    shell,
    app,
    dialog,
    getConnection,
    onError = () => {}
  } = deps;
  let dashboardWindow = null;
  let authOrigin = '';
  let authToken = '';
  let securedSession = null;

  async function open() {
    const connection = await getConnection();
    const target = validateConnection(connection);
    authOrigin = target.origin;
    authToken = String(connection.token || '');
    const win = getOrCreateWindow();
    secureSession(win.webContents.session);
    if (win.webContents.getURL() !== target.href) await win.loadURL(target.href);
    win.show();
    win.focus();
    return win;
  }

  function getOrCreateWindow() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) return dashboardWindow;
    dashboardWindow = new BrowserWindow({
      width: 1240,
      height: 820,
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
    configureNavigation(dashboardWindow);
    dashboardWindow.once('ready-to-show', () => dashboardWindow?.show());
    dashboardWindow.on('closed', () => { dashboardWindow = null; });
    return dashboardWindow;
  }

  function secureSession(session) {
    if (securedSession === session) return;
    securedSession = session;
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeSendHeaders(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        const headers = { ...(details.requestHeaders || {}) };
        if (authToken && safeOrigin(details.url) === authOrigin) headers.Authorization = `Bearer ${authToken}`;
        callback({ requestHeaders: headers });
      }
    );
  }

  function configureNavigation(win) {
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('will-navigate', (event, target) => {
      if (safeOrigin(target) === authOrigin) return;
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
      void open().catch(onError);
    });
  }

  function openExternal(target) {
    try {
      const url = new URL(target);
      if (url.protocol === 'https:') void shell.openExternal(url.href);
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

  function close() {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.destroy();
    dashboardWindow = null;
  }

  function getWindow() {
    return dashboardWindow && !dashboardWindow.isDestroyed() ? dashboardWindow : null;
  }

  return { open, close, getWindow, pickFolder };
}

function validateConnection(connection) {
  const target = new URL(String(connection?.url || ''));
  const loopback = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '[::1]';
  if (target.protocol !== 'http:' || !loopback || target.pathname !== '/dashboard') {
    throw new Error('Electron dashboard must use the local loopback /dashboard route.');
  }
  return target;
}

function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

module.exports = { createDashboardWindowManager, validateConnection };
