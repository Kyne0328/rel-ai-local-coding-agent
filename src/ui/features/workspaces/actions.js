import { fetchJson, postJson, DASHBOARD_DATA_URL, requestDashboardRefresh } from '../../api.js';
import { toast } from '../../components/toast.js';
import { openWorkspaceForm } from './form.js';
import { openWorkspaceRepair } from './repair.js';
import { runButtonAction } from '../../action-state.js';
import { getWorkspaceFilter, navigate, setWorkspaceFilter } from '../../router.js';
import { recordRecentWorkspace, removeRecentWorkspace } from './recents.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { closeModal, openModal } from '../../components/modal.js';

const WORKSPACE_CLICK_ACTIONS = [
  { selector: '[data-add-workspace]', handler: () => openWorkspaceForm({ mode: 'add' }) },
  { selector: '[data-edit-workspace]', handler: editWorkspaceFromTrigger },
  { selector: '[data-repair-workspace],[data-finding-repair]', handler: repairWorkspaceFromTrigger },
  { selector: '[data-open-recent-workspace]', handler: openRecentWorkspace },
  { selector: '[data-finding-remove]', handler: trigger => removeWorkspaceFlow(trigger.dataset.findingRemove || '') },
  { selector: '[data-clear-workspace]', handler: removeWorkspaceFromTrigger },
  { selector: '[data-run-validation]', handler: runValidationFromTrigger },
  { selector: '[data-repository-details]', handler: openRepositoryDetails },
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
  const alias = trigger.dataset.editWorkspace || '';
  const workspace = await loadWorkspace(alias);
  if (workspace) await openWorkspaceForm({
    mode: 'edit',
    workspace,
    onRemove: () => removeWorkspaceFlow(alias)
  });
}

async function repairWorkspaceFromTrigger(trigger) {
  const alias = trigger.dataset.repairWorkspace || trigger.dataset.findingRepair || '';
  const workspace = await loadWorkspace(alias);
  if (workspace) await openWorkspaceRepair({ workspace });
}

function openRecentWorkspace(trigger) {
  const alias = trigger.dataset.openRecentWorkspace || '';
  if (!alias) return;
  recordRecentWorkspace(alias);
  navigate('workspaces', { workspace: alias, focus: '1' });
}

async function runValidationFromTrigger(trigger) {
  const alias = trigger.dataset.runValidation || '';
  recordRecentWorkspace(alias);
  const result = await runButtonAction(trigger, {
    idleText: 'Run checks',
    loadingText: 'Running checks…',
    successText: 'Checks complete',
    errorText: 'Checks failed'
  }, () => postJson('/api/workspace/checks', { workspace: alias }, { timeout: 0 }));

  if (result?.ok === false) {
    toast(`Checks failed for ${alias}: ${result.error || result.message || 'review the task details'}`, { variant: 'error' });
  } else {
    toast(`Checks completed for ${alias}.`, { variant: 'success' });
  }
  requestDashboardRefresh({ structural: true });
}

function openRepositoryDetails(trigger) {
  const alias = trigger.dataset.repositoryDetails || '';
  if (alias) recordRecentWorkspace(alias);
  const card = trigger.closest?.('[data-workspace-card]');
  const source = card?.querySelector?.('.workspace-details-body');
  if (!source) return;
  const content = source.cloneNode(true);
  for (const link of content.querySelectorAll('a[href^="#"]')) link.addEventListener('click', closeModal);
  openModal({ title: alias ? `Project details · ${alias}` : 'Project details', content, size: 'standard' });
}

async function openFolderFromTrigger(trigger) {
  const alias = trigger.dataset.openFolder || '';
  recordRecentWorkspace(alias);
  const result = await runButtonAction(trigger, {
    idleText: 'Open folder',
    loadingText: 'Opening…',
    successText: 'Folder opened',
    errorText: 'Open failed'
  }, () => postJson('/api/open-folder', { workspace: alias }));
  if (result?.ok === false) toast(result.error || 'Folder opening is only available in the desktop app.', { variant: 'warn' });
}

async function removeWorkspaceFromTrigger(trigger) {
  const removed = await removeWorkspaceFlow(trigger.dataset.clearWorkspace || '');
  if (removed && trigger.closest('.modal-panel')) closeModal();
}

async function removeWorkspaceFlow(alias) {
  const confirmed = await confirmAction({
    title: 'Delete project from Rel.AI?',
    message: `'${alias}' will be removed from Rel.AI.`,
    detail: 'Its source folders and every file inside them will stay on your computer. Rel.AI will no longer access those folders through this project.',
    confirmLabel: 'Delete from Rel.AI',
    danger: true
  });
  if (!confirmed) return false;
  const result = await postJson('/api/workspaces', { action: 'delete', alias, confirmDelete: true });
  if (result?.ok) {
    removeRecentWorkspace(alias);
    toast(`Project deleted from Rel.AI: ${alias}`, { variant: 'success' });
    if (getWorkspaceFilter() === alias) setWorkspaceFilter('');
    else requestDashboardRefresh({ structural: true });
    return true;
  }
  toast(`Could not delete project from Rel.AI: ${result?.error || 'unknown error'}`, { variant: 'error' });
  return false;
}

async function loadWorkspace(alias) {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
  const workspace = Array.isArray(dashboard?.config?.workspaces)
    ? dashboard.config.workspaces.find(item => item.alias === alias)
    : null;
  if (!workspace) toast(`Project not found: ${alias}`, { variant: 'error' });
  return workspace;
}
