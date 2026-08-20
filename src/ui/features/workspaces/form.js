// Shared add/edit workspace form. Rename and path changes are saved atomically.
import { openModal, closeModal } from '../../components/modal.js';
import { fetchJson, postJson, invalidateCache, requestDashboardRefresh, DASHBOARD_DATA_URL } from '../../api.js';
import { toast } from '../../components/toast.js';
import { esc } from '../../utils.js';
import { runButtonAction } from '../../action-state.js';
import { getWorkspaceFilter, navigate, setWorkspaceFilter } from '../../router.js';
import { recordRecentWorkspace, renameRecentWorkspace } from './recents.js';
import { markUnsaved } from '../../interaction-safety.js';
import { deriveWorkspaceAlias, isValidWorkspaceAlias, normalizeWorkspacePath } from '../../workspace-input.js';

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function formSnapshot(form) {
  return new URLSearchParams(new FormData(form)).toString();
}

async function validatePath(p) {
  if (!p) return null;
  return fetchJson('/api/workspace/preflight?path=' + encodeURIComponent(p), { cache: 'no-store' });
}

function renderPathStatus(element, info) {
  element.className = 'ws-form-status';
  if (!info) { element.textContent = ''; return; }
  const errorFinding = (info.findings || []).find(finding => finding.severity === 'error');
  if (info.isGit) {
    element.textContent = 'Git project found. Rel.AI will find available checks automatically.';
    element.classList.add('success');
  } else if (info.exists && info.isDirectory) {
    element.textContent = 'This folder is not using Git, but you can still add it.';
    element.classList.add('warn');
  } else if (errorFinding) {
    element.textContent = `${errorFinding.message} You can save this folder before cloning the project.`;
    element.classList.add('warn');
  } else {
    element.textContent = '';
  }
}

export async function openWorkspaceForm({ mode = 'add', workspace = null, onSaved, onRemove } = {}) {
  const ws = workspace || {};
  const isEdit = mode === 'edit';
  const originalAlias = String(ws.alias || '').trim();
  const configured = await loadConfiguredWorkspaces();
  const form = document.createElement('form');
  form.className = 'ws-form ws-project-form';
  const isDesktop = document.documentElement.dataset.surface === 'desktop';
  form.innerHTML = `
    <section class="ws-project-name-section">
      <label class="ws-form-label" for="workspaceAliasInput">Project name</label>
      <div class="ws-project-name-field">
        <span class="ws-folder-icon" aria-hidden="true">${folderIconSvg()}</span>
        <input id="workspaceAliasInput" name="alias" type="text" value="${esc(ws.alias || '')}" placeholder="Project name" autocomplete="off">
      </div>
      <div class="ws-form-help">This is the project name ChatGPT uses when selecting a folder.</div>
      <div class="ws-form-conflict" data-conflict hidden role="alert"></div>
    </section>

    <section class="ws-source-section" aria-labelledby="wsSourceFolderHeading">
      <h3 class="ws-source-heading" id="wsSourceFolderHeading">Source folder</h3>
      <div class="ws-source-folder-box">
        <div data-source-picker-wrap ${isDesktop ? '' : 'hidden'}>
          <ul class="ws-source-folder-list">
            <li class="ws-source-folder-row" data-source-folder ${ws.path ? '' : 'hidden'}>
              <span class="ws-folder-icon" aria-hidden="true">${folderIconSvg()}</span>
              <span class="ws-source-folder-copy">
                <strong data-source-folder-name>${esc(folderDisplayName(ws.path || ''))}</strong>
                <small data-source-folder-path>${esc(ws.path || '')}</small>
              </span>
              <button type="button" class="ws-source-folder-change" data-browse>${isEdit ? 'Change' : 'Choose'}</button>
            </li>
          </ul>
          <button type="button" class="ws-source-folder-empty" data-source-empty data-browse ${ws.path ? 'hidden' : ''}>
            <span class="ws-folder-icon" aria-hidden="true">${folderIconSvg()}</span>
            <span>Choose a source folder Rel.AI can read and edit</span>
          </button>
        </div>
        <div class="ws-source-manual ws-source-manual-only" ${isDesktop ? 'hidden' : ''} data-manual-path-wrap>
          <label for="workspacePathInput">Folder path</label>
          <input class="ws-form-path" id="workspacePathInput" name="path" type="text" value="${esc(ws.path || '')}" placeholder="Absolute path to the project" autocomplete="off">
          <span class="ws-form-help">Enter the absolute path to the source folder Rel.AI can read and edit.</span>
        </div>
      </div>
      <div class="ws-form-status" data-path-status aria-live="polite"></div>
    </section>

    <footer class="modal-footer">
      ${isEdit ? `<div class="modal-danger-zone">
        <button type="button" class="secondary danger" data-delete-project>Delete project from Rel.AI</button>
        <span>Removes Rel.AI access only. Files stay on your computer.</span>
      </div>` : '<span></span>'}
      <div class="modal-actions">
        <button type="button" class="secondary" data-cancel>Cancel</button>
        <button type="submit" class="primary">${isEdit ? 'Save' : 'Create project'}</button>
      </div>
    </footer>
  `;

  const pathInput = form.querySelector('input[name="path"]');
  const aliasInput = form.querySelector('input[name="alias"]');
  const statusEl = form.querySelector('[data-path-status]');
  const conflictEl = form.querySelector('[data-conflict]');
  const browseBtns = [...form.querySelectorAll('[data-browse]')];
  const sourcePickerWrap = form.querySelector('[data-source-picker-wrap]');
  const sourceFolder = form.querySelector('[data-source-folder]');
  const sourceEmpty = form.querySelector('[data-source-empty]');
  const sourceFolderName = form.querySelector('[data-source-folder-name]');
  const sourceFolderPath = form.querySelector('[data-source-folder-path]');
  const manualPathWrap = form.querySelector('[data-manual-path-wrap]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const initialState = formSnapshot(form);
  const syncDirty = () => markUnsaved(form, formSnapshot(form) !== initialState);
  let modal = null;
  let aliasEdited = Boolean(isEdit || aliasInput.value.trim());
  let pathValidationGeneration = 0;

  const syncSourceFolder = () => {
    const value = pathInput.value.trim();
    if (sourceFolder) sourceFolder.hidden = !value;
    if (sourceEmpty) sourceEmpty.hidden = Boolean(value);
    if (sourceFolderName) sourceFolderName.textContent = folderDisplayName(value);
    if (sourceFolderPath) sourceFolderPath.textContent = value;
  };
  const suggestAlias = () => {
    if (aliasEdited) return;
    aliasInput.value = deriveWorkspaceAlias(pathInput.value);
  };
  const syncConflicts = () => {
    const message = workspaceConflict(configured, {
      alias: aliasInput.value,
      path: pathInput.value,
      originalAlias
    });
    conflictEl.hidden = !message;
    conflictEl.textContent = message;
    submitBtn.disabled = Boolean(message);
    return message;
  };
  const validateCurrentPath = async (value, generation) => {
    const info = await validatePath(value);
    if (generation !== pathValidationGeneration || pathInput.value.trim() !== value) return null;
    renderPathStatus(statusEl, info);
    return info;
  };
  const runValidate = debounce((value, generation) => {
    void validateCurrentPath(value, generation);
  }, 350);

  pathInput.addEventListener('input', () => {
    const value = pathInput.value.trim();
    const generation = ++pathValidationGeneration;
    syncSourceFolder();
    suggestAlias();
    syncConflicts();
    if (!value) renderPathStatus(statusEl, null);
    else runValidate(value, generation);
  });
  aliasInput.addEventListener('input', () => {
    aliasEdited = Boolean(aliasInput.value.trim());
    syncConflicts();
  });
  form.addEventListener('input', syncDirty);
  form.addEventListener('change', syncDirty);
  if (pathInput.value.trim()) {
    const value = pathInput.value.trim();
    runValidate(value, ++pathValidationGeneration);
  }
  syncConflicts();

  const browseForFolder = async trigger => {
    const idleMarkup = trigger.innerHTML;
    trigger.disabled = true;
    trigger.dataset.state = 'loading';
    trigger.setAttribute('aria-busy', 'true');
    let res;
    try {
      res = await postJson('/api/pick-folder', {}, { timeout: 0 });
    } catch (error) {
      res = { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      trigger.innerHTML = idleMarkup;
      trigger.disabled = false;
      delete trigger.dataset.state;
      trigger.removeAttribute('aria-busy');
    }
    if (res?.unsupported) {
      if (sourcePickerWrap) sourcePickerWrap.hidden = true;
      manualPathWrap.hidden = false;
      toast('Folder browsing is unavailable here — enter the folder path instead.', { variant: 'info' });
      pathInput.focus();
      return;
    }
    if (res?.canceled) return;
    if (res?.ok && res.path) {
      pathInput.value = res.path;
      syncSourceFolder();
      suggestAlias();
      syncDirty();
      syncConflicts();
      const value = pathInput.value.trim();
      await validateCurrentPath(value, ++pathValidationGeneration);
    } else if (res?.error) {
      toast('Could not open folder picker: ' + res.error, { variant: 'error' });
    }
  };
  for (const browseBtn of browseBtns) browseBtn.addEventListener('click', () => void browseForFolder(browseBtn));

  form.querySelector('[data-cancel]').addEventListener('click', () => { void modal?.dismiss(); });
  const deleteBtn = form.querySelector('[data-delete-project]');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (typeof onRemove !== 'function') return;
    const removed = await onRemove();
    if (!removed) return;
    markUnsaved(form, false);
    closeModal();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const alias = String(aliasInput.value || '').trim();
    const wsPath = pathInput.value.trim();
    if (!wsPath) {
      toast('Choose a source folder.', { variant: 'error' });
      const target = manualPathWrap.hidden ? sourceEmpty : pathInput;
      target?.focus();
      return;
    }
    if (!alias) { toast('Enter a project name.', { variant: 'error' }); aliasInput.focus(); return; }
    if (!isValidWorkspaceAlias(alias)) { toast('Project names may use only 1–80 letters, numbers, dots, underscores, and dashes.', { variant: 'error' }); aliasInput.focus(); return; }
    if (syncConflicts()) { conflictEl.focus?.(); return; }

    const result = await runButtonAction(submitBtn, {
      idleText: isEdit ? 'Save' : 'Create project',
      loadingText: 'Saving project…',
      successText: isEdit ? 'Project updated' : 'Project added',
      errorText: 'Save failed'
    }, () => postJson('/api/workspaces', {
      action: 'upsert',
      mode: isEdit ? 'update' : 'create',
      originalAlias: isEdit ? originalAlias : alias,
      alias,
      path: wsPath,
      enforceUniquePath: true
    }));
    if (result?.ok) {
      markUnsaved(form, false);
      closeModal();
      invalidateCache();
      requestDashboardRefresh({ structural: true });
      if (isEdit && originalAlias !== alias) renameRecentWorkspace(originalAlias, alias);
      recordRecentWorkspace(alias);
      toast(`${isEdit ? 'Project updated' : 'Project added'}: ${alias}`, { variant: 'success' });
      if (getWorkspaceFilter() === originalAlias && originalAlias !== alias) setWorkspaceFilter(alias);
      else if (typeof onSaved === 'function') onSaved({ result, alias, originalAlias });
      else if (isEdit) navigate('workspaces', { workspace: alias, focus: '1' });
    } else {
      const message = result?.error || 'unknown error';
      conflictEl.hidden = !/already (?:exists|configured)/i.test(message);
      if (!conflictEl.hidden) conflictEl.textContent = message;
      toast('Could not save project: ' + message, { variant: 'error' });
    }
  });

  modal = openModal({ title: isEdit ? 'Edit project' : 'Create project', content: form, size: 'standard' });
  syncSourceFolder();
  setTimeout(() => {
    try {
      const initialFocus = isEdit ? aliasInput : (pathInput.value.trim() ? aliasInput : sourceEmpty);
      initialFocus?.focus();
      if (isEdit) aliasInput.select();
    } catch (error) {
      if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    }
  }, 0);
}

function folderDisplayName(value) {
  const normalized = String(value || '').trim().replace(/[\\/]+$/, '');
  if (!normalized) return '';
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || normalized;
}

function folderIconSvg() {
  return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 6.75A1.75 1.75 0 0 1 5.5 5h4l2 2h7A1.75 1.75 0 0 1 20.25 8.75v8A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25z"/></svg>';
}

async function loadConfiguredWorkspaces() {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
  return Array.isArray(dashboard?.config?.workspaces) ? dashboard.config.workspaces : [];
}

function workspaceConflict(workspaces, values) {
  const alias = String(values.alias || '').trim();
  const workspacePath = normalizeWorkspacePath(values.path);
  const originalAlias = String(values.originalAlias || '').trim();
  if (alias && !isValidWorkspaceAlias(alias)) return 'Project names may use only 1–80 letters, numbers, dots, underscores, and dashes.';
  const aliasConflict = workspaces.find(item => item.alias === alias && item.alias !== originalAlias);
  if (aliasConflict) return `Project name '${alias}' is already in use.`;
  const pathConflict = workspacePath
    ? workspaces.find(item => item.alias !== originalAlias && normalizeWorkspacePath(item.path) === workspacePath)
    : null;
  return pathConflict ? `This project folder is already configured as '${pathConflict.alias}'.` : '';
}

