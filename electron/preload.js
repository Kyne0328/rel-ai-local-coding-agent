const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveConfig: (config) => ipcRenderer.invoke('wizard:save-config', config),
  wizardDone: (config) => ipcRenderer.invoke('wizard:done', config),
  openSettings: () => ipcRenderer.invoke('wizard:open-settings'),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  copyUrl: (url) => ipcRenderer.invoke('url:copy', url),
  openDashboard: () => ipcRenderer.invoke('url:open-dashboard'),
  onServerStatus: (callback) => {
    ipcRenderer.on('server:status', (_event, status) => callback(status));
  },
  removeServerStatusListener: () => {
    ipcRenderer.removeAllListeners('server:status');
  },
  getExtensionPath: () => ipcRenderer.invoke('extension:get-path'),
  copyText: (text) => ipcRenderer.invoke('url:copy', text)
});
