import { mountGeneral } from './general.js';
import { mountDashboard } from './dashboard.js';
import { mountConnector } from './connector.js';
import { mountDiagnostics } from './diagnostics.js';

const SUB_PAGES = [
  { id: 'general', label: 'General', mount: mountGeneral },
  { id: 'dashboard', label: 'Dashboard', mount: mountDashboard },
  { id: 'connector', label: 'Connector', mount: mountConnector },
  { id: 'diagnostics', label: 'Diagnostics', mount: mountDiagnostics },
];
const LEGACY_REDIRECTS = { advanced: 'general' };
let _currentSubPage = 'general';

export function mountSettings(container, subPageId = 'general') {
  const resolved = LEGACY_REDIRECTS[subPageId] || subPageId;
  if (SUB_PAGES.some(page => page.id === resolved)) _currentSubPage = resolved;
  container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'settings-shell';
  const rail = document.createElement('nav');
  rail.className = 'settings-rail';
  rail.setAttribute('aria-label', 'Settings navigation');
  const content = document.createElement('div');
  content.id = '__settings-content';

  for (const page of SUB_PAGES) {
    const button = document.createElement('button');
    button.className = `secondary settings-nav-button${page.id === _currentSubPage ? ' active' : ''}`;
    button.textContent = page.label;
    button.dataset.subPage = page.id;
    button.onclick = () => openPage(page, rail, content);
    rail.appendChild(button);
  }

  shell.append(rail, content);
  container.appendChild(shell);
  return (SUB_PAGES.find(page => page.id === _currentSubPage) || SUB_PAGES[0]).mount(content);
}

function openPage(page, rail, content) {
  const target = page.id === 'general' ? '#settings' : '#settings/' + page.id;
  if (location.hash !== target) {
    location.hash = target;
    return;
  }
  _currentSubPage = page.id;
  rail.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.subPage === page.id));
  content.innerHTML = '';
  page.mount(content);
}
