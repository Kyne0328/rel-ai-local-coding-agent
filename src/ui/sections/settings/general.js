// General settings — one trusted ChatGPT local repo bridge, no legacy permission model
import { esc } from '/ui/utils.js';
import { getToken } from '/ui/api.js';
import {
  loadSettingsConfig,
  saveSettings,
  header,
  formGrid,
  panel,
  field,
  toggleControl,
  numberControl,
  saveRow
} from './shared.js';

let _original = null;
let _draft = null;

export function mountGeneral(container) {
  container.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:13px;">Loading…</div>';
  _loadAndRender(container);
}

async function _loadAndRender(container) {
  const cfg = await loadSettingsConfig(container);
  if (!cfg) return;
  _original = JSON.parse(JSON.stringify(cfg));
  _draft = JSON.parse(JSON.stringify(cfg));
  _render(container);
}

function _render(container) {
  container.innerHTML = '';
  container.appendChild(header('General', 'Rel.AI uses a trusted local repo bridge for ChatGPT: the repo stays on your machine, while ChatGPT gets explicit local tools to snapshot, read, write, verify, diff, and reset configured workspaces.'));

  const grid = formGrid();
  const bridge = panel('ChatGPT local repo bridge');
  const limits = panel('Runtime limits');
  const local = panel('Local dashboard');
  const autoApprove = panel('ChatGPT web app-request auto-approve');

  bridge.body.appendChild(summaryBox());
  bridge.body.appendChild(field('Trusted local access', toggleControl(true, () => {}, { enabled: 'Always enabled', disabled: 'Always enabled' }), 'Configured workspaces are exposed through the local bridge tools. Workspace-level fast task settings control how much context is scanned before structured writes.'));
  bridge.body.appendChild(field('Automatic task behavior', _selectTaskMode(), 'Default behavior for high-level task calls.'));

  autoApprove.body.appendChild(autoApproveWarningBox());
  autoApprove.body.appendChild(field('Enable dashboard-side auto-approve', toggleControl((_draft.autoApproveAppRequests || {}).enabled === true, (v) => {
    if (v && !confirmAutoApproveWarning()) return;
    if (!_draft.autoApproveAppRequests) _draft.autoApproveAppRequests = {};
    _draft.autoApproveAppRequests.enabled = v;
    if (v) _draft.autoApproveAppRequests.warningAccepted = true;
    _checkDirty();
  }), 'Both this dashboard setting and the userscript local toggle must be enabled before any click automation runs.'));
  autoApprove.body.appendChild(field('Poll interval (ms)', numberControl((_draft.autoApproveAppRequests || {}).pollMs || 1200, (v) => {
    if (!_draft.autoApproveAppRequests) _draft.autoApproveAppRequests = {};
    _draft.autoApproveAppRequests.pollMs = v;
    _checkDirty();
  }, { min: 500, max: 10000, width: '140px' }), 'How often the userscript checks ChatGPT for a Rel.AI MCP app request.'));
  autoApprove.body.appendChild(field('Install userscript', userscriptInstallControl(), 'Install in Tampermonkey/Violentmonkey, then use the userscript menu on ChatGPT to enable or disable it locally.'));


  limits.body.appendChild(field('Session locks', toggleControl(_draft.sessionLocksEnabled !== false, (v) => { _draft.sessionLocksEnabled = v; _checkDirty(); }), 'Prevents overlapping edits to the same workspace.'));
  limits.body.appendChild(field('Max concurrent sessions per workspace', numberControl(_draft.maxConcurrentSessionsPerWorkspace, (v) => { _draft.maxConcurrentSessionsPerWorkspace = v; _checkDirty(); }, { min: 1, max: 20 }), 'Usually 1–4 is enough.'));
  limits.body.appendChild(field('Max output bytes', numberControl(_draft.maxOutputBytes, (v) => { _draft.maxOutputBytes = v; _checkDirty(); }, { min: 10000, max: 20000000, width: '140px' }), 'Maximum command output returned to ChatGPT. 2 MB is a safe default for test failures without flooding the chat.'));

  local.body.appendChild(field('Dashboard enabled', toggleControl(_draft.dashboardEnabled !== false, (v) => { _draft.dashboardEnabled = v; _checkDirty(); }), 'Controls this local dashboard only.'));
  local.body.appendChild(field('Color theme', _themeToggle(), 'Stored only in this browser.'));

  grid.appendChild(bridge.el);
  grid.appendChild(autoApprove.el);
  grid.appendChild(limits.el);
  grid.appendChild(local.el);
  container.appendChild(grid);

  const save = saveRow(() => _save(container), () => _loadAndRender(container));
  save.id = '__settings-save-row';
  save.style.display = 'none';
  const changes = document.createElement('button');
  changes.className = 'secondary';
  changes.id = '__settings-changes-link';
  changes.style.cssText = 'font-size:12px;min-height:28px;padding:0 10px;';
  changes.onclick = () => alert(_getChanges().map(c => `${c.key}: ${JSON.stringify(c.oldValue)} -> ${JSON.stringify(c.newValue)}`).join('\n'));
  save.prepend(changes);
  container.appendChild(save);
}

function summaryBox() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.cssText = 'text-align:left;padding:12px;line-height:1.55;';
  div.innerHTML = `
    <strong style="color:var(--text);">ChatGPT local repo bridge</strong><br>
    This is the always-on local connector between ChatGPT and your configured repositories. It avoids uploading a zip for every task through one reliable workflow: <code>relai_repo_snapshot</code>, <code>relai_read</code>, <code>relai_write</code> full-file writes, <code>relai_verify</code>, <code>relai_browser</code>, <code>relai_diff</code>, and <code>relai_reset</code>.<br>
    Fast task settings live on each workspace and reduce broad scans/indexing for small tasks across any language stack.
  `;
  return div;
}

function autoApproveWarningBox() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.cssText = 'text-align:left;padding:12px;line-height:1.55;border-color:rgba(255,184,77,.35);background:rgba(255,184,77,.08);';
  div.innerHTML = `
    <strong style="color:var(--text);">Warning: app-request auto-approve is dangerous.</strong><br>
    This optional userscript can click ChatGPT approval buttons for Rel.AI MCP app requests. That can authorize local repo reads, full-file writes, verification commands, browser checks, diffs, or resets without a manual click. Keep it off unless you are actively supervising a task on your own trusted machine.
  `;
  return div;
}

function confirmAutoApproveWarning() {
  return window.confirm('Enable Rel.AI MCP auto-approve?\n\nThis can click ChatGPT app-request approvals for local repo actions without a manual click. Use only on your own trusted machine and turn it off after the task.');
}

function userscriptInstallControl() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
  const token = getToken();
  const install = document.createElement('a');
  install.className = 'buttonlike';
  install.textContent = 'Open userscript';
  install.href = '/userscripts/chatgpt-auto-approve.user.js' + (token ? '?token=' + encodeURIComponent(token) : '');
  install.target = '_blank';
  install.rel = 'noopener';

  const installWithToken = document.createElement('a');
  installWithToken.className = 'buttonlike secondary';
  installWithToken.textContent = 'Open with token embedded';
  installWithToken.href = '/userscripts/chatgpt-auto-approve.user.js' + (token ? '?token=' + encodeURIComponent(token) + '&embedToken=1' : '?embedToken=1');
  installWithToken.target = '_blank';
  installWithToken.rel = 'noopener';
  installWithToken.onclick = (event) => {
    if (!window.confirm('Embedding the dashboard token in a userscript is convenient but sensitive. Only do this on your own trusted browser profile. Continue?')) event.preventDefault();
  };

  const docs = document.createElement('a');
  docs.className = 'buttonlike secondary';
  docs.textContent = 'Read setup docs';
  docs.href = '/public/docs/AUTO_APPROVE_USERSCRIPT.md';
  docs.target = '_blank';
  docs.rel = 'noopener';
  wrap.append(install, installWithToken, docs);
  return wrap;
}

function _selectTaskMode() {
  const el = document.createElement('select');
  for (const value of ['plan_only', 'implement', 'implement_and_test', 'review_only']) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value.replace(/_/g, ' ');
    if ((_draft.defaultTaskMode || 'implement_and_test') === value) opt.selected = true;
    el.appendChild(opt);
  }
  el.onchange = () => { _draft.defaultTaskMode = el.value; _checkDirty(); };
  return el;
}

function _checkDirty() {
  const saveRowEl = document.getElementById('__settings-save-row');
  if (!saveRowEl) return;
  const changes = _getChanges();
  saveRowEl.style.display = changes.length ? 'flex' : 'none';
  const link = document.getElementById('__settings-changes-link');
  if (link) link.textContent = changes.length + ' change' + (changes.length === 1 ? '' : 's') + ' pending';
}

function _getChanges() {
  if (!_original || !_draft) return [];
  const keys = ['sessionLocksEnabled', 'maxConcurrentSessionsPerWorkspace', 'maxOutputBytes', 'dashboardEnabled', 'defaultTaskMode', 'autoApproveAppRequests'];
  const changes = [];
  for (const key of keys) {
    if (JSON.stringify(_draft[key]) !== JSON.stringify(_original[key])) {
      changes.push({ key, oldValue: _original[key], newValue: _draft[key] });
    }
  }
  return changes;
}

async function _save(container) {
  const payload = {
    sessionLocksEnabled: _draft.sessionLocksEnabled,
    maxConcurrentSessionsPerWorkspace: _draft.maxConcurrentSessionsPerWorkspace,
    maxOutputBytes: _draft.maxOutputBytes,
    dashboardEnabled: _draft.dashboardEnabled,
    defaultTaskMode: _draft.defaultTaskMode,
    autoApproveAppRequests: _draft.autoApproveAppRequests
  };
  const res = await saveSettings(payload);
  if (res && res.ok) await _loadAndRender(container);
}

function _themeToggle() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;';
  const dark = document.createElement('button'); dark.textContent = 'Dark'; dark.type = 'button';
  const light = document.createElement('button'); light.textContent = 'Light'; light.type = 'button'; light.className = 'secondary';
  dark.onclick = () => { localStorage.setItem('relai_theme', 'dark'); delete document.documentElement.dataset.theme; };
  light.onclick = () => { localStorage.setItem('relai_theme', 'light'); document.documentElement.dataset.theme = 'light'; };
  wrap.append(dark, light);
  return wrap;
}
