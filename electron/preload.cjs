'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const surfaceArgument = process.argv.find(argument => argument.startsWith('--relai-preload-surface='));
const surface = surfaceArgument?.slice('--relai-preload-surface='.length) || 'application';

if (surface === 'dashboard') {
  contextBridge.exposeInMainWorld('relaiDesktop', {
    getStatus: () => ipcRenderer.invoke('desktop:get-status'),
    getWindowState: () => ipcRenderer.invoke('desktop:window:get-state'),
    minimizeWindow: () => ipcRenderer.invoke('desktop:window:minimize'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('desktop:window:toggle-maximize'),
    closeWindow: () => ipcRenderer.invoke('desktop:window:close'),
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
    onWindowState: callback => {
      if (typeof callback !== 'function') throw new TypeError('Window-state listener must be a function.');
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('desktop:window-state', listener);
      return () => ipcRenderer.removeListener('desktop:window-state', listener);
    },
    onUpdateStatus: callback => {
      if (typeof callback !== 'function') throw new TypeError('Update-status listener must be a function.');
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('desktop:update-status', listener);
      return () => ipcRenderer.removeListener('desktop:update-status', listener);
    }
  });
} else {
  contextBridge.exposeInMainWorld('electronAPI', {
    wizardDone: config => ipcRenderer.invoke('wizard:done', config),
    closeWizard: () => ipcRenderer.invoke('wizard:cancel'),
    getRecoveryConfig: () => ipcRenderer.invoke('recovery:get-config'),
    openRecoverySetup: () => ipcRenderer.invoke('recovery:open-setup'),
    startServer: () => ipcRenderer.invoke('server:start'),
    stopServer: () => ipcRenderer.invoke('server:stop'),
    copyUrl: url => ipcRenderer.invoke('url:copy', url),
    openDashboard: () => ipcRenderer.invoke('url:open-dashboard'),
    openExternal: url => ipcRenderer.invoke('url:open-link', url),
    getNotificationsEnabled: () => ipcRenderer.invoke('notifications:get-enabled'),
    setNotificationsEnabled: enabled => ipcRenderer.invoke('notifications:set-enabled', enabled),
    onServerStatus: callback => ipcRenderer.on('server:status', (_event, status) => callback(status)),
    removeServerStatusListener: () => ipcRenderer.removeAllListeners('server:status'),
    onServerLog: callback => ipcRenderer.on('server:log', (_event, entry) => callback(entry)),
    removeServerLogListener: () => ipcRenderer.removeAllListeners('server:log'),
    copyText: text => ipcRenderer.invoke('url:copy', text),
    fitWindowToContent: size => ipcRenderer.send('window:fit-content', size)
  });
}
