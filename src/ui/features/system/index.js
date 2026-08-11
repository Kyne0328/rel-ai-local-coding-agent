import { get as getStore } from '../../store.js';
import { SYSTEM_NAV_ITEMS } from '../../navigation-catalog.js';
import { navigate, routeHref } from '../../router.js';
import { mountConnector, updateConnectorLiveState } from '../settings/connector.js';
import { mountDiagnostics } from '../settings/diagnostics.js';
import { mountProcesses, updateProcessesLiveState } from '../processes/index.js';
import { mountTools } from '../tools/index.js';
import { mountUsage } from '../usage/index.js';

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

  const shell = document.createElement('div');
  shell.className = 'settings-layout settings-shell system-shell';
  const rail = document.createElement('nav');
  rail.className = 'settings-rail system-rail';
  rail.setAttribute('aria-label', 'System navigation');
  const content = document.createElement('div');
  content.id = '__system-content';
  content.className = 'settings-content system-content';

  for (const item of SYSTEM_NAV_ITEMS) {
    const button = document.createElement('button');
    const active = item.id === currentPage;
    button.type = 'button';
    button.className = `secondary settings-nav-button system-nav-button${active ? ' active' : ''}`;
    button.textContent = item.label;
    button.dataset.systemPage = item.id;
    if (active) button.setAttribute('aria-current', 'page');
    button.onclick = () => openPage(item.id);
    rail.appendChild(button);
  }

  shell.append(rail, content);
  container.appendChild(shell);
  return MOUNTS[currentPage](content);
}

function openPage(pageId) {
  const target = routeHref(pageId);
  if (location.hash !== target) navigate(pageId);
}

export function updateSystemLiveState(container, pageId, dashboardState = {}) {
  const content = container.querySelector('#__system-content') || container;
  const currentPage = pageId === 'system' ? 'connection' : pageId;
  if (currentPage === 'connection') return updateConnectorLiveState(content, dashboardState);
  if (currentPage === 'processes') return updateProcessesLiveState(content, dashboardState);
  return false;
}
