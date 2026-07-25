'use strict';

const { localWindowWebPreferences, secureLocalWindow } = require('./window-security');

function createRecoveryWindowManager({
  BrowserWindow,
  preloadPath,
  rendererPath,
  limits,
  isQuitting = () => false,
  onReady = () => {},
  onSecurityError = () => {}
} = {}) {
  let window = null;

  function create() {
    if (window && !window.isDestroyed()) return window;
    window = new BrowserWindow({
      width: limits.minWidth,
      height: 620,
      minWidth: limits.minWidth,
      minHeight: limits.minHeight,
      useContentSize: true,
      webPreferences: localWindowWebPreferences(preloadPath, 'relai-recovery'),
      title: 'Rel.AI MCP Recovery',
      autoHideMenuBar: true
    });
    secureLocalWindow(window, { allowedFile: rendererPath, onError: onSecurityError });
    window.loadFile(rendererPath);
    window.webContents.on('did-finish-load', onReady);
    window.on('close', event => {
      if (isQuitting()) return;
      event.preventDefault();
      window.hide();
    });
    window.on('closed', () => { window = null; });
    return window;
  }

  function show() {
    const recoveryWindow = create();
    recoveryWindow.show();
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

  return {
    show,
    hide,
    close,
    getWindow: () => window && !window.isDestroyed() ? window : null,
    sendStatus: status => send('server:status', status),
    sendLog: log => send('server:log', log)
  };
}

module.exports = { createRecoveryWindowManager };
