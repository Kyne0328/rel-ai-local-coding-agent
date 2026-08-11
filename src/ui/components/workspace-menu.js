import { setWorkspaceFilter } from '../router.js';
import { esc } from '../utils.js';

let closeActiveMenu = null;
let documentListenerBound = false;

export function workspaceMenuHtml(workspaces = [], selected = '', options = {}) {
  const items = orderWorkspacesAlphabetically(workspaces);
  const id = String(options.id || 'workspaceMenu');
  const label = selected || 'All workspaces';
  const optionsHtml = [
    workspaceOption('', 'All workspaces', selected === ''),
    ...items.map(workspace => {
      const alias = String(workspace?.alias || '').trim();
      return alias ? workspaceOption(alias, alias, alias === selected) : '';
    })
  ].join('');
  return `<div class="workspace-menu" data-workspace-menu>
    <button class="secondary workspace-menu-trigger" id="${esc(id)}Button" type="button" aria-label="Workspace scope: ${esc(label)}" title="Workspace scope" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}List">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7l-2-3H5a2 2 0 0 0-2 2v2.5Z" /></svg>
      <span>${esc(label)}</span>
      <svg class="workspace-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div class="workspace-menu-popover" id="${esc(id)}List" role="listbox" aria-labelledby="${esc(id)}Button" hidden>${optionsHtml}</div>
  </div>`;
}

export function orderWorkspacesAlphabetically(workspaces = []) {
  return [...(Array.isArray(workspaces) ? workspaces : [])].sort((left, right) =>
    String(left?.alias || '').localeCompare(String(right?.alias || ''), 'en-US', { numeric: true, sensitivity: 'base' })
  );
}

export function bindWorkspaceMenus(root = document) {
  ensureDocumentListener();
  for (const menu of root.querySelectorAll('[data-workspace-menu]')) bindWorkspaceMenu(menu);
}

function ensureDocumentListener() {
  if (documentListenerBound) return;
  documentListenerBound = true;
  document.addEventListener('pointerdown', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-workspace-menu]')) closeActiveMenu?.();
  });
}

function bindWorkspaceMenu(menu) {
  if (menu.dataset.bound === 'true') return;
  menu.dataset.bound = 'true';
  const trigger = menu.querySelector('.workspace-menu-trigger');
  const popover = menu.querySelector('.workspace-menu-popover');
  if (!trigger || !popover) return;

  const close = ({ restoreFocus = false } = {}) => {
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
    if (closeActiveMenu === close) closeActiveMenu = null;
    if (restoreFocus) trigger.focus();
    window.dispatchEvent(new CustomEvent('relai:dropdown-closed'));
  };
  const open = () => {
    closeActiveMenu?.();
    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.classList.add('open');
    closeActiveMenu = close;
    const selected = popover.querySelector('[aria-selected="true"]') || popover.querySelector('[role="option"]');
    selected?.focus({ preventScroll: true });
  };

  trigger.addEventListener('click', event => {
    event.preventDefault();
    if (popover.hidden) open();
    else close();
  });
  popover.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const option = target?.closest('[data-workspace-value]');
    if (!option) return;
    close();
    setWorkspaceFilter(option.dataset.workspaceValue || '');
  });
  popover.addEventListener('keydown', event => {
    const options = [...popover.querySelectorAll('[role="option"]')];
    const index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? 0 : (index + direction + options.length) % options.length;
      options[next]?.focus();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches('[data-workspace-value]')) {
      event.preventDefault();
      document.activeElement.click();
    }
  });
}

function workspaceOption(value, label, selected) {
  return `<button class="workspace-menu-option${selected ? ' selected' : ''}" type="button" role="option" aria-selected="${selected ? 'true' : 'false'}" data-workspace-value="${esc(value)}"><span>${esc(label)}</span>${selected ? '<span aria-hidden="true">✓</span>' : ''}</button>`;
}
