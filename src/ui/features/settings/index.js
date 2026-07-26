import { mountGeneral } from './general.js';
import { mountConnector } from './connector.js';
import { mountToolsValidation } from './tools-validation.js';
import { mountDiagnostics } from './diagnostics.js';
import { mountAdvanced } from './advanced.js';
import { mountAbout } from './about.js';
import { navigate, routeHref } from '../../router.js';
import { normalizeRouteKey } from '../../route-policy.js';

const SUB_PAGES = [
  { id: 'general', label: 'General', mount: mountGeneral },
  { id: 'connection', label: 'Connection', mount: mountConnector },
  { id: 'tools-validation', label: 'Tools & validation', mount: mountToolsValidation },
  { id: 'diagnostics', label: 'Diagnostics', mount: mountDiagnostics },
  { id: 'advanced', label: 'Advanced', mount: mountAdvanced },
  { id: 'about', label: 'About', mount: mountAbout }
];
const LEGACY_REDIRECTS = {
  connector: 'connection',
  desktop: 'connection',
  dashboard: 'advanced'
};
let currentSubPage = 'general';

export function mountSettings(container, subPageId = 'general') {
  const resolved = LEGACY_REDIRECTS[subPageId] || subPageId;
  if (SUB_PAGES.some(page => page.id === resolved)) currentSubPage = resolved;
  normalizeLegacyRoute(subPageId, resolved);
  container.innerHTML = '';

  const shell = document.createElement('div');
  shell.className = 'settings-layout settings-shell';
  const rail = document.createElement('nav');
  rail.className = 'settings-rail';
  rail.setAttribute('aria-label', 'Settings navigation');
  const content = document.createElement('div');
  content.id = '__settings-content';
  content.className = 'settings-content';

  for (const page of SUB_PAGES) {
    const button = document.createElement('button');
    const active = page.id === currentSubPage;
    button.type = 'button';
    button.className = `secondary settings-nav-button${active ? ' active' : ''}`;
    button.textContent = page.label;
    button.dataset.subPage = page.id;
    if (active) button.setAttribute('aria-current', 'page');
    button.onclick = () => openPage(page, rail, content);
    rail.appendChild(button);
  }

  shell.append(rail, content);
  container.appendChild(shell);
  return (SUB_PAGES.find(page => page.id === currentSubPage) || SUB_PAGES[0]).mount(content);
}

function normalizeLegacyRoute(requested, resolved) {
  if (requested === resolved) return;
  const target = resolved === 'general' ? 'settings' : `settings/${resolved}`;
  const routeKey = normalizeRouteKey(target);
  history.replaceState(null, '', `${location.pathname}${location.search}#${routeKey}`);
  try { localStorage.setItem('relai_dashboard_route', routeKey); } catch {}
}

function openPage(page, rail, content) {
  const section = page.id === 'general' ? 'settings' : `settings/${page.id}`;
  const target = routeHref(section);
  if (location.hash !== target) {
    navigate(section);
    return;
  }
  currentSubPage = page.id;
  rail.querySelectorAll('button').forEach(button => {
    const active = button.dataset.subPage === page.id;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  content.innerHTML = '';
  page.mount(content);
}
