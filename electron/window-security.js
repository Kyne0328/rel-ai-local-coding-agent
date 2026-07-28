

import * as path from "node:path";
import { fileURLToPath } from "node:url";

function localWindowWebPreferences(preload, partition, surface = 'application') {
  return {
    preload,
    additionalArguments: [`--relai-preload-surface=${surface}`],
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

function secureLocalWindow(window, { allowedFile, onError = () => {} } = {}) {
  if (!window?.webContents) throw new TypeError('A BrowserWindow is required.');
  const allowedPath = normalizeFilePath(allowedFile);
  const { webContents } = window;
  const session = webContents.session;

  session?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
  session?.setPermissionCheckHandler?.(() => false);
  session?.on?.('will-download', event => event.preventDefault());
  webContents.on?.('will-attach-webview', event => event.preventDefault());
  const blockUnexpectedNavigation = (event, target) => {
    if (isAllowedLocalTarget(target, allowedPath)) return;
    event.preventDefault();
    onError(new Error('Blocked navigation outside the local Electron renderer.'));
  };
  webContents.on?.('will-navigate', blockUnexpectedNavigation);
  webContents.on?.('will-redirect', blockUnexpectedNavigation);
  webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  return window;
}

function isAllowedLocalTarget(target, allowedPath) {
  if (!allowedPath) return false;
  const expectedPath = normalizeFilePath(allowedPath);
  try {
    const url = new URL(String(target || ''));
    if (url.protocol !== 'file:') return false;
    url.search = '';
    url.hash = '';
    return normalizeFilePath(fileURLToPath(url)) === expectedPath;
  } catch {
    return false;
  }
}

function normalizeFilePath(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export { localWindowWebPreferences, secureLocalWindow, isAllowedLocalTarget };
