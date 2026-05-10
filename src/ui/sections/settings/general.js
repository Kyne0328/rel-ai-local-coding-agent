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
  const helper = panel('ChatGPT request helper');
  const limits = panel('Runtime limits');
  const local = panel('Local dashboard');

  bridge.body.appendChild(summaryBox());
  bridge.body.appendChild(field('Trusted local access', toggleControl(true, () => {}, { enabled: 'Always enabled', disabled: 'Always enabled' }), 'Configured workspaces are exposed through the local bridge tools. Workspace-level fast task settings control how much context is scanned before structured writes.'));
  helper.body.appendChild(requestHelperBox());
  helper.body.appendChild(field('Enable helper', toggleControl((_draft.chatgptRequestHelper || {}).enabled === true, (v) => { ensureRequestHelper().enabled = v; _checkDirty(); }), 'Shows a small overlay on ChatGPT pages and detects Rel.AI app/tool request dialogs.'));
  helper.body.appendChild(field('Auto-approve Rel.AI requests', toggleControl((_draft.chatgptRequestHelper || {}).autoApprove === true, (v) => { ensureRequestHelper().autoApprove = v; _checkDirty(); }, { enabled: 'Auto-approve on', disabled: 'Auto-approve off' }), 'When enabled, the userscript clicks only visible approval buttons inside dialogs that match the configured Rel.AI/tool allowlist.'));
  helper.body.appendChild(field('Max clicks per minute', numberControl((_draft.chatgptRequestHelper || {}).maxClicksPerMinute || 12, (v) => { ensureRequestHelper().maxClicksPerMinute = v; _checkDirty(); }, { min: 1, max: 120, width: '100px' }), 'Safety rate limit for web and Android userscript usage.'));
  helper.body.appendChild(field('Cooldown milliseconds', numberControl((_draft.chatgptRequestHelper || {}).cooldownMs || 1500, (v) => { ensureRequestHelper().cooldownMs = v; _checkDirty(); }, { min: 250, max: 60000, width: '120px' }), 'Minimum delay between clicks.'));
  helper.body.appendChild(field('Userscript', requestHelperInstallControls(), 'Install in a userscript manager on desktop or Android browser. Reinstall after changing helper settings.'));


  limits.body.appendChild(field('Max output bytes', numberControl(_draft.maxOutputBytes, (v) => { _draft.maxOutputBytes = v; _checkDirty(); }, { min: 10000, max: 20000000, width: '140px' }), 'Maximum command output returned to ChatGPT. 2 MB is a safe default for test failures without flooding the chat.'));

  local.body.appendChild(field('Dashboard enabled', toggleControl(_draft.dashboardEnabled !== false, (v) => { _draft.dashboardEnabled = v; _checkDirty(); }), 'Controls this local dashboard only.'));
  local.body.appendChild(field('Color theme', _themeToggle(), 'Stored only in this browser.'));

  grid.appendChild(bridge.el);
  grid.appendChild(helper.el);
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


function ensureRequestHelper() {
  if (!_draft.chatgptRequestHelper || typeof _draft.chatgptRequestHelper !== 'object') _draft.chatgptRequestHelper = {};
  return _draft.chatgptRequestHelper;
}

function requestHelperBox() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.cssText = 'text-align:left;padding:12px;line-height:1.55;';
  div.innerHTML = `
    <strong style="color:var(--text);">Optional app request helper</strong><br>
    This creates a userscript for ChatGPT Web and Android browsers with userscript support. It is disabled by default and only targets visible Rel.AI request dialogs. It does not read passwords, cookies, messages, or arbitrary page data.
  `;
  return div;
}

function requestHelperInstallControls() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'secondary';
  btn.textContent = 'Download userscript';
  btn.onclick = downloadRequestHelperUserscript;
  const docs = document.createElement('a');
  docs.href = '/docs/CHATGPT_REQUEST_HELPER.md';
  docs.textContent = 'Usage notes';
  docs.className = 'section-action';
  docs.target = '_blank';
  wrap.append(btn, docs);
  return wrap;
}

async function downloadRequestHelperUserscript() {
  const token = getToken();
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const url = '/userscripts/chatgpt-request-helper.user.js' + (token ? '?token=' + encodeURIComponent(token) : '');
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    alert('Could not download userscript: ' + text);
    return;
  }
  const blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/javascript' }));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'rel-ai-chatgpt-request-helper.user.js';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
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
  const keys = ['maxOutputBytes', 'dashboardEnabled', 'chatgptRequestHelper'];
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
    maxOutputBytes: _draft.maxOutputBytes,
    dashboardEnabled: _draft.dashboardEnabled,
    chatgptRequestHelper: _draft.chatgptRequestHelper
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
