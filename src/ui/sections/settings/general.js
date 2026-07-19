import {
  loadSettingsConfig,
  saveSettings,
  header,
  panel,
  field,
  toggleControl,
  numberControl,
  selectControl,
  saveRow
} from './shared.js';
import { getUiPreferences, setDensityPreference, setThemePreference } from '../../preferences.js';

const MIB = 1024 * 1024;
let _original = null;
let _draft = null;

export function mountGeneral(container) {
  container.innerHTML = '<div class="settings-loading">Loading settings…</div>';
  return _loadAndRender(container);
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
  container.appendChild(header('General', 'Control appearance and local editing safeguards. Dashboard refresh and history controls have their own section.'));

  const appearance = panel('Appearance');
  renderAppearanceSettings(appearance.body);
  container.appendChild(appearance.el);
  container.appendChild(advancedSettings());
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
  ], uiPreferences.density, value => setDensityPreference(value)), 'Compact mode reduces spacing without hiding information.'));
}

function advancedSettings() {
  const details = document.createElement('details');
  details.className = 'card settings-advanced';
  details.innerHTML = `
    <summary class="settings-advanced-summary">
      <span><strong>Safety and resource limits</strong><small>Patch safeguards and retained command output</small></span>
      <span aria-hidden="true">›</span>
    </summary>`;
  const body = document.createElement('div');
  body.className = 'card-body settings-panel-body';
  renderPatchSettings(body);
  renderRuntimeSettings(body);
  details.appendChild(body);
  return details;
}

function renderPatchSettings(body) {
  const patch = _draft.patch || {};
  body.appendChild(patchSafeguardsIntro());
  body.appendChild(field('Require clean git before patch', toggleControl(patch.requireCleanGit === true, value => {
    updatePatchSetting('requireCleanGit', value);
  }, { enabled: 'Require clean git', disabled: 'Allow existing changes' }), 'Blocks updateText patches when the workspace already has uncommitted changes.'));
  body.appendChild(field('Create backup before patch', toggleControl(patch.backup !== false, value => {
    updatePatchSetting('backup', value);
  }, { enabled: 'Backup enabled', disabled: 'No automatic backup' }), 'Records a git stash backup before patching over tracked changes.'));
  body.appendChild(field('Patch limit (MiB)', megabyteControl(patch.maxUpdateBytes || 2 * MIB, value => {
    updatePatchSetting('maxUpdateBytes', value);
  }, 50), 'Current per-update limit for updateText patches.'));
}

function renderRuntimeSettings(body) {
  body.appendChild(field('Command output retained (MiB)', megabyteControl(_draft.maxOutputBytes || 2 * MIB, value => {
    _draft.maxOutputBytes = value;
    _checkDirty();
  }, 19), 'Current stdout and stderr retention limit per operation. Larger output is truncated.'));
}

function megabyteControl(bytes, onChange, max) {
  const value = Number((Number(bytes || MIB) / MIB).toFixed(1));
  return numberControl(value, next => {
    if (!Number.isFinite(next)) return;
    const bounded = Math.min(Math.max(next, 1), max);
    onChange(Math.round(bounded * MIB));
  }, { min: 1, max, step: 0.5 });
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
    <strong>Patch safeguards</strong>
    <span>These defaults apply to <code>relai_edit</code> updateText patches. Exact replacements and full-file writes are unaffected.</span>`;
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
