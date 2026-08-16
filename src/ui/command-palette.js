import { closeModal, openModal } from './components/modal.js';
import { routeHref } from './router.js';
import { navigationCommands } from './navigation-catalog.js';
import { hasActiveOverlay } from './interaction-safety.js';
import { esc as escapeHtml } from './utils.js';

let initialized = false;
let readData = () => ({});
let closePalette = () => closeModal();

export function initCommandPalette(options = {}) {
  readData = typeof options.getData === 'function' ? options.getData : readData;
  if (initialized) return;
  initialized = true;

  document.getElementById('commandPaletteBtn')?.addEventListener('click', openCommandPalette);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openCommandPalette();
    }
  });
  updateShortcutLabel();
}

function openCommandPalette() {
  if (hasActiveOverlay()) return;
  const commands = buildCommands(readData() || {});
  const content = document.createElement('div');
  content.className = 'command-palette';
  content.innerHTML = `
    <label class="command-search-wrap">
      <span class="sr-only">Search pages, settings, actions, and projects</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
      <input class="command-search" type="search" role="combobox" autocomplete="off" placeholder="Search pages, actions, or projects" aria-autocomplete="list" aria-expanded="true" aria-controls="commandPaletteList" aria-describedby="commandPaletteHelp">
      <kbd>Esc</kbd>
    </label>
    <div class="command-help" id="commandPaletteHelp">Use ↑ and ↓ to move, then press Enter.</div>
    <div class="command-list" id="commandPaletteList" role="listbox" aria-label="Quick navigation results"></div>`;

  const trigger = document.getElementById('commandPaletteBtn');
  trigger?.setAttribute('aria-expanded', 'true');
  const modal = openModal({
    title: 'Quick navigation',
    content,
    onClose: () => trigger?.setAttribute('aria-expanded', 'false')
  });
  closePalette = modal.close;
  modal.dialog.classList.add('command-panel');
  const input = content.querySelector('.command-search');
  const list = content.querySelector('.command-list');
  let visible = commands;
  let activeIndex = 0;

  const render = () => {
    const query = normalize(input.value);
    visible = commands
      .filter(command => !query || command.searchText.includes(query))
      .slice(0, 14);
    if (activeIndex >= visible.length) activeIndex = Math.max(0, visible.length - 1);
    list.innerHTML = visible.length
      ? visible.map((command, index) => commandHtml(command, index === activeIndex, index)).join('')
      : '<div class="command-empty">No matching page, action, or workspace.</div>';
    input.setAttribute('aria-expanded', visible.length ? 'true' : 'false');
    syncActiveOption(input, list, visible, activeIndex);
  };

  input.addEventListener('input', () => {
    activeIndex = 0;
    render();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = visible.length ? (activeIndex + 1) % visible.length : 0;
      render();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = visible.length ? (activeIndex - 1 + visible.length) % visible.length : 0;
      render();
    } else if (event.key === 'Enter' && visible[activeIndex]) {
      event.preventDefault();
      executeCommand(visible[activeIndex]);
    }
  });
  list.addEventListener('mousemove', event => {
    const option = event.target.closest('[data-command-index]');
    if (!option) return;
    const index = Number(option.dataset.commandIndex);
    if (Number.isInteger(index) && index !== activeIndex) {
      activeIndex = index;
      syncActiveOption(input, list, visible, activeIndex);
    }
  });
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-command-index]');
    if (!option) return;
    executeCommand(visible[Number(option.dataset.commandIndex)]);
  });

  render();
  input.focus();
}

function buildCommands(data) {
  const commands = navigationCommands().map(item => routeCommand(
    item.path.replaceAll('/', '-'),
    item.group === 'Settings' ? `Settings · ${item.label}` : item.label,
    item.description,
    item.href,
    item.group
  ));
  commands.push(actionCommand('add-workspace', 'Add project', 'Choose another project folder for ChatGPT.', 'Action', async () => {
    closePalette();
    const module = await import('./features/workspaces/form.js');
    module.openWorkspaceForm({ mode: 'add' });
  }));

  for (const workspace of data?.config?.workspaces || []) {
    const alias = String(workspace.alias || '').trim();
    if (!alias) continue;
    commands.push(routeCommand(
      `workspace-${alias}`,
      `Project · ${alias}`,
      workspace.path || 'Open project status and actions.',
      routeHref('workspaces', { workspace: alias, focus: '1' }),
      'Project'
    ));
  }
  return commands.map(command => ({
    ...command,
    searchText: normalize([command.label, command.description, command.group, ...(command.keywords || [])].join(' '))
  }));
}

function routeCommand(id, label, description, href, group, keywords = []) {
  return { id, label, description, href, group, keywords, run: () => { closePalette(); location.hash = href; } };
}

function actionCommand(id, label, description, group, run) {
  return { id, label, description, group, run };
}

function commandHtml(command, active, index) {
  return `<div class="command-option${active ? ' active' : ''}" id="command-option-${index}" role="option" aria-selected="${active ? 'true' : 'false'}" data-command-index="${index}">
    <span class="command-option-copy"><strong>${escapeHtml(command.label)}</strong><small>${escapeHtml(command.description)}</small></span>
    <span class="command-group">${escapeHtml(command.group)}</span>
  </div>`;
}

function syncActiveOption(input, list, visible, activeIndex) {
  let activeId = '';
  list.querySelectorAll('[data-command-index]').forEach((option, index) => {
    option.dataset.commandIndex = String(index);
    const active = index === activeIndex;
    option.classList.toggle('active', active);
    option.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) {
      activeId = option.id;
      option.scrollIntoView({ block: 'nearest' });
    }
  });
  if (activeId && visible.length) input.setAttribute('aria-activedescendant', activeId);
  else input.removeAttribute('aria-activedescendant');
}

function executeCommand(command) {
  if (!command) return;
  Promise.resolve(command.run()).catch(error => {
    closePalette();
    if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
  });
}

function updateShortcutLabel() {
  const label = document.querySelector('#commandPaletteBtn kbd');
  if (label) label.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

