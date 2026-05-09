// Settings section — ChatGPT local repo bridge settings only
import { mountGeneral } from './general.js';
import { mountConnector } from './connector.js';
import { mountDiagnostics } from './diagnostics.js';

const SUB_PAGES = [
  { id: 'general', label: 'General', mount: mountGeneral },
  { id: 'connector', label: 'Connector', mount: mountConnector },
  { id: 'diagnostics', label: 'Diagnostics', mount: mountDiagnostics },
];

const LEGACY_REDIRECTS = { permissions: 'general', 'approval-gates': 'general', advanced: 'general' };
let _currentSubPage = 'general';

export function mountSettings(container, subPageId = 'general') {
  subPageId = LEGACY_REDIRECTS[subPageId] || subPageId;
  if (SUB_PAGES.some(page => page.id === subPageId)) _currentSubPage = subPageId;
  container.innerHTML = '';
  const shell = document.createElement('div');
  shell.className = 'settings-shell';
  shell.style.cssText = 'display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;align-items:start;';

  const rail = document.createElement('nav');
  rail.style.cssText = 'display:grid;gap:4px;align-content:start;padding:4px 0;';
  rail.setAttribute('aria-label', 'Settings navigation');

  const content = document.createElement('div');
  content.id = '__settings-content';

  for (const page of SUB_PAGES) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.style.cssText = 'text-align:left;padding:8px 12px;font-size:13px;border-radius:8px;border:1px solid transparent;justify-content:flex-start;min-height:34px;';
    btn.textContent = page.label;
    btn.dataset.subPage = page.id;
    if (page.id === _currentSubPage) setActiveButton(btn, true);
    btn.onclick = () => {
      const target = page.id === 'general' ? '#settings' : '#settings/' + page.id;
      if (location.hash !== target) {
        location.hash = target;
        return;
      }
      _currentSubPage = page.id;
      rail.querySelectorAll('button').forEach(b => setActiveButton(b, false));
      setActiveButton(btn, true);
      content.innerHTML = '';
      page.mount(content);
    };
    rail.appendChild(btn);
  }

  shell.appendChild(rail);
  shell.appendChild(content);
  container.appendChild(shell);

  const current = SUB_PAGES.find(p => p.id === _currentSubPage) || SUB_PAGES[0];
  current.mount(content);
}

function setActiveButton(button, active) {
  button.style.background = active ? '#173b73' : '';
  button.style.borderColor = active ? 'rgba(78,161,255,.35)' : 'transparent';
  button.style.color = active ? '#fff' : '';
}
