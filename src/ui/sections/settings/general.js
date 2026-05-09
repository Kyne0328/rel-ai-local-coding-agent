// General settings sub-page — dirty tracking, diff summary, explicit save
import { fetchJson, postJson } from '/ui/api.js';
import { openModal, closeModal } from '/ui/components/modal.js';
import { toast } from '/ui/components/toast.js';
import { Select } from '/ui/components/select.js';
import { Toggle } from '/ui/components/toggle.js';
import { esc } from '/ui/utils.js';

let _original = null;
let _draft = null;

export function mountGeneral(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _loadAndRender(container);
}

async function _loadAndRender(container) {
  const data = await fetchJson('/api/settings');
  if (!data || !data.ok) { container.innerHTML = '<div class="empty">Failed to load settings.</div>'; return; }
  _original = JSON.parse(JSON.stringify(data));
  _draft = JSON.parse(JSON.stringify(data));
  _render(container, data);
}

function _render(container, data) {
  container.innerHTML = '';
  const form = document.createElement('div');
  form.style.cssText = 'display:grid;gap:20px;max-width:560px;';

  form.appendChild(_field('Permission profile', _selectControl(['read-only', 'pr', 'test', 'admin'], data.permissionProfile, (v) => { _draft.permissionProfile = v; _checkDirty(container); }), 'Controls what tools are available to ChatGPT. Read-only sees but doesn\'t touch. PR can commit and open PRs. Test adds ability to run test commands. Admin allows everything.'));

  if (data.defaultTaskMode !== undefined) {
    form.appendChild(_field('Default task mode', _selectControl(['implement', 'implement_test', 'plan_only'], data.defaultTaskMode, (v) => { _draft.defaultTaskMode = v; _checkDirty(container); }), 'How ChatGPT approaches new tasks by default.'));
  }

  form.appendChild(_field('Session locks', _toggleControl(data.sessionLocksEnabled, (v) => { _draft.sessionLocksEnabled = v; _checkDirty(container); }), 'Prevent concurrent sessions on the same workspace.'));
  form.appendChild(_field('Dashboard enabled', _toggleControl(data.dashboardEnabled !== false, (v) => { _draft.dashboardEnabled = v; _checkDirty(container); }), 'Disable to stop serving the dashboard entirely.'));

  if (data.maxConcurrentSessionsPerWorkspace !== undefined) {
    form.appendChild(_field('Max concurrent sessions per workspace', _number('maxConcurrentSessionsPerWorkspace', data.maxConcurrentSessionsPerWorkspace, (v) => { _draft.maxConcurrentSessionsPerWorkspace = parseInt(v, 10); _checkDirty(container); }), ''));
  }

  form.appendChild(_field('Color theme', _themeToggle(), 'Switch between dark and light mode. Default is dark.'));

  container.appendChild(form);

  const saveBar = document.createElement('div');
  saveBar.id = '__settings-save-bar';
  saveBar.style.cssText = 'position:sticky;bottom:0;background:var(--surface);border-top:1px solid var(--line-soft);padding:12px 0;margin-top:16px;display:flex;gap:10px;align-items:center;display:none;';
  const changesLink = document.createElement('button');
  changesLink.className = 'secondary';
  changesLink.style.cssText = 'font-size:12px;min-height:28px;padding:0 10px;';
  changesLink.id = '__settings-changes-link';
  changesLink.onclick = () => _showDiffModal();
  const discardBtn = document.createElement('button');
  discardBtn.className = 'secondary';
  discardBtn.textContent = 'Discard';
  discardBtn.style.cssText = 'min-height:32px;';
  discardBtn.onclick = () => { _draft = JSON.parse(JSON.stringify(_original)); _render(container, _original); };
  const saveBtn = document.createElement('button');
  saveBtn.id = '__settings-save-btn';
  saveBtn.textContent = 'Save changes';
  saveBtn.style.cssText = 'min-height:32px;';
  saveBtn.onclick = () => _save(container, saveBtn);
  saveBar.appendChild(changesLink);
  saveBar.appendChild(discardBtn);
  saveBar.appendChild(saveBtn);
  container.appendChild(saveBar);
}

function _checkDirty(container) {
  const saveBar = document.getElementById('__settings-save-bar');
  if (!saveBar) return;
  const changes = _getChanges();
  if (changes.length === 0) {
    saveBar.style.display = 'none';
  } else {
    saveBar.style.display = 'flex';
    const link = document.getElementById('__settings-changes-link');
    if (link) link.textContent = changes.length + ' change' + (changes.length === 1 ? '' : 's') + ' pending';
  }
}

function _getChanges() {
  if (!_original || !_draft) return [];
  const changes = [];
  for (const key of Object.keys(_draft)) {
    if (JSON.stringify(_draft[key]) !== JSON.stringify(_original[key])) {
      changes.push({ key, oldValue: _original[key], newValue: _draft[key] });
    }
  }
  return changes;
}

function _showDiffModal() {
  const changes = _getChanges();
  const content = document.createElement('div');
  content.style.cssText = 'display:grid;gap:10px;font-size:13px;';
  for (const c of changes) {
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px;border:1px solid var(--line-soft);border-radius:8px;background:var(--bg);';
    row.innerHTML = `<div style="font-weight:700;">${esc(c.key)}</div><div style="margin-top:4px;color:var(--red);font-size:12px;">- ${esc(JSON.stringify(c.oldValue))}</div><div style="color:var(--green);font-size:12px;">+ ${esc(JSON.stringify(c.newValue))}</div>`;
    content.appendChild(row);
  }
  openModal({ title: 'Pending changes', content });
}

const DANGEROUS_KEYS = ['allowArbitraryCommands', 'allowDestructiveTools', 'allowDocker', 'allowGitHubCli'];

async function _save(container, saveBtn) {
  const changes = _getChanges();
  const dangerous = changes.filter(c => DANGEROUS_KEYS.includes(c.key) && c.newValue === true && c.oldValue !== true);
  if (dangerous.length) {
    await _confirmDangerous(dangerous);
  }
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  const res = await postJson('/api/settings', _draft);
  if (res && res.ok) {
    _original = JSON.parse(JSON.stringify(_draft));
    saveBtn.textContent = 'Saved ✓';
    setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; _checkDirty(container); }, 2000);
    toast('Settings saved.', { variant: 'success' });
  } else {
    saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
    toast('Error: ' + (res ? res.error : 'unknown'), { variant: 'error' });
  }
}

async function _confirmDangerous(dangerous) {
  return new Promise((resolve) => {
    const content = document.createElement('div');
    content.style.cssText = 'display:grid;gap:14px;font-size:13px;';
    content.innerHTML = `<p style="color:var(--yellow);">⚠ You are enabling high-risk settings: <strong>${dangerous.map(d => esc(d.key)).join(', ')}</strong>. These let agents run unrestricted commands.</p><p>Type <code>DISABLE SAFETY</code> to confirm:</p>`;
    const input = document.createElement('input');
    input.type = 'text'; input.placeholder = 'DISABLE SAFETY'; input.style.cssText = 'width:100%;';
    const btn = document.createElement('button');
    btn.textContent = 'Confirm'; btn.disabled = true;
    input.addEventListener('input', () => { btn.disabled = input.value !== 'DISABLE SAFETY'; });
    btn.onclick = () => { closeModal(); resolve(); };
    content.appendChild(input); content.appendChild(btn);
    openModal({ title: 'Confirm dangerous change', content, escDisabled: false });
  });
}

function _field(label, control, help) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;gap:6px;';
  const lbl = document.createElement('label');
  lbl.style.cssText = 'font-size:13px;font-weight:700;';
  lbl.textContent = label;
  wrap.appendChild(lbl);
  wrap.appendChild(control);
  if (help) { const p = document.createElement('p'); p.style.cssText = 'font-size:12px;color:var(--text-muted);margin:0;'; p.textContent = help; wrap.appendChild(p); }
  return wrap;
}

function _selectControl(options, value, onChange) {
  return Select({ options, value, onChange });
}

function _toggleControl(checked, onChange) {
  let control;
  control = Toggle({
    checked: Boolean(checked),
    label: Boolean(checked) ? 'Enabled' : 'Disabled',
    onChange: (value) => {
      onChange(value);
      const label = control.querySelector('span');
      if (label) label.textContent = value ? 'Enabled' : 'Disabled';
    }
  });
  return control;
}

function _number(name, value, onChange) {
  const el = document.createElement('input');
  el.type = 'number'; el.value = value; el.min = '1'; el.max = '20'; el.style.cssText = 'width:80px;';
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

function _themeToggle() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;';
  const current = document.documentElement.dataset.theme || 'dark';
  for (const theme of ['dark', 'light']) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.style.cssText = 'min-height:32px;padding:0 14px;font-size:13px;';
    btn.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
    if (current === theme) btn.style.background = 'rgba(78,161,255,.2)';
    btn.onclick = () => {
      if (theme === 'dark') {
        delete document.documentElement.dataset.theme;
        localStorage.setItem('relai_theme', 'dark');
      } else {
        document.documentElement.dataset.theme = 'light';
        localStorage.setItem('relai_theme', 'light');
      }
      wrap.querySelectorAll('button').forEach(b => { b.style.background = ''; });
      btn.style.background = 'rgba(78,161,255,.2)';
    };
    wrap.appendChild(btn);
  }
  return wrap;
}

