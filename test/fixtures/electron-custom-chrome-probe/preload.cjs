'use strict';
const { contextBridge } = require('electron');
const noListener = () => () => {};
contextBridge.exposeInMainWorld('relaiDesktop', {
  getWindowState: async () => ({ customTitleBar: true, controls: 'custom', platform: 'win32', maximized: false }),
  minimizeWindow: async () => ({ ok: true }),
  toggleMaximizeWindow: async () => ({ ok: true }),
  closeWindow: async () => ({ ok: true }),
  onWindowState: noListener,
  onStatus: noListener,
  getStatus: async () => null,
  onGatewayStatus: noListener,
  getGatewayStatus: async () => ({ ok: true, connectionMode: 'cloud', gateway: { state: 'pairing_required', principalPaired: false } }),
  getGatewayUsage: async () => { throw new Error('USAGE_IPC_SHOULD_NOT_RUN_WHILE_PAIRING_REQUIRED'); }
});
