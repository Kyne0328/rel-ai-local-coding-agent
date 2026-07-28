'use strict';

function localWindowWebPreferences(preload, partition) {
  return {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    partition
  };
}

function secureLocalWindow(window, { allowedUrl, onError = () => {} } = {}) {
  if (!window?.webContents) throw new TypeError('A BrowserWindow is required.');
  const expectedTarget = normalizeLocalTarget(allowedUrl);
  const { webContents } = window;
  const session = webContents.session;

  session?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
  session?.setPermissionCheckHandler?.(() => false);
  session?.on?.('will-download', event => event.preventDefault());
  webContents.on?.('will-attach-webview', event => event.preventDefault());
  const blockUnexpectedNavigation = (event, target) => {
    if (isAllowedLocalTarget(target, expectedTarget)) return;
    event.preventDefault();
    onError(new Error('Blocked navigation outside the local Electron renderer.'));
  };
  webContents.on?.('will-navigate', blockUnexpectedNavigation);
  webContents.on?.('will-redirect', blockUnexpectedNavigation);
  webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  return window;
}

function isAllowedLocalTarget(target, allowedUrl) {
  const expected = normalizeLocalTarget(allowedUrl);
  const actual = normalizeLocalTarget(target);
  return Boolean(expected && actual && actual === expected);
}

function normalizeLocalTarget(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'relai-app:' || url.hostname !== 'renderer') return '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

module.exports = { localWindowWebPreferences, secureLocalWindow, isAllowedLocalTarget };
