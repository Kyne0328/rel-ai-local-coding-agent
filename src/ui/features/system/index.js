import { get as getStore } from '../../store.js';
import { mountConnector, updateConnectorLiveState } from '../settings/connector.js';
import { mountDiagnostics, updateDiagnosticsLiveState } from '../settings/diagnostics.js';
import { mountProcesses, updateProcessesLiveState } from '../processes/index.js';
import { mountTools } from '../tools/index.js';
import { mountUsage, updateUsageLiveState } from '../usage/index.js';

const MOUNTS = {
  connection: mountConnector,
  processes: container => mountProcesses(container, getStore()),
  diagnostics: mountDiagnostics,
  tools: mountTools,
  usage: mountUsage
};

export function mountSystemPage(container, pageId = 'connection') {
  const currentPage = Object.hasOwn(MOUNTS, pageId) ? pageId : 'connection';
  container.innerHTML = '';

  const content = document.createElement('div');
  content.id = '__system-content';
  content.className = 'settings-content system-content';
  container.appendChild(content);

  return MOUNTS[currentPage](content);
}

export function updateSystemLiveState(container, pageId, dashboardState = {}) {
  const content = container.querySelector('#__system-content') || container;
  const currentPage = pageId === 'system' ? 'connection' : pageId;
  if (currentPage === 'connection') return updateConnectorLiveState(content, dashboardState);
  if (currentPage === 'processes') return updateProcessesLiveState(content, dashboardState);
  if (currentPage === 'diagnostics') return updateDiagnosticsLiveState(content);
  if (currentPage === 'usage') return updateUsageLiveState(content);
  return false;
}
