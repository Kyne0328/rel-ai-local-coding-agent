// Shared add/edit workspace form — modal with live path validation, a native
// folder picker (desktop launcher only), and warn-but-allow saving so a path that
// does not exist yet (about to be cloned) is never a hard block.
import { openModal, closeModal } from '../components/modal.js';
import { fetchJson, postJson, invalidateCache, requestDashboardRefresh } from '../api.js';
import { toast } from '../components/toast.js';
import { esc } from '../utils.js';
import { runButtonAction } from '../action-state.js';

function debounce(fn, ms) {
  let timer = 0;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function splitList(value) {
  return String(value || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}

async function validatePath(p) {
  if (!p) return null;
  return fetchJson('/api/workspace/preflight?path=' + encodeURIComponent(p));
}

function renderPathStatus(element, info) {
  element.className = 'ws-form-status';
  if (!info) { element.textContent = ''; return; }
  const errorFinding = (info.findings || []).find(finding => finding.severity === 'error');
  if (info.isGit) {
    element.textContent = '✓ Git repository found at this path.';
    element.classList.add('success');
  } else if (info.exists && info.isDirectory) {
    element.textContent = '⚠ Folder exists but is not a git repository. You can still save and initialize or clone it later.';
    element.classList.add('warn');
  } else if (errorFinding) {
    element.textContent = '✗ ' + errorFinding.message + ' — you can still save it before cloning.';
    element.classList.add('error');
  } else {
    element.textContent = '';
  }
}

export function openWorkspaceForm({ mode = 'add', workspace = null, onSaved } = {}) {
  const ws = workspace || {};
  const isEdit = mode === 'edit';
  const form = document.createElement('form');
  form.className = 'ws-form';
  form.innerHTML = `
    <label>Alias</label>
    <input name="alias" value="${esc(ws.alias || '')}" placeholder="for example jjclover" ${isEdit ? 'readonly' : ''} autocomplete="off">
    <label>Workspace path</label>
    <div class="ws-form-row">
      <input class="ws-form-path" name="path" value="${esc(ws.path || '')}" placeholder="Absolute path to the repository" autocomplete="off">
      <button type="button" class="secondary" data-browse>Browse…</button>
    </div>
    <div class="ws-form-status" data-path-status></div>
    <label>Protected branches (comma-separated)</label>
    <input name="protected" value="${esc((ws.protectedBranches?.length ? ws.protectedBranches : ['main', 'master']).join(', '))}" autocomplete="off">
    <label>Default base branch</label>
    <input name="base" value="${esc(ws.defaultBaseBranch || 'main')}" autocomplete="off">
    <label>Allowed remotes (comma-separated)</label>
    <input name="remotes" value="${esc((ws.allowedRemotes?.length ? ws.allowedRemotes : ['origin']).join(', '))}" autocomplete="off">
    <div class="ws-form-actions">
      <button type="button" class="secondary" data-cancel>Cancel</button>
      <button type="submit" class="primary">${isEdit ? 'Save changes' : 'Add workspace'}</button>
    </div>
  `;

  const pathInput = form.querySelector('input[name="path"]');
  const statusEl = form.querySelector('[data-path-status]');
  const browseBtn = form.querySelector('[data-browse]');
  const submitBtn = form.querySelector('button[type="submit"]');

  const runValidate = debounce(async () => {
    const info = await validatePath(pathInput.value.trim());
    renderPathStatus(statusEl, info);
  }, 400);
  pathInput.addEventListener('input', runValidate);
  if (pathInput.value.trim()) runValidate();

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
      renderPathStatus(statusEl, res); // pick-folder already returns preflight fields
    } else if (res?.error) {
      toast('Could not open folder picker: ' + res.error, { variant: 'error' });
    }
  });

  form.querySelector('[data-cancel]').addEventListener('click', () => closeModal());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const alias = String(form.querySelector('input[name="alias"]').value || '').trim();
    const wsPath = pathInput.value.trim();
    if (!alias) { toast('Alias is required.', { variant: 'error' }); return; }
    if (!wsPath) { toast('Workspace path is required.', { variant: 'error' }); return; }
    const result = await runButtonAction(submitBtn, {
      idleText: isEdit ? 'Save changes' : 'Add workspace',
      loadingText: 'Saving workspace…',
      successText: isEdit ? 'Workspace updated' : 'Workspace added',
      errorText: 'Save failed'
    }, () => postJson('/api/workspaces', {
      action: 'upsert',
      alias,
      path: wsPath,
      protectedBranches: splitList(form.querySelector('input[name="protected"]').value),
      defaultBaseBranch: String(form.querySelector('input[name="base"]').value || 'main').trim() || 'main',
      allowedRemotes: splitList(form.querySelector('input[name="remotes"]').value),
      ...(isEdit ? { fastTask: ws.fastTask, testCommands: undefined } : {}),
      confirmDangerous: true
    }));
    if (result?.ok) {
      closeModal();
      invalidateCache();
      toast((isEdit ? 'Workspace updated: ' : 'Workspace added: ') + alias, { variant: 'success' });
      if (typeof onSaved === 'function') onSaved();
      else requestDashboardRefresh();
    } else {
      toast('Could not save workspace: ' + (result?.error || 'unknown error'), { variant: 'error' });
    }
  });

  openModal({ title: isEdit ? `Edit workspace · ${ws.alias || ''}` : 'Add workspace', content: form });
  // Focus the path field directly when fixing an existing (likely broken) workspace.
  if (isEdit) setTimeout(() => { try { pathInput.focus(); pathInput.select(); } catch (error) { if (window.localStorage?.getItem('relai_debug') === '1') console.error(error); } }, 0);
}
