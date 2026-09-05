// Shared add/edit workspace form. Rename and source-folder changes are saved atomically.
import { openModal, closeModal } from '../../components/modal.js';
import { fetchJson, postJson, invalidateCache, requestDashboardRefresh, DASHBOARD_DATA_URL } from '../../api.js';
import { toast } from '../../components/toast.js';
import { esc } from '../../utils.js';
import { runButtonAction } from '../../action-state.js';
import { getWorkspaceFilter, navigate, routeHref, setWorkspaceFilter } from '../../router.js';
import { recordRecentWorkspace, renameRecentWorkspace } from './recents.js';
import { markUnsaved } from '../../interaction-safety.js';
import { deriveWorkspaceAlias, isValidWorkspaceAlias, normalizeWorkspacePath } from '../../workspace-input.js';
import { workspaceOperationalHtml } from './details.js';
import { iconHtml } from '../../components/icons.js';

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

function renderPathsStatus(element, paths, infos) {
  if (paths.length <= 1) {
    renderPathStatus(element, infos[0] || null);
    return;
  }
  element.className = 'ws-form-status';
  const gitCount = infos.filter(info => info?.isGit).length;
  const directoryCount = infos.filter(info => info?.exists && info?.isDirectory).length;
  const unavailableCount = paths.length - directoryCount;
  const nonGitCount = Math.max(0, directoryCount - gitCount);
  const parts = [`${paths.length} source folders selected`];
  if (gitCount) parts.push(`${gitCount} Git ${gitCount === 1 ? 'project' : 'projects'}`);
  if (nonGitCount) parts.push(`${nonGitCount} non-Git ${nonGitCount === 1 ? 'folder' : 'folders'}`);
  if (unavailableCount) parts.push(`${unavailableCount} not available yet`);
  element.textContent = parts.join(' · ');
  element.classList.add(unavailableCount || nonGitCount ? 'warn' : 'success');
}

export async function openWorkspaceForm({ mode = 'add', workspace = null, configuredWorkspaces = null, onSaved, onRemove } = {}) {
  const ws = workspace || {};
  const isEdit = mode === 'edit';
  const originalAlias = String(ws.alias || '').trim();
  const configured = Array.isArray(configuredWorkspaces) ? configuredWorkspaces : await loadConfiguredWorkspaces();
  const initialPaths = sourcePathsFromWorkspace(ws);
  const form = document.createElement('form');
  form.className = 'ws-form ws-project-form';
  const isDesktop = document.documentElement.dataset.surface === 'desktop';
  form.innerHTML = `
    <section class="ws-project-name-section">
      <label class="ws-form-label" for="workspaceAliasInput">Project name</label>
      <div class="ws-project-name-field">
        <span class="ws-folder-icon" aria-hidden="true">${iconHtml('folder')}</span>
        <input id="workspaceAliasInput" name="alias" type="text" value="${esc(ws.alias || '')}" placeholder="Project name" autocomplete="off" aria-describedby="workspaceAliasHelp workspaceAliasError">
      </div>
      <div class="ws-form-help" id="workspaceAliasHelp">This is the project name ChatGPT uses when selecting a folder.</div>
      <div class="ws-form-conflict" id="workspaceAliasError" data-alias-error hidden role="alert"></div>
      <div class="ws-form-conflict" data-conflict hidden role="alert" tabindex="-1"></div>
    </section>

    <section class="ws-source-section" aria-labelledby="wsSourceFolderHeading">
      <h3 class="ws-source-heading" id="wsSourceFolderHeading">Source folders</h3>
      <div class="ws-source-folder-box">
        <div data-source-picker-wrap ${isDesktop ? '' : 'hidden'}>
          <ul class="ws-source-folder-list" data-source-folder-list>${renderSourceFolderRows(initialPaths)}</ul>
          <button type="button" class="ws-source-folder-empty" data-source-empty data-add-source aria-describedby="workspaceSourceError" ${initialPaths.length ? 'hidden' : ''}>
            <span class="ws-folder-icon" aria-hidden="true">${iconHtml('folder')}</span>
            <span>Choose a source folder</span>
          </button>
          <button type="button" class="ws-source-folder-add" data-source-add data-add-source ${initialPaths.length ? '' : 'hidden'}>+ Add source folder</button>
        </div>
        <div class="ws-source-manual ws-source-manual-only" ${isDesktop ? 'hidden' : ''} data-manual-path-wrap>
          <label for="workspacePathsInput">Folder paths</label>
          <textarea class="ws-form-path" id="workspacePathsInput" name="paths" rows="4" placeholder="One absolute folder path per line" autocomplete="off" aria-describedby="workspacePathsHelp workspaceSourceError">${esc(initialPaths.join('\n'))}</textarea>
          <span class="ws-form-help" id="workspacePathsHelp">Enter one absolute source-folder path per line.</span>
        </div>
      </div>
      <div class="ws-form-help">The first folder is the primary repository used for project-level Git and command actions.</div>
      <div class="ws-form-conflict" id="workspaceSourceError" data-source-error hidden role="alert"></div>
      <div class="ws-form-status" data-path-status aria-live="polite"></div>
    </section>

    ${isEdit ? `<section class="ws-project-details-section" aria-labelledby="wsProjectDetailsHeading">
      <h3 class="ws-source-heading" id="wsProjectDetailsHeading">Project details</h3>
      <div class="ws-project-details-box">
        ${workspaceOperationalHtml(ws)}
        <div class="workspace-secondary-actions">
          <a class="buttonlike secondary" href="${routeHref('tasks', { workspace: originalAlias })}">View tasks</a>
          <a class="buttonlike secondary" href="${routeHref('activity', { workspace: originalAlias })}">View activity</a>
        </div>
      </div>
    </section>` : ''}

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

  const pathsInput = form.querySelector('textarea[name="paths"]');
  const aliasInput = form.querySelector('input[name="alias"]');
  const statusEl = form.querySelector('[data-path-status]');
  const aliasErrorEl = form.querySelector('[data-alias-error]');
  const sourceErrorEl = form.querySelector('[data-source-error]');
  const conflictEl = form.querySelector('[data-conflict]');
  const sourcePickerWrap = form.querySelector('[data-source-picker-wrap]');
  const sourceFolderList = form.querySelector('[data-source-folder-list]');
  const sourceEmpty = form.querySelector('[data-source-empty]');
  const sourceAdd = form.querySelector('[data-source-add]');
  const manualPathWrap = form.querySelector('[data-manual-path-wrap]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const initialState = formSnapshot(form);
  const syncDirty = () => markUnsaved(form, formSnapshot(form) !== initialState);
  let modal = null;
  let aliasEdited = Boolean(isEdit || aliasInput.value.trim());
  let pathValidationGeneration = 0;

  const getSourcePaths = () => parseSourcePaths(pathsInput.value);
  const setSourcePaths = paths => { pathsInput.value = normalizeSourcePaths(paths).join('\n'); };
  const setFieldError = (element, targets, message) => {
    const hasError = Boolean(message);
    element.hidden = !hasError;
    element.textContent = message || '';
    for (const target of targets) target?.setAttribute('aria-invalid', String(hasError));
  };
  const validateLocal = ({ required = false } = {}) => {
    const alias = String(aliasInput.value || '').trim();
    const paths = getSourcePaths();
    const normalizedPaths = paths.map(normalizeWorkspacePath).filter(Boolean);
    const aliasMessage = !alias
      ? (required ? 'Enter a project name.' : '')
      : !isValidWorkspaceAlias(alias)
        ? 'Project names may use only 1–80 letters, numbers, dots, underscores, and dashes.'
        : '';
    const sourceMessage = !paths.length
      ? (required ? 'Choose at least one source folder.' : '')
      : new Set(normalizedPaths).size !== normalizedPaths.length
        ? 'Each source folder can be added only once.'
        : '';
    setFieldError(aliasErrorEl, [aliasInput], aliasMessage);
    setFieldError(sourceErrorEl, [sourceEmpty, pathsInput], sourceMessage);
    return { aliasMessage, sourceMessage };
  };
  const suggestAlias = () => {
    if (aliasEdited) return;
    aliasInput.value = deriveWorkspaceAlias(getSourcePaths()[0] || '');
  };
  const syncSourceFolders = () => {
    const paths = getSourcePaths();
    sourceFolderList.innerHTML = renderSourceFolderRows(paths);
    sourceEmpty.hidden = Boolean(paths.length);
    sourceAdd.hidden = !paths.length;
  };
  const syncConflicts = () => {
    const message = workspaceConflict(configured, {
      alias: aliasInput.value,
      paths: getSourcePaths(),
      originalAlias
    });
    conflictEl.hidden = !message;
    conflictEl.textContent = message;
    submitBtn.disabled = Boolean(message);
    return message;
  };
  const validateCurrentPaths = async (paths, generation) => {
    const infos = await Promise.all(paths.map(value => validatePath(value).catch(() => null)));
    if (generation !== pathValidationGeneration) return null;
    const currentPaths = getSourcePaths();
    if (currentPaths.length !== paths.length || currentPaths.some((value, index) => value !== paths[index])) return null;
    renderPathsStatus(statusEl, paths, infos);
    return infos;
  };
  const runValidate = debounce((paths, generation) => {
    void validateCurrentPaths(paths, generation);
  }, 350);
  const syncPathState = ({ validate = true } = {}) => {
    const paths = getSourcePaths();
    const generation = ++pathValidationGeneration;
    syncSourceFolders();
    suggestAlias();
    validateLocal();
    syncConflicts();
    if (!paths.length) renderPathStatus(statusEl, null);
    else if (validate) runValidate(paths, generation);
  };

  pathsInput.addEventListener('input', () => syncPathState());
  aliasInput.addEventListener('input', () => {
    aliasEdited = Boolean(aliasInput.value.trim());
    validateLocal();
    syncConflicts();
  });
  form.addEventListener('input', syncDirty);
  form.addEventListener('change', syncDirty);
  if (initialPaths.length) runValidate(initialPaths, ++pathValidationGeneration);
  syncConflicts();

  const browseForFolder = async (trigger, replaceIndex = null) => {
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
      toast('Folder browsing is unavailable here — enter one folder path per line instead.', { variant: 'info' });
      pathsInput.focus();
      return;
    }
    if (res?.canceled) return;
    if (res?.ok && res.path) {
      const paths = getSourcePaths();
      const candidate = String(res.path).trim();
      const candidateKey = normalizeWorkspacePath(candidate);
      const duplicateIndex = paths.findIndex((value, index) => index !== replaceIndex && normalizeWorkspacePath(value) === candidateKey);
      if (duplicateIndex !== -1) {
        toast('That source folder is already attached to this project.', { variant: 'info' });
        return;
      }
      if (Number.isInteger(replaceIndex) && replaceIndex >= 0 && replaceIndex < paths.length) paths[replaceIndex] = candidate;
      else paths.push(candidate);
      setSourcePaths(paths);
      syncPathState({ validate: false });
      syncDirty();
      await validateCurrentPaths(getSourcePaths(), ++pathValidationGeneration);
    } else if (res?.error) {
      toast('Could not open folder picker: ' + res.error, { variant: 'error' });
    }
  };

  for (const addButton of form.querySelectorAll('[data-add-source]')) {
    addButton.addEventListener('click', () => void browseForFolder(addButton));
  }
  sourceFolderList.addEventListener('click', event => {
    const changeButton = event.target.closest('[data-change-source]');
    if (changeButton) {
      const index = Number(changeButton.closest('[data-source-index]')?.dataset.sourceIndex);
      if (Number.isInteger(index)) void browseForFolder(changeButton, index);
      return;
    }
    const removeButton = event.target.closest('[data-remove-source]');
    if (!removeButton) return;
    const index = Number(removeButton.closest('[data-source-index]')?.dataset.sourceIndex);
    const paths = getSourcePaths();
    if (!Number.isInteger(index) || index < 0 || index >= paths.length) return;
    paths.splice(index, 1);
    setSourcePaths(paths);
    syncPathState();
    syncDirty();
  });

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
    const sourcePaths = getSourcePaths();
    const validation = validateLocal({ required: true });
    if (validation.sourceMessage) {
      const target = manualPathWrap.hidden ? sourceEmpty : pathsInput;
      target?.focus();
      return;
    }
    if (validation.aliasMessage) { aliasInput.focus(); return; }
    if (syncConflicts()) { conflictEl.focus(); return; }

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
      path: sourcePaths[0],
      sourcePaths,
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
  syncSourceFolders();
  setTimeout(() => {
    try {
      const initialFocus = isEdit
        ? aliasInput
        : initialPaths.length
          ? aliasInput
          : isDesktop ? sourceEmpty : pathsInput;
      initialFocus?.focus();
      if (isEdit) aliasInput.select();
    } catch (error) {
      if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    }
  }, 0);
}

function renderSourceFolderRows(paths) {
  return paths.map((value, index) => `
    <li class="ws-source-folder-row" data-source-index="${index}">
      <span class="ws-folder-icon" aria-hidden="true">${iconHtml('folder')}</span>
      <span class="ws-source-folder-copy">
        <span class="ws-source-folder-title"><strong>${esc(folderDisplayName(value))}</strong>${index === 0 ? '<small class="ws-source-primary">Primary</small>' : ''}</span>
        <small>${esc(value)}</small>
      </span>
      <span class="ws-source-folder-actions">
        <button type="button" class="ws-source-folder-change" data-change-source aria-label="Change source folder ${esc(value)}">Change</button>
        <button type="button" class="ws-source-folder-remove" data-remove-source aria-label="Remove source folder ${esc(value)}">Remove</button>
      </span>
    </li>`).join('');
}

function sourcePathsFromWorkspace(workspace) {
  return normalizeSourcePaths([
    workspace?.path,
    ...(Array.isArray(workspace?.sourcePaths) ? workspace.sourcePaths : [])
  ]);
}

function parseSourcePaths(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function normalizeSourcePaths(values) {
  const seen = new Set();
  return values.map(value => String(value || '').trim()).filter(Boolean).filter(value => {
    const key = normalizeWorkspacePath(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function folderDisplayName(value) {
  const normalized = String(value || '').trim().replace(/[\\/]+$/, '');
  if (!normalized) return '';
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || normalized;
}


async function loadConfiguredWorkspaces() {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
  return Array.isArray(dashboard?.config?.workspaces) ? dashboard.config.workspaces : [];
}

function workspaceConflict(workspaces, values) {
  const alias = String(values.alias || '').trim();
  const sourcePaths = Array.isArray(values.paths) ? values.paths : [];
  const normalizedPaths = sourcePaths.map(normalizeWorkspacePath).filter(Boolean);
  const originalAlias = String(values.originalAlias || '').trim();
  const aliasConflict = workspaces.find(item => item.alias === alias && item.alias !== originalAlias);
  if (aliasConflict) return `Project name '${alias}' is already in use.`;
  const pathConflict = workspaces.find(item => {
    if (item.alias === originalAlias) return false;
    return sourcePathsFromWorkspace(item).some(itemPath => normalizedPaths.includes(normalizeWorkspacePath(itemPath)));
  });
  return pathConflict ? `A source folder is already configured as '${pathConflict.alias}'.` : '';
}
