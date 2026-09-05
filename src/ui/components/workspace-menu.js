import { setWorkspaceFilter } from '../router.js';
import { esc } from '../utils.js';
import { iconHtml } from './icons.js';

let closeActiveMenu = null;
let documentListenerBound = false;

export function workspaceMenuHtml(workspaces = [], selected = '', options = {}) {
  const items = orderWorkspacesAlphabetically(workspaces);
  const id = String(options.id || 'workspaceMenu');
  const label = selected || 'All projects';
  const optionsHtml = [
    workspaceOption('', 'All projects', selected === ''),
    ...items.map(workspace => {
      const alias = String(workspace?.alias || '').trim();
      return alias ? workspaceOption(alias, alias, alias === selected) : '';
    })
  ].join('');
  return `<div class="workspace-menu" data-workspace-menu>
    <button class="secondary workspace-menu-trigger" id="${esc(id)}Button" type="button" aria-label="Project filter: ${esc(label)}" title="Project filter" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}List">
      ${iconHtml('folder')}
      <span>${esc(label)}</span>
      ${iconHtml('chevronDown', { className: 'workspace-menu-chevron' })}
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
  let typeahead = '';
  let typeaheadTimer = null;

  const options = () => [...popover.querySelectorAll('[role="option"]')];
  const focusOption = option => {
    if (!option) return;
    for (const item of options()) item.tabIndex = item === option ? 0 : -1;
    option.focus({ preventScroll: true });
  };
  const close = ({ restoreFocus = false } = {}) => {
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
    typeahead = '';
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = null;
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
    focusOption(selected);
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
  popover.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && menu.contains(event.relatedTarget)) return;
    close();
  });
  popover.addEventListener('keydown', event => {
    const items = options();
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ restoreFocus: true });
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = index < 0 ? 0 : (index + direction + items.length) % items.length;
      focusOption(items[next]);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusOption(event.key === 'Home' ? items[0] : items.at(-1));
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches('[data-workspace-value]')) {
      event.preventDefault();
      document.activeElement.click();
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      typeahead += event.key.toLocaleLowerCase();
      if (typeaheadTimer) clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => { typeahead = ''; typeaheadTimer = null; }, 700);
      const start = index < 0 ? 0 : index + 1;
      const ordered = [...items.slice(start), ...items.slice(0, start)];
      const match = ordered.find(item => item.textContent.trim().toLocaleLowerCase().startsWith(typeahead));
      if (match) {
        event.preventDefault();
        focusOption(match);
      }
    }
  });
}

function workspaceOption(value, label, selected) {
  return `<button class="workspace-menu-option${selected ? ' selected' : ''}" type="button" role="option" tabindex="${selected ? '0' : '-1'}" aria-selected="${selected ? 'true' : 'false'}" data-workspace-value="${esc(value)}"><span>${esc(label)}</span>${selected ? iconHtml('check') : ''}</button>`;
}
