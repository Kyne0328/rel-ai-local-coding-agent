'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('relaiDesktop', {
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  copyText: text => ipcRenderer.invoke('url:copy', text),
  openSettings: () => ipcRenderer.invoke('desktop:open-settings'),
  getSettings: () => ipcRenderer.invoke('desktop:settings:get'),
  saveSettings: settings => ipcRenderer.invoke('desktop:settings:save', settings),
  replaceApprovalToken: request => ipcRenderer.invoke('desktop:approval-token:replace', request),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:update:get'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update:download'),
  installUpdate: () => ipcRenderer.invoke('desktop:update:install'),
  getLifecycleStatus: () => ipcRenderer.invoke('desktop:lifecycle:get'),
  setLaunchAtLogin: enabled => ipcRenderer.invoke('desktop:startup:set', enabled === true),
  getNotificationsEnabled: () => ipcRenderer.invoke('desktop:notifications:get'),
  setNotificationsEnabled: enabled => ipcRenderer.invoke('desktop:notifications:set', enabled === true),
  exportDiagnosticState: report => ipcRenderer.invoke('desktop:diagnostics:export', report),
  openDiagnosticsFolder: () => ipcRenderer.invoke('desktop:diagnostics:open-folder'),
  restartService: () => ipcRenderer.send('desktop:restart-service'),
  stopService: () => ipcRenderer.send('desktop:stop-service'),
  onStatus: callback => ipcRenderer.on('server:status', (_event, status) => callback(status)),
  removeStatusListener: () => ipcRenderer.removeAllListeners('server:status'),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status', listener);
    return () => ipcRenderer.removeListener('desktop:update-status', listener);
  }
});
