import { markUnsaved } from '../../interaction-safety.js';
import { esc as escapeHtml } from '../../utils.js';
import {
  loadSettingsConfig,
  saveSettings,
  header,
  panel,
  field,
  toggleControl,
  numberControl,
  hiddenSaveRow
} from './shared.js';

const MIB = 1024 * 1024;
let original = null;
let draft = null;

export function mountAdvanced(container) {
  container.innerHTML = '<div class="settings-loading">Loading advanced settings…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const config = await loadSettingsConfig(container);
  if (!config) return;
  original = structuredClone(config);
  draft = structuredClone(config);
  render(container);
}

function render(container) {
  container.innerHTML = '';
  container.appendChild(header(
    'Advanced',
    'Tune patch safeguards and resource limits. Defaults are appropriate for most installations.'
  ));
  container.appendChild(patchSafeguardsPanel().el);
  container.appendChild(resourceLimitsPanel().el);
  container.appendChild(hiddenSaveRow(() => save(container), () => loadAndRender(container)));
}

function patchSafeguardsPanel() {
  const patch = draft.patch || {};
  const safeguards = panel('Patch safeguards');
  safeguards.body.appendChild(settingsIntro(
    'Protected update defaults',
    'Rel.AI automatically keeps large updateText changes together and stages transport chunks when needed. These controls affect patch safety, not patch size.'
  ));
  safeguards.body.appendChild(field('Require clean git before patch', toggleControl(patch.requireCleanGit === true, value => {
    updatePatchSetting('requireCleanGit', value);
  }, { enabled: 'Require clean git', disabled: 'Allow existing changes' }), 'Rejects updateText patches when Git reports tracked or untracked workspace changes.'));
  safeguards.body.appendChild(field('Create backup before patch', toggleControl(patch.backup !== false, value => {
    updatePatchSetting('backup', value);
  }, { enabled: 'Backup enabled', disabled: 'No automatic backup' }), 'Creates a non-destructive Git stash entry for existing tracked changes before applying a patch. Untracked files are not included.'));
  return safeguards;
}

function resourceLimitsPanel() {
  const resources = panel('Resource limits');
  resources.body.appendChild(settingsIntro(
    'Subprocess output defaults',
    'Individual tools and requests may use dedicated limits instead of this default.'
  ));
  resources.body.appendChild(field('Default output retained per stream (MiB)', megabyteControl(draft.maxOutputBytes || 2 * MIB, value => {
    draft.maxOutputBytes = value;
    checkDirty();
  }, 19), 'Default cap applied separately to stdout and stderr for subprocess operations. Output beyond the active limit is truncated.'));
  return resources;
}

function megabyteControl(bytes, onChange, max) {
  const value = Number((Number(bytes || MIB) / MIB).toFixed(1));
  return numberControl(value, next => {
    if (!Number.isFinite(next)) return;
    onChange(Math.round(Math.min(Math.max(next, 1), max) * MIB));
  }, { min: 1, max, step: 0.5 });
}

function updatePatchSetting(key, value) {
  draft.patch ??= {};
  draft.patch[key] = value;
  checkDirty();
}

function settingsIntro(title, text) {
  const intro = document.createElement('div');
  intro.className = 'settings-panel-intro';
  intro.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span>`;
  return intro;
}

function checkDirty() {
  const row = document.getElementById('__settings-save-row');
  const dirty = changes().length > 0;
  if (row) {
    row.hidden = !dirty;
    markUnsaved(row, dirty);
  }
}

function changes() {
  if (!original || !draft) return [];
  return [
    JSON.stringify(draft.patch) !== JSON.stringify(original.patch) && 'patch',
    draft.maxOutputBytes !== original.maxOutputBytes && 'maxOutputBytes'
  ].filter(Boolean);
}

async function save(container) {
  const response = await saveSettings({
    patch: draft.patch,
    maxOutputBytes: draft.maxOutputBytes
  });
  if (!response?.ok) return response;
  await loadAndRender(container);
  return response;
}

