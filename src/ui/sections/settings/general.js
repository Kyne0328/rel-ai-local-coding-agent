// General settings — one ChatGPT workspace bridge, no legacy permission model
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
  _original = structuredClone(cfg);
  _draft = structuredClone(cfg);
  _render(container);
}

function _render(container) {
  container.innerHTML = '';
  container.appendChild(header('General', 'Rel.AI uses one workspace bridge for ChatGPT: the repo stays on your machine, while ChatGPT gets explicit tools to inspect, change, validate, review, and restore configured workspaces.'));

  const grid = formGrid();
  const bridge = panel('ChatGPT local repo bridge');
  const workflow = panel('Workspace update style');
  const limits = panel('Runtime limits');

  bridge.body.appendChild(summaryBox());
  bridge.body.appendChild(field('Workspace access', toggleControl(true, () => {}, { enabled: 'Always enabled', disabled: 'Always enabled' }), 'Configured workspaces are exposed through one peer-level tool surface. Workspace-level context settings control how much context is scanned before structured writes.'));

  workflow.body.appendChild(workflowWarningBox());
  workflow.body.appendChild(field('Mode', selectControl([
    { value: 'standard', label: 'Focused edits and guarded writes' },
    { value: 'prepared', label: 'Prepared update and bundle apply' }
  ], _draft.workflow?.mode || 'standard', (value) => {
    if (value === 'prepared' && !confirmFastFlow()) return;
    _draft.workflow ??= {};
    _draft.workflow.mode = value;
    _checkDirty();
  }), 'Both options keep the same workspace-tool surface. Prepared update mode adds bundle apply and snapshot packaging (relai_apply_bundle, relai_package_snapshot) alongside relai_edit patch updates for larger changes.'));
  const prepared = _draft.workflow?.prepared || {};
  workflow.body.appendChild(field('Require clean git before prepared apply', toggleControl(prepared.requireCleanGit !== false, (v) => {
    _draft.workflow ??= {};
    _draft.workflow.prepared ??= {};
    _draft.workflow.prepared.requireCleanGit = v;
    _checkDirty();
  }, { enabled: 'Require clean git', disabled: 'Allow dirty git' }), 'Off by default. Turn on to make prepared apply tools refuse to run on a dirty working tree.'));
  workflow.body.appendChild(field('Backup before prepared apply', toggleControl(prepared.backup !== false, (v) => {
    _draft.workflow ??= {};
    _draft.workflow.prepared ??= {};
    _draft.workflow.prepared.backup = v;
    _checkDirty();
  }, { enabled: 'Backup enabled', disabled: 'No automatic backup' }), 'When dirty edits are allowed, Rel.AI attempts a git stash backup before applying an update or archive.'));
  workflow.body.appendChild(field('Clear missing files during archive overlay', toggleControl(prepared.clearMissingDefault === true, (v) => {
    _draft.workflow ??= {};
    _draft.workflow.prepared ??= {};
    _draft.workflow.prepared.clearMissingDefault = v;
    _checkDirty();
  }, { enabled: 'Clear missing', disabled: 'Overlay only' }), 'Off means zip/archive apply overwrites and adds files but does not clear live files missing from the archive unless a tool call explicitly asks for clearMissing.'));
  workflow.body.appendChild(field('Max update bytes', numberControl(prepared.maxUpdateBytes || 2097152, (v) => {
    _draft.workflow ??= {};
    _draft.workflow.prepared ??= {};
    _draft.workflow.prepared.maxUpdateBytes = v;
    _checkDirty();
  }, { min: 1024, max: 52428800, width: '150px' }), 'Upper bound for prepared update payloads (relai_edit updateText).'));
  workflow.body.appendChild(field('Max archive bytes', numberControl(prepared.maxBundleBytes || 262144000, (v) => {
    _draft.workflow ??= {};
    _draft.workflow.prepared ??= {};
    _draft.workflow.prepared.maxBundleBytes = v;
    _checkDirty();
  }, { min: 1048576, max: 2147483648, width: '150px' }), 'Upper bound for local zip overlays.'));

  limits.body.appendChild(field('Max output bytes', numberControl(_draft.maxOutputBytes, (v) => { _draft.maxOutputBytes = v; _checkDirty(); }, { min: 10000, max: 20000000, width: '140px' }), 'Maximum validation output returned to ChatGPT. 2 MB is a safe default for test failures without flooding the chat.'));

  grid.appendChild(bridge.el);
  grid.appendChild(workflow.el);
  grid.appendChild(limits.el);
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
    This is the always-on workspace connector between ChatGPT and your configured repositories. It avoids uploading a zip for every task through one reliable workflow: <code>relai_repo_snapshot</code>, <code>relai_read</code>, <code>relai_edit</code> unified edits (exact replace, full-file write, patch, or batch — with optional checks and diff in the same call), <code>relai_apply_bundle</code>, <code>relai_clear_files</code> file clearing, <code>relai_run_checks</code>, <code>relai_browser</code>, <code>relai_diff</code>, and <code>relai_restore_changes</code>.<br>
    Context settings live on each workspace and reduce broad scans/indexing for small tasks across any language stack.
  `;
  return div;
}


function workflowWarningBox() {
  const div = document.createElement('div');
  div.className = 'empty';
  div.style.cssText = 'text-align:left;padding:12px;line-height:1.55;border-color:rgba(99,102,241,.35);background:rgba(99,102,241,.08);';
  div.innerHTML = `
    <strong style="color:var(--text);">Choose how Rel.AI applies workspace updates.</strong><br>
    Focused edits favor exact replacements, file writes, clears, validation, diff, and restore. Prepared update mode also allows update/bundle application for repo-wide changes. It still preserves <code>.git</code>, keeps path guards, and can require a clean git state before applying.
  `;
  return div;
}

function confirmFastFlow() {
  return window.confirm('Enable prepared update mode?\n\nThis enables update/bundle apply tools for repo-wide edits. Commit or stash your work first. Rel.AI will still protect .git and workspace boundaries.');
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
  const keys = ['maxOutputBytes', 'workflow'];
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
    workflow: _draft.workflow
  };
  const res = await saveSettings(payload);
  if (res?.ok) await _loadAndRender(container);
}
