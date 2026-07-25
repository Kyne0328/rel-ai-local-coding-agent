import { fetchJson, postJson, invalidateCache, DASHBOARD_DATA_URL } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { toast } from '../../components/toast.js';
import { Toggle } from '../../components/toggle.js';
import { Select } from '../../components/select.js';
import { esc, titleize } from '../../utils.js';

export async function loadSettingsConfig(container) {
  const payload = await fetchJson('/api/settings');
  if (!payload?.ok) {
    container.innerHTML = `<div class="empty">${esc(payload?.error || 'Failed to load settings.')}</div>`;
    return null;
  }
  return payload.config || {};
}

export async function saveSettings(settings, { confirmDangerous = false } = {}) {
  const body = confirmDangerous ? { settings, confirmDangerous: true } : { settings };
  const response = await postJson('/api/settings', body);
  invalidateCache('/api/settings');
  invalidateCache(DASHBOARD_DATA_URL);
  if (response?.ok) toast(response.message || 'Settings saved.', { variant: 'success' });
  else toast('Error: ' + (response?.error || 'settings update failed'), { variant: 'error' });
  return response;
}

export function header(title, body) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-header';
  const description = body ? `<p>${esc(body)}</p>` : '';
  wrapper.innerHTML = `<h3>${esc(title)}</h3>${description}`;
  return wrapper;
}

export function panel(title, body) {
  const element = document.createElement('div');
  element.className = 'card';
  element.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3></div>`;
  const content = document.createElement('div');
  content.className = 'card-body settings-panel-body';
  if (body) content.appendChild(body);
  element.appendChild(content);
  return { el: element, body: content };
}

export function formGrid() {
  const element = document.createElement('div');
  element.className = 'settings-form-grid';
  return element;
}

export function field(label, control, help) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-field';
  const labelElement = document.createElement('label');
  labelElement.textContent = label;
  wrapper.append(labelElement, control);
  if (help) {
    const paragraph = document.createElement('p');
    paragraph.className = 'settings-help';
    paragraph.textContent = help;
    wrapper.appendChild(paragraph);
  }
  return wrapper;
}

export function selectControl(options, value, onChange) {
  return Select({ options, value, onChange });
}

export function toggleControl(checked, onChange, { enabled = 'Enabled', disabled = 'Disabled' } = {}) {
  let control;
  control = Toggle({
    checked: Boolean(checked),
    label: checked ? enabled : disabled,
    onChange: value => {
      onChange(value);
      const label = control.querySelector('.toggle-label');
      if (label) label.textContent = value ? enabled : disabled;
    }
  });
  return control;
}

export function numberControl(value, onChange, { min = 0, max = 1000000, step = 1 } = {}) {
  const element = document.createElement('input');
  element.className = 'settings-number-control';
  element.type = 'number';
  element.value = value == null ? '' : value;
  element.min = String(min);
  element.max = String(max);
  element.step = String(step);
  element.addEventListener('input', () => onChange(Number(element.value)));
  return element;
}

export function textAreaControl(value, onChange, rows = 4) {
  const element = document.createElement('textarea');
  element.className = 'settings-textarea-control';
  element.rows = rows;
  element.value = textAreaValue(value);
  element.addEventListener('input', () => onChange(element.value));
  return element;
}

function textAreaValue(value) {
  if (Array.isArray(value)) return value.join('\n');
  return String(value == null ? '' : value);
}

export function saveRow(onSave, onReload) {
  const row = document.createElement('div');
  row.className = 'settings-save-row';
  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save changes';
  saveButton.onclick = async () => {
    await runButtonAction(saveButton, {
      idleText: 'Save changes',
      loadingText: 'Saving settings…',
      successText: 'Settings saved',
      errorText: 'Save failed'
    }, onSave);
  };
  const reloadButton = document.createElement('button');
  reloadButton.className = 'secondary';
  reloadButton.textContent = 'Discard changes';
  reloadButton.onclick = onReload;
  row.append(saveButton, reloadButton);
  return row;
}

export function settingsTable(map = {}) {
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = '<thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody');
  for (const [key, value] of Object.entries(map)) {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${esc(titleize(key))}</td><td><code>${esc(Array.isArray(value) ? value.join(', ') : String(value))}</code></td>`;
    body.appendChild(row);
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  wrapper.appendChild(table);
  return wrapper;
}
