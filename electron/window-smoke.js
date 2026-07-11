'use strict';

const path = require('node:path');
const { BrowserWindow } = require('electron');
const { WINDOW_SIZE_LIMITS } = require('./window-size');

async function runWindowSmoke() {
  await loadRendererSmoke('wizard.html', 'wizard');
  await loadRendererSmoke('settings.html', 'wizard');
  await loadRendererSmoke('status.html', 'status');
}

async function loadRendererSmoke(fileName, type) {
  const limits = WINDOW_SIZE_LIMITS[type];
  const smokeWindow = new BrowserWindow({
    show: false,
    width: limits.minWidth,
    height: limits.minHeight,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  try {
    await smokeWindow.loadFile(path.join(__dirname, 'renderer', fileName));
    const result = await smokeWindow.webContents.executeJavaScript(`({
      hasApi: Boolean(window.electronAPI),
      hasBody: Boolean(document.body),
      hasPrimarySurface: Boolean(document.querySelector('.wizard, .settings-shell, .status-shell'))
    })`);
    if (!result?.hasApi || !result?.hasBody || !result?.hasPrimarySurface) {
      throw new Error(`${fileName} did not initialize its renderer surface.`);
    }
  } finally {
    if (!smokeWindow.isDestroyed()) smokeWindow.destroy();
  }
}

module.exports = { runWindowSmoke };
