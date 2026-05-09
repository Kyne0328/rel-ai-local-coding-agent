// Settings section — left-rail sub-navigation
import { mountGeneral } from './general.js';
import { mountPermissions } from './permissions.js';
import { mountApprovalGates } from './approval-gates.js';
import { mountConnector } from './connector.js';
import { mountDiagnostics } from './diagnostics.js';
import { mountAdvanced } from './advanced.js';

const SUB_PAGES = [
  { id: 'general',        label: 'General',        mount: mountGeneral },
  { id: 'permissions',    label: 'Permissions',     mount: mountPermissions },
  { id: 'approval-gates', label: 'Approval gates',  mount: mountApprovalGates },
  { id: 'connector',      label: 'Connector',       mount: mountConnector },
  { id: 'diagnostics',    label: 'Diagnostics',     mount: mountDiagnostics },
  { id: 'advanced',       label: 'Advanced',        mount: mountAdvanced },
];

let _currentSubPage = 'general';

export function mountSettings(container) {
  container.innerHTML = '';
  const shell = document.createElement('div');
  shell.style.cssText = 'display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px;min-height:400px;';

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
    if (page.id === _currentSubPage) { btn.style.background = '#173b73'; btn.style.borderColor = 'rgba(78,161,255,.35)'; btn.style.color = '#fff'; }
    btn.onclick = () => {
      _currentSubPage = page.id;
      rail.querySelectorAll('button').forEach(b => { b.style.background = ''; b.style.borderColor = 'transparent'; b.style.color = ''; });
      btn.style.background = '#173b73'; btn.style.borderColor = 'rgba(78,161,255,.35)'; btn.style.color = '#fff';
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
