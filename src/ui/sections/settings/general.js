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
  const config = await loadSettingsConfig(container);
  if (!config) return;
  _original = structuredClone(config);
  _draft = structuredClone(config);
  _render(container);
}

function _render(container) {
  container.innerHTML = '';
  container.appendChild(header('General', 'Manage dashboard appearance, patch safeguards, and command-output limits.'));

  const grid = formGrid();
  const appearance = panel('Appearance');
  const patch = panel('Patch safeguards');
  const limits = panel('Runtime limits');

  renderAppearanceSettings(appearance.body);
  renderPatchSettings(patch.body);
  renderRuntimeSettings(limits.body);

  grid.append(appearance.el, patch.el, limits.el);
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

function renderPatchSettings(body) {
  const patch = _draft.patch || {};
  body.appendChild(patchSafeguardsIntro());
  body.appendChild(field('Require clean git before patch', toggleControl(patch.requireCleanGit === true, value => {
    updatePatchSetting('requireCleanGit', value);
  }, { enabled: 'Require clean git', disabled: 'Allow existing changes' }), 'When enabled, relai_edit updateText refuses to apply while the workspace has uncommitted changes.'));
  body.appendChild(field('Create backup before patch', toggleControl(patch.backup !== false, value => {
    updatePatchSetting('backup', value);
  }, { enabled: 'Backup enabled', disabled: 'No automatic backup' }), 'When tracked changes already exist, Rel.AI records a git stash backup without removing those changes from the working tree.'));
  body.appendChild(field('Maximum patch size', numberControl(patch.maxUpdateBytes || 2097152, value => {
    updatePatchSetting('maxUpdateBytes', value);
  }, { min: 1024, max: 52428800, width: '150px' }), 'Maximum size in bytes for patch-shaped updates sent through relai_edit updateText.'));
}

function renderRuntimeSettings(body) {
  body.appendChild(field('Max output bytes', numberControl(_draft.maxOutputBytes, value => {
    _draft.maxOutputBytes = value;
    _checkDirty();
  }, { min: 10000, max: 20000000, width: '140px' }), 'Maximum stdout and stderr retained for each spawned command, including checks, browser checks, and Git operations. Larger output is truncated.'));
}

function updatePatchSetting(key, value) {
  _draft.patch ??= {};
  _draft.patch[key] = value;
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

function patchSafeguardsIntro() {
  const intro = document.createElement('div');
  intro.className = 'settings-panel-intro';
  intro.innerHTML = `
    <strong>These settings are active defaults.</strong>
    <span>They apply only when <code>relai_edit</code> receives an <code>updateText</code> patch. Exact replacements and full-file writes are unaffected.</span>`;
  return intro;
}

function buildSaveRow(container) {
  const save = saveRow(() => _save(container), () => _loadAndRender(container));
  save.id = '__settings-save-row';
  save.hidden = true;
  return save;
}

function _checkDirty() {
  const saveRowElement = document.getElementById('__settings-save-row');
  if (!saveRowElement) return;
  saveRowElement.hidden = _getChanges().length === 0;
}

function _getChanges() {
  if (!_original || !_draft) return [];
  const keys = ['maxOutputBytes', 'patch'];
  return keys
    .filter(key => JSON.stringify(_draft[key]) !== JSON.stringify(_original[key]))
    .map(key => ({ key, oldValue: _original[key], newValue: _draft[key] }));
}

async function _save(container) {
  const response = await saveSettings({
    maxOutputBytes: _draft.maxOutputBytes,
    patch: _draft.patch
  });
  if (response?.ok) await _loadAndRender(container);
}
