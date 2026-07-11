import { fetchJson, postJson, DASHBOARD_DATA_URL, requestDashboardRefresh } from '../api.js';
import { toast } from '../components/toast.js';
import { openWorkspaceForm } from './workspace-form.js';
import { runButtonAction } from '../action-state.js';
import { getWorkspaceFilter, setWorkspaceFilter } from '../router.js';

const WORKSPACE_CLICK_ACTIONS = [
  { selector: '[data-add-workspace]', handler: () => openWorkspaceForm({ mode: 'add' }) },
  { selector: '[data-edit-workspace],[data-fix-path],[data-finding-edit]', handler: editWorkspaceFromTrigger },
  { selector: '[data-finding-remove]', handler: trigger => removeWorkspaceFlow(trigger.dataset.findingRemove || '') },
  { selector: '[data-clear-workspace]', handler: trigger => removeWorkspaceFlow(trigger.dataset.clearWorkspace || '') },
  { selector: '[data-run-validation]', handler: runValidationFromTrigger },
  { selector: '[data-open-folder]', handler: openFolderFromTrigger }
];

let bound = false;
export function bindWorkspaceActions() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', handleWorkspaceClick);
}

async function handleWorkspaceClick(event) {
  for (const action of WORKSPACE_CLICK_ACTIONS) {
    const trigger = event.target?.closest?.(action.selector) ?? null;
    if (!trigger) continue;
    await action.handler(trigger);
    return;
  }
}

async function editWorkspaceFromTrigger(trigger) {
  const alias = trigger.dataset.editWorkspace || trigger.dataset.fixPath || trigger.dataset.findingEdit || '';
  const workspace = await loadWorkspace(alias);
  if (workspace) openWorkspaceForm({ mode: 'edit', workspace });
}

async function runValidationFromTrigger(trigger) {
  const alias = trigger.dataset.runValidation || '';
  const result = await runButtonAction(trigger, {
    idleText: 'Run validation',
    loadingText: 'Validating…',
    successText: 'Validation complete',
    errorText: 'Validation failed'
  }, () => postJson('/api/workspace/checks', { workspace: alias }, { timeout: 0 }));

  if (result?.ok === false) {
    toast(`Validation failed for ${alias}: ${result.error || result.message || 'review the task details'}`, { variant: 'error' });
  } else {
    toast(`Validation completed for ${alias}.`, { variant: 'success' });
  }
  requestDashboardRefresh();
}

async function openFolderFromTrigger(trigger) {
  const alias = trigger.dataset.openFolder || '';
  const result = await runButtonAction(trigger, {
    idleText: 'Open folder',
    loadingText: 'Opening…',
    successText: 'Folder opened',
    errorText: 'Open failed'
  }, () => postJson('/api/open-folder', { workspace: alias }));
  if (result?.ok === false) toast(result.error || 'Folder opening is only available in the desktop app.', { variant: 'warn' });
}

async function removeWorkspaceFlow(alias) {
  const confirmed = window.confirm(`Remove workspace '${alias}' from Rel.AI? The repository and its files will not be changed.`);
  if (!confirmed) return;
  const result = await postJson('/api/workspaces', { action: 'clear', alias, confirmClear: true });
  if (result?.ok) {
    toast(`Workspace removed: ${alias}`, { variant: 'success' });
    if (getWorkspaceFilter() === alias) setWorkspaceFilter('');
    else requestDashboardRefresh();
  } else {
    toast(`Could not remove workspace: ${result?.error || 'unknown error'}`, { variant: 'error' });
  }
}

async function loadWorkspace(alias) {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL);
  const workspace = Array.isArray(dashboard?.config?.workspaces)
    ? dashboard.config.workspaces.find(item => item.alias === alias)
    : null;
  if (!workspace) toast(`Workspace not found: ${alias}`, { variant: 'error' });
  return workspace;
}
