import { get as getStore } from '../../store.js';
import { markUnsaved } from '../../interaction-safety.js';
import { requestDashboardRefresh } from '../../api.js';
import {
  loadSettingsConfig,
  saveSettings,
  header,
  panel,
  field,
  toggleControl,
  saveRow
} from './shared.js';

let original = null;
let draft = null;

export function mountToolsValidation(container) {
  container.innerHTML = '<div class="settings-loading">Loading tools and validation settings…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const config = await loadSettingsConfig(container);
  if (!config) return;
  original = { ...structuredClone(config.productUx || {}), showAutomaticValidation: config.productUx?.showAutomaticValidation !== false };
  draft = structuredClone(original);
  render(container);
}

function render(container) {
  const dashboard = getStore() || {};
  const workspaces = Array.isArray(dashboard.config?.workspaces) ? dashboard.config.workspaces : [];
  const validationReady = workspaces.filter(workspace => validationCommands(workspace).length > 0).length;
  const toolCount = Number(dashboard.toolCount || dashboard.tools?.length || 0);

  container.innerHTML = '';
  container.appendChild(header(
    'Tools & validation',
    'Review the available tool surface and control how validation readiness is presented.'
  ));

  const summary = document.createElement('div');
  summary.className = 'settings-fact-grid';
  summary.innerHTML = `
    ${fact('Available tools', toolCount, 'Inspect, edit, validate, Git, and recovery capabilities')}
    ${fact('Configured workspaces', workspaces.length, 'Repositories currently available to ChatGPT')}
    ${fact('Validation ready', `${validationReady}/${workspaces.length}`, 'Workspaces with detected validation commands')}`;
  container.appendChild(summary);

  const tools = panel('Tool surface');
  tools.body.innerHTML = `
    <div class="settings-panel-intro">
      <strong>One discoverable capability catalog</strong>
      <span>The Tools page lists every available Rel.AI tool, its purpose, and accepted parameters.</span>
    </div>
    <div class="connection-actions"><a class="buttonlike secondary" href="#tools">Open Tools</a></div>`;
  container.appendChild(tools.el);

  const validation = panel('Workspace validation');
  validation.body.appendChild(field(
    'Show automatic validation plans',
    toggleControl(draft.showAutomaticValidation !== false, value => {
      draft.showAutomaticValidation = value;
      checkDirty();
    }, { enabled: 'Show validation plans', disabled: 'Hide validation plans' }),
    'Controls only the validation summary and command panel in Workspaces. It does not disable validation tools or configured commands.'
  ));
  const workspaceList = document.createElement('div');
  workspaceList.className = 'settings-validation-list';
  workspaceList.innerHTML = workspaces.length
    ? workspaces.map(workspaceRow).join('')
    : '<div class="empty">Add a workspace before configuring validation.</div>';
  validation.body.appendChild(workspaceList);
  validation.body.insertAdjacentHTML('beforeend', '<div class="connection-actions"><a class="buttonlike secondary" href="#workspaces">Manage workspaces</a></div>');
  container.appendChild(validation.el);
  container.appendChild(buildSaveRow(container));
}

function workspaceRow(workspace) {
  const commands = validationCommands(workspace);
  const state = commands.length ? `${commands.length} command${commands.length === 1 ? '' : 's'}` : 'Not configured';
  return `<div class="settings-validation-row">
    <div><strong>${escapeHtml(workspace.alias || 'workspace')}</strong><span>${escapeHtml(workspace.path || '')}</span></div>
    <span class="status-pill ${commands.length ? 'ok' : 'warn'}">${escapeHtml(state)}</span>
  </div>`;
}

function validationCommands(workspace) {
  return Array.isArray(workspace?.validationCommands) ? workspace.validationCommands.filter(Boolean) : [];
}

function fact(label, value, description) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(description)}</small></div>`;
}

function buildSaveRow(container) {
  const row = saveRow(() => save(container), () => loadAndRender(container));
  row.id = '__settings-save-row';
  row.hidden = true;
  markUnsaved(row, false);
  return row;
}

function checkDirty() {
  const row = document.getElementById('__settings-save-row');
  const dirty = draft.showAutomaticValidation !== original.showAutomaticValidation;
  if (row) {
    row.hidden = !dirty;
    markUnsaved(row, dirty);
  }
}

async function save(container) {
  const response = await saveSettings({
    productUx: { showAutomaticValidation: draft.showAutomaticValidation !== false }
  });
  if (!response?.ok) return response;
  requestDashboardRefresh();
  await loadAndRender(container);
  return response;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
