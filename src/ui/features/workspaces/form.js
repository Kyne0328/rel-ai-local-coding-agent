// Shared add/edit workspace form. Rename and path changes are saved atomically.
// Git and safety settings remain available under progressive disclosure.
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

function splitList(value) {
  return String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean);
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
    element.textContent = 'Git repository found. Rel.AI will detect available validation commands automatically.';
    element.classList.add('success');
  } else if (info.exists && info.isDirectory) {
    element.textContent = 'This folder exists but is not a Git repository. It can still be added.';
    element.classList.add('warn');
  } else if (errorFinding) {
    element.textContent = `${errorFinding.message} You can save this path before cloning the repository.`;
    element.classList.add('warn');
  } else {
    element.textContent = '';
  }
}

export async function openWorkspaceForm({ mode = 'add', workspace = null, onSaved } = {}) {
  const ws = workspace || {};
  const isEdit = mode === 'edit';
  const originalAlias = String(ws.alias || '').trim();
  const configured = await loadConfiguredWorkspaces();
  const form = document.createElement('form');
  form.className = 'ws-form';
  form.innerHTML = `
    <div class="ws-form-intro">
      <strong>${isEdit ? 'Workspace settings' : 'Choose a project folder'}</strong>
      <span>${isEdit ? 'Rename the workspace, change its folder, or review advanced Git safeguards. Name and path changes are saved together.' : 'Rel.AI uses this folder only when a ChatGPT request names this workspace.'}</span>
    </div>

    <label for="workspacePathInput">Project folder</label>
    <div class="ws-form-row">
      <input class="ws-form-path" id="workspacePathInput" name="path" value="${esc(ws.path || '')}" placeholder="Absolute path to the project" autocomplete="off">
      <button type="button" class="secondary" data-browse>Browse…</button>
    </div>
    <div class="ws-form-status" data-path-status aria-live="polite"></div>

    <label for="workspaceAliasInput">Workspace name</label>
    <input id="workspaceAliasInput" name="alias" value="${esc(ws.alias || '')}" placeholder="for example employee-api" autocomplete="off">
    <div class="ws-form-help">Use 1–80 letters, numbers, dots, underscores, or dashes. This is the name used in ChatGPT prompts.</div>
    <div class="ws-form-conflict" data-conflict hidden role="alert"></div>

    <details class="ws-form-advanced">
      <summary>
        <span><strong>Git and safety settings</strong><small>Defaults work for most repositories</small></span>
        <span aria-hidden="true">›</span>
      </summary>
      <div class="ws-form-advanced-body">
        <label for="workspaceProtectedInput">Protected branches</label>
        <input id="workspaceProtectedInput" name="protected" value="${esc((ws.protectedBranches?.length ? ws.protectedBranches : ['main', 'master']).join(', '))}" autocomplete="off">
        <div class="ws-form-help">Rel.AI treats these branches as protected during Git operations.</div>

        <label for="workspaceBaseInput">Default base branch</label>
        <input id="workspaceBaseInput" name="base" value="${esc(ws.defaultBaseBranch || 'main')}" autocomplete="off">

        <label for="workspaceRemotesInput">Allowed remotes</label>
        <input id="workspaceRemotesInput" name="remotes" value="${esc((ws.allowedRemotes?.length ? ws.allowedRemotes : ['origin']).join(', '))}" autocomplete="off">
        <div class="ws-form-help">Only these Git remote names can be used for publishing operations.</div>
      </div>
    </details>

    <div class="ws-form-actions">
      <button type="button" class="secondary" data-cancel>Cancel</button>
      <button type="submit" class="primary">${isEdit ? 'Save workspace' : 'Add workspace'}</button>
    </div>
  `;

  const pathInput = form.querySelector('input[name="path"]');
  const aliasInput = form.querySelector('input[name="alias"]');
  const statusEl = form.querySelector('[data-path-status]');
  const conflictEl = form.querySelector('[data-conflict]');
  const browseBtn = form.querySelector('[data-browse]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const initialState = formSnapshot(form);
  const syncDirty = () => markUnsaved(form, formSnapshot(form) !== initialState);
  let modal = null;
  let aliasEdited = Boolean(isEdit || aliasInput.value.trim());

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
  const runValidate = debounce(async () => {
    const info = await validatePath(pathInput.value.trim());
    renderPathStatus(statusEl, info);
  }, 350);

  pathInput.addEventListener('input', () => {
    suggestAlias();
    syncConflicts();
    runValidate();
  });
  aliasInput.addEventListener('input', () => {
    aliasEdited = Boolean(aliasInput.value.trim());
    syncConflicts();
  });
  form.addEventListener('input', syncDirty);
  form.addEventListener('change', syncDirty);
  if (pathInput.value.trim()) runValidate();
  syncConflicts();

  browseBtn.addEventListener('click', async () => {
    const res = await runButtonAction(browseBtn, {
      idleText: 'Browse…',
      loadingText: 'Opening folder picker…',
      successText: 'Folder selected',
      errorText: 'Browse failed'
    }, () => postJson('/api/pick-folder', {}, { timeout: 0 }));
    if (res?.unsupported) {
      browseBtn.hidden = true;
      toast('Browse needs the Rel.AI desktop launcher — type the path here instead.', { variant: 'info' });
      return;
    }
    if (res?.canceled) return;
    if (res?.ok && res.path) {
      pathInput.value = res.path;
      suggestAlias();
      syncDirty();
      syncConflicts();
      renderPathStatus(statusEl, await validatePath(res.path));
    } else if (res?.error) {
      toast('Could not open folder picker: ' + res.error, { variant: 'error' });
    }
  });

  form.querySelector('[data-cancel]').addEventListener('click', () => modal?.dismiss());

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const alias = String(aliasInput.value || '').trim();
    const wsPath = pathInput.value.trim();
    if (!wsPath) { toast('Choose a project folder.', { variant: 'error' }); pathInput.focus(); return; }
    if (!alias) { toast('Enter a workspace name.', { variant: 'error' }); aliasInput.focus(); return; }
    if (!isValidWorkspaceAlias(alias)) { toast('Workspace names may use only 1–80 letters, numbers, dots, underscores, and dashes.', { variant: 'error' }); aliasInput.focus(); return; }
    if (syncConflicts()) { conflictEl.focus?.(); return; }

    const result = await runButtonAction(submitBtn, {
      idleText: isEdit ? 'Save workspace' : 'Add workspace',
      loadingText: 'Saving workspace…',
      successText: isEdit ? 'Workspace updated' : 'Workspace added',
      errorText: 'Save failed'
    }, () => postJson('/api/workspaces', {
      action: 'upsert',
      mode: isEdit ? 'update' : 'create',
      originalAlias: isEdit ? originalAlias : alias,
      alias,
      path: wsPath,
      enforceUniquePath: true,
      protectedBranches: splitList(form.querySelector('input[name="protected"]').value),
      defaultBaseBranch: String(form.querySelector('input[name="base"]').value || 'main').trim() || 'main',
      allowedRemotes: splitList(form.querySelector('input[name="remotes"]').value),
      confirmDangerous: true
    }));
    if (result?.ok) {
      markUnsaved(form, false);
      closeModal();
      invalidateCache();
      requestDashboardRefresh({ structural: true });
      if (isEdit && originalAlias !== alias) renameRecentWorkspace(originalAlias, alias);
      recordRecentWorkspace(alias);
      toast(result.message || `${isEdit ? 'Workspace updated' : 'Workspace added'}: ${alias}`, { variant: 'success' });
      if (getWorkspaceFilter() === originalAlias && originalAlias !== alias) setWorkspaceFilter(alias);
      else if (typeof onSaved === 'function') onSaved({ result, alias, originalAlias });
      else if (isEdit) navigate('workspaces', { workspace: alias, focus: '1' });
    } else {
      const message = result?.error || 'unknown error';
      conflictEl.hidden = !/already (?:exists|configured)/i.test(message);
      if (!conflictEl.hidden) conflictEl.textContent = message;
      toast('Could not save workspace: ' + message, { variant: 'error' });
    }
  });

  modal = openModal({ title: isEdit ? `Workspace settings · ${ws.alias || ''}` : 'Add workspace', content: form });
  setTimeout(() => {
    try {
      (isEdit ? aliasInput : pathInput).focus();
      if (isEdit) aliasInput.select();
    } catch (error) {
      if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    }
  }, 0);
}

async function loadConfiguredWorkspaces() {
  const dashboard = await fetchJson(DASHBOARD_DATA_URL, { cache: 'no-store' });
  return Array.isArray(dashboard?.config?.workspaces) ? dashboard.config.workspaces : [];
}

function workspaceConflict(workspaces, values) {
  const alias = String(values.alias || '').trim();
  const workspacePath = normalizeWorkspacePath(values.path);
  const originalAlias = String(values.originalAlias || '').trim();
  if (alias && !isValidWorkspaceAlias(alias)) return 'Workspace names may use only 1–80 letters, numbers, dots, underscores, and dashes.';
  const aliasConflict = workspaces.find(item => item.alias === alias && item.alias !== originalAlias);
  if (aliasConflict) return `Workspace name '${alias}' is already in use.`;
  const pathConflict = workspacePath
    ? workspaces.find(item => item.alias !== originalAlias && normalizeWorkspacePath(item.path) === workspacePath)
    : null;
  return pathConflict ? `This project folder is already configured as '${pathConflict.alias}'.` : '';
}

