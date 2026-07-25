const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  wizardDone: (config) => ipcRenderer.invoke('wizard:done', config),
  closeWizard: () => ipcRenderer.invoke('wizard:cancel'),
  getRecoveryConfig: () => ipcRenderer.invoke('recovery:get-config'),
  openRecoverySetup: () => ipcRenderer.invoke('recovery:open-setup'),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  copyUrl: (url) => ipcRenderer.invoke('url:copy', url),
  openDashboard: () => ipcRenderer.invoke('url:open-dashboard'),
  openExternal: (url) => ipcRenderer.invoke('url:open-link', url),
  getNotificationsEnabled: () => ipcRenderer.invoke('notifications:get-enabled'),
  setNotificationsEnabled: (enabled) => ipcRenderer.invoke('notifications:set-enabled', enabled),
  onServerStatus: (callback) => {
    ipcRenderer.on('server:status', (_event, status) => callback(status));
  },
  removeServerStatusListener: () => {
    ipcRenderer.removeAllListeners('server:status');
  },
  onServerLog: (callback) => {
    ipcRenderer.on('server:log', (_event, entry) => callback(entry));
  },
  removeServerLogListener: () => {
    ipcRenderer.removeAllListeners('server:log');
  },
  copyText: (text) => ipcRenderer.invoke('url:copy', text),
  fitWindowToContent: (size) => ipcRenderer.send('window:fit-content', size)
});
