// General settings — one trusted ChatGPT local repo bridge, no legacy permission model
import {
  loadSettingsConfig,
  saveSettings,
  header,
  formGrid,
  panel,
  field,
  toggleControl,
  numberControl,
  selectControl,
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
  const workflow = panel('Workflow mode');
  const limits = panel('Runtime limits');
  const local = panel('Local dashboard');
  const autoApprove = panel('ChatGPT web app-request auto-approve extension');

  bridge.body.appendChild(summaryBox());
  bridge.body.appendChild(field('Trusted local access', toggleControl(true, () => {}, { enabled: 'Always enabled', disabled: 'Always enabled' }), 'Configured workspaces are exposed through the local bridge tools. Workspace-level fast task settings control how much context is scanned before structured writes.'));

  workflow.body.appendChild(workflowWarningBox());
  workflow.body.appendChild(field('Mode', selectControl([
    { value: 'conservative', label: 'Conservative - exact edits and guarded writes' },
    { value: 'aggressive', label: 'Fast - Codex-style update/bundle apply' }
  ], (_draft.workflow || {}).mode || 'conservative', (value) => {
    if (value === 'aggressive' && !confirmFastFlow()) return;
    if (!_draft.workflow) _draft.workflow = {};
    _draft.workflow.mode = value;
    _checkDirty();
  }), 'Conservative keeps exact replacements. Fast mode exposes relai_apply_update, relai_apply_bundle, and relai_package_snapshot for fast live repo mutation.'));
  const aggressive = (_draft.workflow && _draft.workflow.aggressive) || {};
  workflow.body.appendChild(field('Require clean git before fast apply', toggleControl(aggressive.requireCleanGit !== false, (v) => {
    if (!_draft.workflow) _draft.workflow = {};
    if (!_draft.workflow.aggressive) _draft.workflow.aggressive = {};
    _draft.workflow.aggressive.requireCleanGit = v;
    _checkDirty();
  }, { enabled: 'Require clean git', disabled: 'Allow dirty git' }), 'Recommended on. Turn off only if you want apply tools to operate on a dirty working tree.'));
  workflow.body.appendChild(field('Backup before fast apply', toggleControl(aggressive.backup !== false, (v) => {
    if (!_draft.workflow) _draft.workflow = {};
    if (!_draft.workflow.aggressive) _draft.workflow.aggressive = {};
    _draft.workflow.aggressive.backup = v;
    _checkDirty();
  }, { enabled: 'Backup enabled', disabled: 'No automatic backup' }), 'When dirty edits are allowed, Rel.AI attempts a git stash backup before applying a update or archive.'));
  workflow.body.appendChild(field('Clear missing files during archive overlay', toggleControl(aggressive.deleteMissingDefault === true, (v) => {
    if (!_draft.workflow) _draft.workflow = {};
    if (!_draft.workflow.aggressive) _draft.workflow.aggressive = {};
    _draft.workflow.aggressive.deleteMissingDefault = v;
    _checkDirty();
  }, { enabled: 'Clear missing', disabled: 'Overlay only' }), 'Off means zip/archive apply overwrites and adds files but does not clear live files missing from the archive unless a tool call explicitly asks for clearMissing.'));
  workflow.body.appendChild(field('Max update bytes', numberControl(aggressive.maxPatchBytes || 2097152, (v) => {
    if (!_draft.workflow) _draft.workflow = {};
    if (!_draft.workflow.aggressive) _draft.workflow.aggressive = {};
    _draft.workflow.aggressive.maxPatchBytes = v;
    _checkDirty();
  }, { min: 1024, max: 52428800, width: '150px' }), 'Upper bound for relai_apply_update payloads.'));
  workflow.body.appendChild(field('Max archive bytes', numberControl(aggressive.maxArchiveBytes || 262144000, (v) => {
    if (!_draft.workflow) _draft.workflow = {};
    if (!_draft.workflow.aggressive) _draft.workflow.aggressive = {};
    _draft.workflow.aggressive.maxArchiveBytes = v;
    _checkDirty();
  }, { min: 1048576, max: 2147483648, width: '150px' }), 'Upper bound for local zip overlays.'));

  autoApprove.body.appendChild(autoApproveWarningBox());
  autoApprove.body.appendChild(field('Enable dashboard-side auto-approve', toggleControl((_draft.autoApproveAppRequests || {}).enabled === true, (v) => {
    if (v && !confirmAutoApproveWarning()) return;
    if (!_draft.autoApproveAppRequests) _draft.autoApproveAppRequests = {};
    _draft.autoApproveAppRequests.enabled = v;
    if (v) _draft.autoApproveAppRequests.warningAccepted = true;
    _checkDirty();
  }), 'Both this dashboard setting and the Chrome extension popup toggle must be enabled before any approval automation runs.'));
  autoApprove.body.appendChild(field('Poll interval (ms)', numberControl((_draft.autoApproveAppRequests || {}).pollMs || 1200, (v) => {
    if (!_draft.autoApproveAppRequests) _draft.autoApproveAppRequests = {};
    _draft.autoApproveAppRequests.pollMs = v;
    _checkDirty();
  }, { min: 500, max: 10000, width: '140px' }), 'How often the Chrome extension may scan ChatGPT for a Rel.AI MCP app request.'));
  autoApprove.body.appendChild(field('Install Chrome extension', extensionInstallControl(), 'Load the unpacked Chrome extension, then use the extension popup to configure the dashboard URL/token and enable or disable it locally.'));


  limits.body.appendChild(field('Max output bytes', numberControl(_draft.maxOutputBytes, (v) => { _draft.maxOutputBytes = v; _checkDirty(); }, { min: 10000, max: 20000000, width: '140px' }), 'Maximum command output returned to ChatGPT. 2 MB is a safe default for test failures without flooding the chat.'));

  local.body.appendChild(field('Dashboard enabled', toggleControl(_draft.dashboardEnabled !== false, (v) => { _draft.dashboardEnabled = v; _checkDirty(); }), 'Controls this local dashboard only.'));
  local.body.appendChild(field('Color theme', _themeToggle(), 'Stored only in this browser.'));

  grid.appendChild(bridge.el);
  grid.appendChild(workflow.el);
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
    This is the always-on local connector between ChatGPT and your configured repositories. It avoids uploading a zip for every task through one reliable workflow: <code>relai_repo_snapshot</code>, <code>relai_read</code>, <code>relai_replace</code> exact edits, <code>relai_write</code> full-file writes, <code>relai_clear_files</code> file clearing, <code>relai_run_checks</code>, <code>relai_browser</code>, <code>relai_diff</code>, and <code>relai_restore_changes</code>.<br>
    Fast task settings live on each workspace and reduce broad scans/indexing for small tasks across any language stack.
  `;
  return div;
}


function workflowWarningBox() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.cssText = 'text-align:left;padding:12px;line-height:1.55;border-color:rgba(99,102,241,.35);background:rgba(99,102,241,.08);';
  div.innerHTML = `
    <strong style="color:var(--text);">Choose how hard Rel.AI is allowed to drive.</strong><br>
    Conservative mode keeps exact replacements, file writes, clears, verification, diff, and reset. Fast mode adds Codex-style live update/bundle application for fast repo-wide changes. It still preserves <code>.git</code>, keeps path guards, and can require a clean git state before applying.
  `;
  return div;
}

function confirmFastFlow() {
  return window.confirm('Enable fast flow mode?\n\nThis exposes live update/bundle apply tools for fast Codex-style repo edits. Commit or stash your work first. Rel.AI will still protect .git and workspace boundaries.');
}
function autoApproveWarningBox() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.cssText = 'text-align:left;padding:12px;line-height:1.55;border-color:rgba(255,184,77,.35);background:rgba(255,184,77,.08);';
  div.innerHTML = `
    <strong style="color:var(--text);">Warning: app-request auto-approve is dangerous.</strong><br>
    This optional Chrome extension can click ChatGPT approval buttons for Rel.AI MCP app requests. That can authorize local repo reads, full-file writes, verification commands, browser checks, diffs, or resets without a manual click. Keep it off unless you are actively supervising a task on your own trusted machine. The previous userscript workflow has been removed.
  `;
  return div;
}

function confirmAutoApproveWarning() {
  return window.confirm('Enable Rel.AI MCP auto-approve?\n\nThis can click ChatGPT app-request approvals for local repo actions without a manual click. Use only on your own trusted machine and turn it off after the task.');
}

function extensionInstallControl() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;';

  const docs = document.createElement('a');
  docs.className = 'buttonlike';
  docs.textContent = 'Open extension setup docs';
  docs.href = '/public/docs/AUTO_APPROVE_EXTENSION.md';
  docs.target = '_blank';
  docs.rel = 'noopener';

  const manifest = document.createElement('a');
  manifest.className = 'buttonlike secondary';
  manifest.textContent = 'View manifest';
  manifest.href = '/public/extensions/chrome-auto-approve/manifest.json';
  manifest.target = '_blank';
  manifest.rel = 'noopener';

  const folderHint = document.createElement('div');
  folderHint.style.cssText = 'width:100%;font-size:12px;color:var(--text-muted);line-height:1.45;';
  folderHint.innerHTML = 'Load unpacked extension from <code>public/extensions/chrome-auto-approve</code> in this package. Configure the dashboard URL and token in the extension popup.';

  wrap.append(docs, manifest, folderHint);
  return wrap;
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
  const keys = ['maxOutputBytes', 'dashboardEnabled', 'autoApproveAppRequests', 'workflow'];
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
    autoApproveAppRequests: _draft.autoApproveAppRequests,
    workflow: _draft.workflow
  };
  const res = await saveSettings(payload);
  if (res && res.ok) await _loadAndRender(container);
}

function _themeToggle() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px;';
  const dark = document.createElement('button'); dark.textContent = 'Dark'; dark.type = 'button';
  const light = document.createElement('button'); light.textContent = 'Light'; light.type = 'button'; light.className = 'secondary';
  dark.onclick = () => { localStorage.setItem('relai_theme', 'dark'); clear document.documentElement.dataset.theme; };
  light.onclick = () => { localStorage.setItem('relai_theme', 'light'); document.documentElement.dataset.theme = 'light'; };
  wrap.append(dark, light);
  return wrap;
}
