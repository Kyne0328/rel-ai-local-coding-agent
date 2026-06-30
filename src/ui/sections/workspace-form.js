// Shared add/edit workspace form — modal with live path validation, a native
// folder picker (desktop launcher only), and warn-but-allow saving so a path that
// does not exist yet (about to be cloned) is never a hard block.
import { openModal, closeModal } from '/ui/components/modal.js';
import { fetchJson, postJson, invalidateCache, requestDashboardRefresh } from '/ui/api.js';
import { toast } from '/ui/components/toast.js';
import { esc } from '/ui/utils.js';

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

function renderPathStatus(el, info) {
  if (!info) { el.textContent = ''; return; }
  const errFinding = (info.findings || []).find(f => f.severity === 'error');
  if (info.isGit) {
    el.textContent = '✓ Git repository found at this path.';
    el.style.color = 'var(--green)';
  } else if (info.exists && info.isDirectory) {
    el.textContent = '⚠ Folder exists but is not a git repository. You can still save and init/clone it later.';
    el.style.color = 'var(--yellow)';
  } else if (errFinding) {
    el.textContent = '✗ ' + errFinding.message + ' — you can still save (e.g. before cloning).';
    el.style.color = 'var(--red)';
  } else {
    el.textContent = '';
  }
}

const FORM_STYLE = `
  .ws-form label { display:block; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-muted); margin:14px 0 5px; }
  .ws-form label:first-of-type { margin-top:0; }
  .ws-form input { width:100%; background:var(--bg,#0b0f1a); border:1px solid var(--line-soft); border-radius:8px; color:var(--text); padding:9px 10px; font:inherit; font-size:13px; }
  .ws-form input[readonly] { opacity:.6; cursor:not-allowed; }
  .ws-form .row { display:flex; gap:8px; }
  .ws-form .status { font-size:12px; min-height:16px; margin-top:6px; line-height:1.4; }
  .ws-form .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:18px; }
`;

export function openWorkspaceForm({ mode = 'add', workspace = null, onSaved } = {}) {
  const ws = workspace || {};
  const isEdit = mode === 'edit';
  const form = document.createElement('form');
  form.className = 'ws-form';
  form.innerHTML = `
    <style>${FORM_STYLE}</style>
    <label>Alias</label>
    <input name="alias" value="${esc(ws.alias || '')}" placeholder="for example jjclover" ${isEdit ? 'readonly' : ''} autocomplete="off">
    <label>Workspace path</label>
    <div class="row">
      <input name="path" value="${esc(ws.path || '')}" placeholder="Absolute path to the repository" style="flex:1" autocomplete="off">
      <button type="button" class="secondary" data-browse>Browse…</button>
    </div>
    <div class="status" data-path-status></div>
    <label>Protected branches (comma-separated)</label>
    <input name="protected" value="${esc((ws.protectedBranches && ws.protectedBranches.length ? ws.protectedBranches : ['main', 'master']).join(', '))}" autocomplete="off">
    <label>Default base branch</label>
    <input name="base" value="${esc(ws.defaultBaseBranch || 'main')}" autocomplete="off">
    <label>Allowed remotes (comma-separated)</label>
    <input name="remotes" value="${esc((ws.allowedRemotes && ws.allowedRemotes.length ? ws.allowedRemotes : ['origin']).join(', '))}" autocomplete="off">
    <div class="actions">
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
    browseBtn.disabled = true;
    const prev = browseBtn.textContent;
    browseBtn.textContent = 'Opening…';
    // No timeout — the native dialog blocks until the user picks or cancels.
    const res = await postJson('/api/pick-folder', {}, { timeout: 0 });
    browseBtn.disabled = false;
    browseBtn.textContent = prev;
    if (res && res.unsupported) {
      browseBtn.style.display = 'none';
      toast('Browse needs the Rel.AI desktop launcher — type the path here instead.', { variant: 'info' });
      return;
    }
    if (res && res.canceled) return;
    if (res && res.ok && res.path) {
      pathInput.value = res.path;
      renderPathStatus(statusEl, res); // pick-folder already returns preflight fields
    } else if (res && res.error) {
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
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    const result = await postJson('/api/workspaces', {
      action: 'upsert',
      alias,
      path: wsPath,
      protectedBranches: splitList(form.querySelector('input[name="protected"]').value),
      defaultBaseBranch: String(form.querySelector('input[name="base"]').value || 'main').trim() || 'main',
      allowedRemotes: splitList(form.querySelector('input[name="remotes"]').value),
      ...(isEdit ? { fastTask: ws.fastTask, testCommands: undefined } : {}),
      confirmDangerous: true
    });
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? 'Save changes' : 'Add workspace';
    if (result && result.ok) {
      closeModal();
      invalidateCache();
      toast((isEdit ? 'Workspace updated: ' : 'Workspace added: ') + alias, { variant: 'success' });
      if (typeof onSaved === 'function') onSaved();
      else requestDashboardRefresh();
    } else {
      toast('Could not save workspace: ' + ((result && result.error) || 'unknown error'), { variant: 'error' });
    }
  });

  openModal({ title: isEdit ? `Edit workspace · ${ws.alias || ''}` : 'Add workspace', content: form });
  // Focus the path field directly when fixing an existing (likely broken) workspace.
  if (isEdit) setTimeout(() => { try { pathInput.focus(); pathInput.select(); } catch (_) {} }, 0);
}
