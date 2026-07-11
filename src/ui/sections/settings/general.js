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
import { getUiPreferences, setDensityPreference, setThemePreference } from '../../preferences.js';

let _original = null;
let _draft = null;

export function mountGeneral(container) {
  container.innerHTML = '<div class="settings-loading">Loading settings…</div>';
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
  container.appendChild(header('General', 'Manage dashboard appearance, safeguards for prepared updates, and runtime output limits.'));

  const grid = formGrid();
  const appearance = panel('Appearance');
  const preparedUpdates = panel('Prepared update safeguards');
  const limits = panel('Runtime limits');

  renderAppearanceSettings(appearance.body);
  renderPreparedUpdateSettings(preparedUpdates.body);
  renderRuntimeSettings(limits.body);

  grid.append(appearance.el, preparedUpdates.el, limits.el);
  container.appendChild(grid);
  container.appendChild(buildSaveRow(container));
}

function renderAppearanceSettings(body) {
  const uiPreferences = getUiPreferences();
  body.appendChild(appearancePreview());
  body.appendChild(field('Theme', selectControl([
    { value: 'system', label: 'Follow system appearance' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ], uiPreferences.theme, value => setThemePreference(value)), 'Stored locally in this browser. System mode follows the operating system appearance.'));
  body.appendChild(field('Interface density', selectControl([
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' }
  ], uiPreferences.density, value => setDensityPreference(value)), 'Compact mode reduces card, table, navigation, and control spacing without hiding information.'));
}

function renderPreparedUpdateSettings(body) {
  const prepared = _draft.workflow?.prepared || {};
  body.appendChild(preparedSafeguardsIntro());
  body.appendChild(field('Require clean git before apply', toggleControl(prepared.requireCleanGit === true, value => {
    updatePreparedSetting('requireCleanGit', value);
  }, { enabled: 'Require clean git', disabled: 'Allow existing changes' }), 'When enabled, prepared patch and bundle operations refuse to run while the workspace has uncommitted changes.'));
  body.appendChild(field('Create backup before apply', toggleControl(prepared.backup !== false, value => {
    updatePreparedSetting('backup', value);
  }, { enabled: 'Backup enabled', disabled: 'No automatic backup' }), 'When the workspace already has tracked changes, Rel.AI records a git stash backup without removing those changes from the working tree.'));
  body.appendChild(field('Clear files missing from a bundle', toggleControl(prepared.clearMissingDefault === true, value => {
    updatePreparedSetting('clearMissingDefault', value);
  }, { enabled: 'Clear missing files', disabled: 'Overlay only' }), 'Overlay only adds or replaces files. Clear missing also removes live files that are absent from the applied bundle.'));
  body.appendChild(field('Maximum patch size', numberControl(prepared.maxUpdateBytes || 2097152, value => {
    updatePreparedSetting('maxUpdateBytes', value);
  }, { min: 1024, max: 52428800, width: '150px' }), 'Maximum size in bytes for patch-shaped updates sent through relai_edit updateText.'));
  body.appendChild(field('Maximum bundle size', numberControl(prepared.maxBundleBytes || 262144000, value => {
    updatePreparedSetting('maxBundleBytes', value);
  }, { min: 1048576, max: 2147483648, width: '150px' }), 'Maximum size in bytes for local zip bundles applied through relai_apply_bundle.'));
}

function renderRuntimeSettings(body) {
  body.appendChild(field('Max output bytes', numberControl(_draft.maxOutputBytes, value => {
    _draft.maxOutputBytes = value;
    _checkDirty();
  }, { min: 10000, max: 20000000, width: '140px' }), 'Maximum validation output returned to ChatGPT. The default keeps useful failure details without flooding the conversation.'));
}

function updatePreparedSetting(key, value) {
  _draft.workflow ??= {};
  _draft.workflow.prepared ??= {};
  _draft.workflow.prepared[key] = value;
  _checkDirty();
}

function appearancePreview() {
  const preview = document.createElement('div');
  preview.className = 'appearance-preview';
  preview.innerHTML = `
    <div class="appearance-swatch"><strong>Primary surface</strong><span>Cards, navigation, and dialogs</span></div>
    <div class="appearance-swatch"><strong>Information density</strong><span>Spacing changes without reducing content</span></div>`;
  return preview;
}

function preparedSafeguardsIntro() {
  const intro = document.createElement('div');
  intro.className = 'settings-panel-intro';
  intro.innerHTML = `
    <strong>Applies only to prepared patches and zip bundles.</strong>
    <span>Normal exact replacements, file writes, validation, diff, and restore operations are unaffected.</span>`;
  return intro;
}

function buildSaveRow(container) {
  const save = saveRow(() => _save(container), () => _loadAndRender(container));
  save.id = '__settings-save-row';
  save.hidden = true;
  const changes = document.createElement('button');
  changes.className = 'secondary compact-button settings-pending-button';
  changes.id = '__settings-changes-link';
  changes.onclick = () => alert(_getChanges().map(change => `${change.key}: ${JSON.stringify(change.oldValue)} -> ${JSON.stringify(change.newValue)}`).join('\n'));
  save.prepend(changes);
  return save;
}

function _checkDirty() {
  const saveRowEl = document.getElementById('__settings-save-row');
  if (!saveRowEl) return;
  const changes = _getChanges();
  saveRowEl.hidden = changes.length === 0;
  const link = document.getElementById('__settings-changes-link');
  if (link) link.textContent = `${changes.length} change${changes.length === 1 ? '' : 's'} pending`;
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
  const response = await saveSettings({
    maxOutputBytes: _draft.maxOutputBytes,
    workflow: _draft.workflow
  });
  if (response?.ok) await _loadAndRender(container);
}
