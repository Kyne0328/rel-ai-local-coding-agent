import { fetchJson, postJson, invalidateCache, DASHBOARD_DATA_URL } from '../../api.js';
import { toast } from '../../components/toast.js';
import { Toggle } from '../../components/toggle.js';
import { Select } from '../../components/select.js';
import { esc, titleize } from '../../utils.js';

export async function loadSettingsConfig(container) {
  const payload = await fetchJson('/api/settings');
  if (!payload || !payload.ok) {
    container.innerHTML = `<div class="empty">${esc((payload && payload.error) || 'Failed to load settings.')}</div>`;
    return null;
  }
  return payload.config || {};
}

export async function saveSettings(settings, { confirmDangerous = false } = {}) {
  const body = confirmDangerous ? { settings, confirmDangerous: true } : { settings };
  const res = await postJson('/api/settings', body);
  invalidateCache('/api/settings');
  invalidateCache(DASHBOARD_DATA_URL);
  if (res && res.ok) toast(res.message || 'Settings saved.', { variant: 'success' });
  else toast('Error: ' + ((res && res.error) || 'settings update failed'), { variant: 'error' });
  return res;
}

export function header(title, body) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;gap:4px;margin:0 0 14px;';
  wrap.innerHTML = `<h3 style="margin:0;font-size:15px;">${esc(title)}</h3>${body ? `<p style="margin:0;color:var(--text-muted);font-size:13px;">${esc(body)}</p>` : ''}`;
  return wrap;
}

export function panel(title, body) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<div class="card-head"><h3>${esc(title)}</h3></div>`;
  const content = document.createElement('div');
  content.className = 'card-body';
  content.style.cssText = 'display:grid;gap:12px;';
  if (body) content.appendChild(body);
  el.appendChild(content);
  return { el, body: content };
}

export function formGrid() {
  const el = document.createElement('div');
  el.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;max-width:980px;';
  return el;
}

export function field(label, control, help) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;gap:6px;';
  const lbl = document.createElement('label');
  lbl.style.cssText = 'font-size:13px;font-weight:700;';
  lbl.textContent = label;
  wrap.appendChild(lbl);
  wrap.appendChild(control);
  if (help) {
    const p = document.createElement('p');
    p.style.cssText = 'font-size:12px;color:var(--text-muted);margin:0;';
    p.textContent = help;
    wrap.appendChild(p);
  }
  return wrap;
}

export function selectControl(options, value, onChange) {
  return Select({ options, value, onChange });
}

export function toggleControl(checked, onChange, { enabled = 'Enabled', disabled = 'Disabled' } = {}) {
  let control;
  control = Toggle({
    checked: Boolean(checked),
    label: checked ? enabled : disabled,
    onChange: (value) => {
      onChange(value);
      const label = control.querySelector('span');
      if (label) label.textContent = value ? enabled : disabled;
    }
  });
  return control;
}

export function numberControl(value, onChange, { min = 0, max = 1000000, width = '96px' } = {}) {
  const el = document.createElement('input');
  el.type = 'number';
  el.value = value == null ? '' : value;
  el.min = String(min);
  el.max = String(max);
  el.style.cssText = `width:${width};`;
  el.addEventListener('input', () => onChange(Number(el.value)));
  return el;
}

export function textAreaControl(value, onChange, rows = 4) {
  const el = document.createElement('textarea');
  el.rows = rows;
  el.value = Array.isArray(value) ? value.join('\n') : String(value == null ? '' : value);
  el.style.cssText = 'width:100%;min-height:90px;border:1px solid var(--line);border-radius:10px;padding:10px;color:var(--text);background:#090f1b;font:inherit;';
  el.addEventListener('input', () => onChange(el.value));
  return el;
}

export function saveRow(onSave, onReload) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap;';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save changes';
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try { await onSave(); }
    finally { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
  };
  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'secondary';
  reloadBtn.textContent = 'Reload';
  reloadBtn.onclick = onReload;
  row.appendChild(saveBtn);
  row.appendChild(reloadBtn);
  return row;
}

export function settingsTable(map = {}) {
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = '<thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody></tbody>';
  const body = table.querySelector('tbody');
  for (const [key, value] of Object.entries(map)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${esc(titleize(key))}</td><td><code>${esc(Array.isArray(value) ? value.join(', ') : String(value))}</code></td>`;
    body.appendChild(tr);
  }
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.appendChild(table);
  return wrap;
}
