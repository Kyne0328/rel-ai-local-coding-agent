'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relaiDesktop', {
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  copyText: text => ipcRenderer.invoke('url:copy', text),
  openSettings: () => ipcRenderer.invoke('desktop:open-settings'),
  openRecovery: () => ipcRenderer.invoke('desktop:open-recovery'),
  restartService: () => ipcRenderer.send('desktop:restart-service'),
  stopService: () => ipcRenderer.send('desktop:stop-service'),
  onStatus: callback => ipcRenderer.on('server:status', (_event, status) => callback(status)),
  removeStatusListener: () => ipcRenderer.removeAllListeners('server:status')
});
