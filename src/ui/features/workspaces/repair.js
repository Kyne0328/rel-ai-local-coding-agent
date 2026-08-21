import { openModal, closeModal } from '../../components/modal.js';
import { fetchJson, postJson, invalidateCache, requestDashboardRefresh, DASHBOARD_DATA_URL } from '../../api.js';
import { toast } from '../../components/toast.js';
import { esc } from '../../utils.js';
import { runButtonAction } from '../../action-state.js';
import { navigate } from '../../router.js';
import { recordRecentWorkspace } from './recents.js';
import { markUnsaved } from '../../interaction-safety.js';

export async function openWorkspaceRepair({ workspace } = {}) {
  if (!workspace?.alias) return;
  const workspaces = await loadConfiguredWorkspaces();
  const isDesktop = document.documentElement.dataset.surface === 'desktop';
  const form = document.createElement('form');
  form.className = 'ws-form workspace-repair-form';
  form.innerHTML = `
    <p class="workspace-repair-copy">Rel.AI will keep the project name, check history, and Git safety settings. Only the source-folder location will change.</p>
    <div class="workspace-repair-identity">
      <span>Project</span>
      <strong>${esc(workspace.alias)}</strong>
      <small>${esc(workspace.path || 'No source folder configured')}</small>
    </div>
    <section class="ws-source-section" aria-labelledby="workspaceRepairSourceHeading">
      <h3 class="ws-source-heading" id="workspaceRepairSourceHeading">Replacement source folder</h3>
      <div class="ws-source-folder-box">
        <div data-source-picker-wrap ${isDesktop ? '' : 'hidden'}>
          <div class="ws-source-folder-row">
            <span class="ws-source-folder-copy">
              <strong data-source-folder-name>${esc(folderDisplayName(workspace.path || ''))}</strong>
              <small data-source-folder-path>${esc(workspace.path || '')}</small>
            </span>
            <button type="button" class="ws-source-folder-change" data-browse>Change</button>
          </div>
        </div>
        <div class="ws-source-manual ws-source-manual-only" ${isDesktop ? 'hidden' : ''} data-manual-path-wrap>
          <label for="workspaceRepairPathInput">Folder path</label>
          <input class="ws-form-path" id="workspaceRepairPathInput" name="path" value="${esc(workspace.path || '')}" placeholder="Absolute path to the project" autocomplete="off">
          <span class="ws-form-help">Enter the absolute path to the replacement source folder.</span>
        </div>
      </div>
      <div class="ws-form-status" data-path-status aria-live="polite"></div>
      <div class="ws-form-conflict" data-conflict hidden role="alert"></div>
    </section>
    <footer class="modal-footer">
      <span></span>
      <div class="modal-actions">
        <button type="button" class="secondary" data-cancel>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </footer>`;

  const pathInput = form.querySelector('input[name="path"]');
  const sourcePickerWrap = form.querySelector('[data-source-picker-wrap]');
  const manualPathWrap = form.querySelector('[data-manual-path-wrap]');
  const browseButton = form.querySelector('[data-browse]');
  const sourceFolderName = form.querySelector('[data-source-folder-name]');
  const sourceFolderPath = form.querySelector('[data-source-folder-path]');
  const submitButton = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-path-status]');
  const conflict = form.querySelector('[data-conflict]');
  const initialPath = pathInput.value.trim();
  const syncDirty = () => markUnsaved(form, pathInput.value.trim() !== initialPath);
  const syncSourceFolder = () => {
    const value = pathInput.value.trim();
    if (sourceFolderName) sourceFolderName.textContent = folderDisplayName(value) || 'Choose a folder';
    if (sourceFolderPath) sourceFolderPath.textContent = value;
  };
  let modal = null;
  let validationSequence = 0;

  const sync = async () => {
    const currentSequence = ++validationSequence;
    const pathValue = pathInput.value.trim();
    const duplicate = duplicateWorkspaceForPath(workspaces, pathValue, workspace.alias);
    conflict.hidden = !duplicate;
    conflict.textContent = duplicate ? `This folder is already configured as project '${duplicate.alias}'.` : '';
    submitButton.disabled = !pathValue || Boolean(duplicate);
    syncSourceFolder();
    if (!pathValue) {
      renderPathStatus(status, null);
      return;
    }
    const result = await fetchJson('/api/workspace/preflight?path=' + encodeURIComponent(pathValue), { cache: 'no-store' });
    if (currentSequence === validationSequence) renderPathStatus(status, result);
  };

  pathInput.addEventListener('input', () => {
    syncDirty();
    syncSourceFolder();
    debounceSync();
  });
  const debounceSync = debounce(sync, 300);
  form.querySelector('[data-cancel]').addEventListener('click', () => { void modal?.dismiss(); });
  browseButton?.addEventListener('click', async () => {
    const result = await runButtonAction(browseButton, {
      idleText: 'Change',
      loadingText: 'Opening folder picker…',
      successText: 'Folder selected',
      errorText: 'Browse failed'
    }, () => postJson('/api/pick-folder', {}, { timeout: 0 }));
    if (result?.unsupported) {
      if (sourcePickerWrap) sourcePickerWrap.hidden = true;
      manualPathWrap.hidden = false;
      toast('Folder browsing is unavailable here — enter the folder path instead.', { variant: 'info' });
      pathInput.focus();
      return;
    }
    if (result?.ok && result.path) {
      pathInput.value = result.path;
      syncDirty();
      syncSourceFolder();
      await sync();
    } else if (result?.error && !result?.canceled) {
      toast('Could not open folder picker: ' + result.error, { variant: 'error' });
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const newPath = pathInput.value.trim();
    const duplicate = duplicateWorkspaceForPath(workspaces, newPath, workspace.alias);
    if (!newPath) { toast('Choose the replacement source folder.', { variant: 'error' }); pathInput.focus(); return; }
    if (duplicate) {
      conflict.hidden = false;
      conflict.textContent = `This folder is already configured as project '${duplicate.alias}'.`;
      return;
    }
    const result = await runButtonAction(submitButton, {
      idleText: 'Save',
      loadingText: 'Saving source folder…',
      successText: 'Project repaired',
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
      toast('Could not repair project: ' + message, { variant: 'error' });
      return;
    }
    markUnsaved(form, false);
    closeModal();
    invalidateCache();
    requestDashboardRefresh({ structural: true });
    recordRecentWorkspace(workspace.alias);
    toast(`Project folder repaired: ${workspace.alias}`, { variant: 'success' });
    navigate('workspaces', { workspace: workspace.alias, focus: '1' });
  });

  modal = openModal({ title: 'Repair project', content: form, size: 'standard' });
  setTimeout(() => {
    if (manualPathWrap.hidden) browseButton?.focus();
    else {
      pathInput.focus();
      pathInput.select();
    }
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
  return workspaces.find(item => item.alias !== excludedAlias && workspaceSourcePaths(item).some(sourcePath => normalizePath(sourcePath) === target)) || null;
}

function workspaceSourcePaths(workspace) {
  return [workspace?.path, ...(Array.isArray(workspace?.sourcePaths) ? workspace.sourcePaths : [])].filter(Boolean);
}

function renderPathStatus(element, info) {
  element.className = 'ws-form-status';
  if (!info) { element.textContent = ''; return; }
  const errorFinding = (info.findings || []).find(finding => finding.severity === 'error');
  if (info.isGit) {
    element.textContent = 'Git project found. Your project settings will be kept.';
    element.classList.add('success');
  } else if (info.exists && info.isDirectory) {
    element.textContent = 'This folder is not using Git, but you can still use it.';
    element.classList.add('warn');
  } else if (errorFinding) {
    element.textContent = errorFinding.message;
    element.classList.add('error');
  } else {
    element.textContent = 'The selected folder could not be verified.';
    element.classList.add('warn');
  }
}

function folderDisplayName(value) {
  const normalized = String(value || '').trim().replace(/[\\/]+$/, '');
  if (!normalized) return '';
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || normalized;
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
