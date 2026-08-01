import { statusPillClass, statusTone } from '../status-tone.js';

function pillClass(value) {
  return statusPillClass(value);
}

const OVERRIDE_TONES = Object.freeze({
  bad: 'danger',
  error: 'danger',
  failed: 'danger',
  warn: 'warning',
  incomplete: 'warning',
  working: 'information',
  open: 'information',
  waiting: 'information',
  ok: 'success',
  good: 'success',
  ready: 'success'
});

function toneLabel(value, classOverride = '') {
  return OVERRIDE_TONES[classOverride] || statusTone(value);
}

export function Pill(value, extraClass = '') {
  const cls = pillClass(value);
  const el = document.createElement('span');
  el.className = `status-pill ${cls} ${extraClass}`.trim();
  el.textContent = String(value || 'unknown');
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = ` (${toneLabel(value)})`;
  el.appendChild(sr);
  return el;
}

export function pillHtml(value, classOverride = '') {
  const cls = String(classOverride || pillClass(value)).trim();
  return `<span class="status-pill ${cls}">${esc(String(value || 'unknown'))}<span class="sr-only"> (${toneLabel(value, cls)})</span></span>`;
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export { pillClass };
