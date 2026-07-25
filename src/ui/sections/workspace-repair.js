import { openModal, closeModal } from '../components/modal.js';
import { fetchJson, postJson, invalidateCache, requestDashboardRefresh, DASHBOARD_DATA_URL } from '../api.js';
import { toast } from '../components/toast.js';
import { esc } from '../utils.js';
import { runButtonAction } from '../action-state.js';
import { navigate } from '../router.js';
import { recordRecentWorkspace } from '../workspace-recents.js';
import { markUnsaved } from '../interaction-safety.js';

export async function openWorkspaceRepair({ workspace } = {}) {
  if (!workspace?.alias) return;
  const workspaces = await loadConfiguredWorkspaces();
  const form = document.createElement('form');
  form.className = 'ws-form workspace-repair-form';
  form.innerHTML = `
    <div class="ws-form-intro">
      <strong>Repair project folder</strong>
      <span>Rel.AI will keep the workspace name, validation history, and Git safeguards. Only the folder path will change.</span>
    </div>
    <div class="workspace-repair-identity">
      <span>Workspace</span>
      <strong>${esc(workspace.alias)}</strong>
      <small>${esc(workspace.path || 'No path configured')}</small>
    </div>
    <label for="workspaceRepairPathInput">New project folder</label>
    <div class="ws-form-row">
      <input class="ws-form-path" id="workspaceRepairPathInput" name="path" value="${esc(workspace.path || '')}" placeholder="Absolute path to the project" autocomplete="off">
      <button type="button" class="secondary" data-browse>Browse…</button>
    </div>
    <div class="ws-form-status" data-path-status aria-live="polite"></div>
    <div class="ws-form-conflict" data-conflict hidden role="alert"></div>
    <div class="ws-form-actions">
      <button type="button" class="secondary" data-cancel>Cancel</button>
      <button type="submit" class="primary">Repair workspace path</button>
    </div>`;

  const pathInput = form.querySelector('input[name="path"]');
  const browseButton = form.querySelector('[data-browse]');
  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-path-status]');
  const conflict = form.querySelector('[data-conflict]');
  const initialPath = pathInput.value.trim();
  const syncDirty = () => markUnsaved(form, pathInput.value.trim() !== initialPath);
  let modal = null;
  let validationSequence = 0;

  const sync = async () => {
    const currentSequence = ++validationSequence;
    const pathValue = pathInput.value.trim();
    const duplicate = duplicateWorkspaceForPath(workspaces, pathValue, workspace.alias);
    conflict.hidden = !duplicate;
    conflict.textContent = duplicate ? `This folder is already configured as workspace '${duplicate.alias}'.` : '';
    submitButton.disabled = !pathValue || Boolean(duplicate);
    if (!pathValue) {
      renderPathStatus(status, null);
      return;
    }
    const result = await fetchJson('/api/workspace/preflight?path=' + encodeURIComponent(pathValue), { cache: 'no-store' });
    if (currentSequence === validationSequence) renderPathStatus(status, result);
  };

  pathInput.addEventListener('input', () => {
    syncDirty();
    debounceSync();
  });
  const debounceSync = debounce(sync, 300);
  form.querySelector('[data-cancel]').addEventListener('click', () => modal?.dismiss());
  browseButton.addEventListener('click', async () => {
    const result = await runButtonAction(browseButton, {
      idleText: 'Browse…',
      loadingText: 'Opening folder picker…',
      successText: 'Folder selected',
      errorText: 'Browse failed'
    }, () => postJson('/api/pick-folder', {}, { timeout: 0 }));
    if (result?.unsupported) {
      browseButton.hidden = true;
      toast('Browse needs the Rel.AI desktop launcher — type the path here instead.', { variant: 'info' });
      return;
    }
    if (result?.ok && result.path) {
      pathInput.value = result.path;
      syncDirty();
      await sync();
    } else if (result?.error && !result?.canceled) {
      toast('Could not open folder picker: ' + result.error, { variant: 'error' });
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const newPath = pathInput.value.trim();
    const duplicate = duplicateWorkspaceForPath(workspaces, newPath, workspace.alias);
    if (!newPath) { toast('Choose the new project folder.', { variant: 'error' }); pathInput.focus(); return; }
    if (duplicate) {
      conflict.hidden = false;
      conflict.textContent = `This folder is already configured as workspace '${duplicate.alias}'.`;
      return;
    }
    const result = await runButtonAction(submitButton, {
      idleText: 'Repair workspace path',
      loadingText: 'Saving repaired path…',
      successText: 'Workspace repaired',
      errorText: 'Repair failed'
    }, () => postJson('/api/workspaces', {
      action: 'upsert',
      mode: 'update',
      originalAlias: workspace.alias,
      alias: workspace.alias,
      path: newPath,
      enforceUniquePath: true
    }));
    if (!result?.ok) {
      const message = result?.error || 'unknown error';
      if (/already configured/i.test(message)) {
        conflict.hidden = false;
        conflict.textContent = message;
      }
      toast('Could not repair workspace: ' + message, { variant: 'error' });
      return;
    }
    markUnsaved(form, false);
    closeModal();
    invalidateCache();
    requestDashboardRefresh();
    recordRecentWorkspace(workspace.alias);
    toast(`Workspace path repaired: ${workspace.alias}`, { variant: 'success' });
    navigate('workspaces', { workspace: workspace.alias, focus: '1' });
  });

  modal = openModal({ title: `Repair path · ${workspace.alias}`, content: form });
  setTimeout(() => {
    pathInput.focus();
    pathInput.select();
  }, 0);
  await sync();
}

async function loadConfiguredWorkspaces() {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
  return Array.isArray(dashboard?.config?.workspaces) ? dashboard.config.workspaces : [];
}

function duplicateWorkspaceForPath(workspaces, candidatePath, excludedAlias) {
  const target = normalizePath(candidatePath);
  if (!target) return null;
  return workspaces.find(item => item.alias !== excludedAlias && normalizePath(item.path) === target) || null;
}

function renderPathStatus(element, info) {
  element.className = 'ws-form-status';
  if (!info) { element.textContent = ''; return; }
  const errorFinding = (info.findings || []).find(finding => finding.severity === 'error');
  if (info.isGit) {
    element.textContent = 'Git repository found. Existing workspace settings will be preserved.';
    element.classList.add('success');
  } else if (info.exists && info.isDirectory) {
    element.textContent = 'This folder exists but is not a Git repository. It can still be used.';
    element.classList.add('warn');
  } else if (errorFinding) {
    element.textContent = errorFinding.message;
    element.classList.add('error');
  } else {
    element.textContent = 'The selected folder could not be verified.';
    element.classList.add('warn');
  }
}

function normalizePath(value) {
  const normalized = String(value || '').trim().replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void fn(...args), ms);
  };
}
