import { postJson, requestDashboardRefresh } from '../../api.js';
import { get as getStore } from '../../store.js';
import { toast } from '../../components/toast.js';
import { openWorkspaceForm } from './form.js';
import { openWorkspaceRepair } from './repair.js';
import { runButtonAction } from '../../action-state.js';
import { getWorkspaceFilter, navigate, setWorkspaceFilter } from '../../router.js';
import { recordRecentWorkspace, removeRecentWorkspace } from './recents.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { closeModal } from '../../components/modal.js';

const WORKSPACE_CLICK_ACTIONS = [
  { selector: '[data-add-workspace]', handler: () => openWorkspaceForm({ mode: 'add' }) },
  { selector: '[data-edit-workspace]', handler: editWorkspaceFromTrigger },
  { selector: '[data-repair-workspace],[data-finding-repair]', handler: repairWorkspaceFromTrigger },
  { selector: '[data-open-recent-workspace]', handler: openRecentWorkspace },
  { selector: '[data-finding-remove]', handler: trigger => removeWorkspaceFlow(trigger.dataset.findingRemove || '') },
  { selector: '[data-clear-workspace]', handler: removeWorkspaceFromTrigger },
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
  const configuredWorkspaces = currentConfiguredWorkspaces();
  const workspace = configuredWorkspaces.find(item => item.alias === alias) || null;
  if (!workspace) {
    toast(`Project not found: ${alias}`, { variant: 'error' });
    return;
  }
  await openWorkspaceForm({
    mode: 'edit',
    workspace,
    configuredWorkspaces,
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

async function openFolderFromTrigger(trigger) {
  const alias = trigger.dataset.openFolder || '';
  recordRecentWorkspace(alias);
  const result = await runButtonAction(trigger, {
    idleText: 'Project folder',
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

function loadWorkspace(alias) {
  const workspace = currentConfiguredWorkspaces().find(item => item.alias === alias) || null;
  if (!workspace) toast(`Project not found: ${alias}`, { variant: 'error' });
  return workspace;
}

function currentConfiguredWorkspaces() {
  const workspaces = getStore()?.config?.workspaces;
  return Array.isArray(workspaces) ? workspaces : [];
}
