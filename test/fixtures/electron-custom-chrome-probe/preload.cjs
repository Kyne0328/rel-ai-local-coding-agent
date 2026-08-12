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
  getLocalUsage: async month => ({
    ok: true,
    source: 'local',
    month,
    totals: { requests: 0, toolCalls: 0, successes: 0, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 0, activeDays: 0 },
    tools: [],
    devices: [],
    workspaces: [],
    workspaceDimensions: [],
    workspaceTools: [],
    series: [],
    toolSeries: [],
    workspaceSeries: [],
    workspaceToolSeries: [],
    failureCategories: [],
    failureCategorySeries: []
  })
});
