'use strict';

function dashboardWindowChrome(platform = process.platform) {
  if (platform === 'win32') {
    return Object.freeze({
      platform: 'win32',
      customTitleBar: true,
      controls: 'custom',
      windowOptions: Object.freeze({
        frame: false,
        thickFrame: true,
        titleBarStyle: 'hidden',
        hasShadow: true,
        roundedCorners: true
      })
    });
  }
  if (platform === 'darwin') {
    return Object.freeze({
      platform: 'darwin',
      customTitleBar: true,
      controls: 'native',
      windowOptions: Object.freeze({
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: Object.freeze({ x: 14, y: 13 })
      })
    });
  }
  return Object.freeze({
    platform: platform === 'linux' ? 'linux' : 'other',
    customTitleBar: false,
    controls: 'native',
    windowOptions: Object.freeze({})
  });
}

function dashboardWindowChromeState(win, platform = process.platform) {
  const chrome = dashboardWindowChrome(platform);
  return {
    platform: chrome.platform,
    customTitleBar: chrome.customTitleBar,
    controls: chrome.controls,
    maximized: readWindowFlag(win, 'isMaximized'),
    minimized: readWindowFlag(win, 'isMinimized'),
    fullScreen: readWindowFlag(win, 'isFullScreen')
  };
}

function createDashboardWindowChromeController({ getWindow, platform = process.platform }) {
  function getState() {
    return dashboardWindowChromeState(getWindow(), platform);
  }

  function requireWindow() {
    const win = getWindow();
    if (!win) throw new Error('Dashboard window is not available.');
    return win;
  }

  function sendState() {
    const win = getWindow();
    if (win && typeof win.webContents?.send === 'function') win.webContents.send('desktop:window-state', getState());
  }

  function bind(win) {
    for (const name of ['show', 'minimize', 'restore', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
      win.on(name, sendState);
    }
  }

  function minimize() {
    requireWindow().minimize();
    return getState();
  }

  function toggleMaximize() {
    const win = requireWindow();
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return getState();
  }

  function requestClose() {
    requireWindow().close();
    return { ok: true };
  }

  return { bind, getState, minimize, toggleMaximize, requestClose, sendState };
}

function readWindowFlag(win, method) {
  try {
    return Boolean(win && typeof win[method] === 'function' && win[method]());
  } catch {
    return false;
  }
}

module.exports = { createDashboardWindowChromeController, dashboardWindowChrome, dashboardWindowChromeState };
