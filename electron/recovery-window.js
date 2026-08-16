

import { STARTUP_BACKGROUND_COLOR } from './startup-background.js';
import { localWindowWebPreferences, secureLocalWindow } from './window-security.js';

function createRecoveryWindowManager({
  BrowserWindow,
  preloadPath,
  rendererUrl,
  limits,
  installProtocol = () => {},
  isQuitting = () => false,
  onReady = () => {},
  onSecurityError = () => {}
} = {}) {
  let window = null;
  let rendererReady = false;
  let pendingStatus = null;

  function create() {
    if (window && !window.isDestroyed()) return window;
    window = new BrowserWindow({
      width: limits.minWidth,
      height: 620,
      minWidth: limits.minWidth,
      minHeight: limits.minHeight,
      useContentSize: true,
      webPreferences: localWindowWebPreferences(preloadPath, 'relai-recovery', 'application'),
      backgroundColor: STARTUP_BACKGROUND_COLOR,
      title: 'Rel.AI MCP Recovery',
      autoHideMenuBar: true
    });
    installProtocol(window.webContents.session.protocol);
    secureLocalWindow(window, { allowedUrl: rendererUrl, onError: onSecurityError });
    void Promise.resolve(window.loadURL(rendererUrl)).catch(error => {
      onSecurityError(new Error(`Recovery renderer failed to load: ${error instanceof Error ? error.message : String(error)}`));
    });
    window.webContents.on('did-finish-load', () => {
      rendererReady = true;
      onReady();
    });
    window.on('close', event => {
      if (isQuitting()) return;
      event.preventDefault();
      window.hide();
    });
    window.on('closed', () => {
      window = null;
      rendererReady = false;
    });
    return window;
  }

  function show() {
    const recoveryWindow = create();
    recoveryWindow.show();
    if (rendererReady && pendingStatus !== null) sendStatus(pendingStatus);
    recoveryWindow.focus();
    return recoveryWindow;
  }

  function hide() {
    if (window && !window.isDestroyed()) window.hide();
  }

  function close() {
    if (!window || window.isDestroyed()) return;
    window.destroy();
    window = null;
  }

  function send(channel, payload) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }

  function sendStatus(status) {
    pendingStatus = status;
    if (!rendererReady || !window || window.isDestroyed() || !window.isVisible()) return;
    const latest = pendingStatus;
    pendingStatus = null;
    send('server:status', latest);
  }

  return {
    show,
    hide,
    close,
    getWindow: () => window && !window.isDestroyed() ? window : null,
    sendStatus,
    sendLog: log => send('server:log', log)
  };
}

export { createRecoveryWindowManager };
