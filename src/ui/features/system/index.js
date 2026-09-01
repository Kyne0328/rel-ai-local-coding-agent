import { get as getStore } from '../../store.js';
import { mountDiagnostics, updateDiagnosticsLiveState } from '../settings/diagnostics.js';
import { mountProcesses, updateProcessesLiveState } from '../processes/index.js';
import { mountTools } from '../tools/index.js';
import { mountUsage, updateUsageLiveState } from '../usage/index.js';

const MOUNTS = {
  processes: container => mountProcesses(container, getStore()),
  diagnostics: mountDiagnostics,
  tools: mountTools,
  usage: mountUsage
};

export function mountSystemPage(container, pageId = 'processes') {
  const currentPage = Object.hasOwn(MOUNTS, pageId) ? pageId : 'processes';
  container.innerHTML = '';

  const content = document.createElement('div');
  content.id = '__system-content';
  content.className = 'settings-content system-content';
  container.appendChild(content);

  return MOUNTS[currentPage](content);
}

export function updateSystemLiveState(container, pageId, dashboardState = {}) {
  const content = container.querySelector('#__system-content') || container;
  if (pageId === 'processes') return updateProcessesLiveState(content, dashboardState);
  if (pageId === 'diagnostics') return updateDiagnosticsLiveState(content);
  if (pageId === 'usage') return updateUsageLiveState(content);
  return false;
}
