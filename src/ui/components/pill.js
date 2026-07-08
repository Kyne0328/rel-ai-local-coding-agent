// Status pill with sr-only text for accessibility
function pillClass(value) {
  const s = String(value || 'ok').toLowerCase();
  if (s.includes('fail') || s.includes('error') || s.includes('denied') || s.includes('blocked') || s === 'false') return 'bad';
  if (s.includes('pending') || s.includes('run') || s.includes('warn') || s.includes('wait') || s.includes('active')) return 'warn';
  return 'ok';
}

export function Pill(value, extraClass = '') {
  const cls = pillClass(value);
  const el = document.createElement('span');
  el.className = `status-pill ${cls} ${extraClass}`.trim();
  el.textContent = String(value || 'ok');
  // sr-only status text
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = ` (${cls})`;
  el.appendChild(sr);
  return el;
}

export function pillHtml(value) {
  const cls = pillClass(value);
  return `<span class="status-pill ${cls}">${esc(String(value || 'ok'))}<span class="sr-only"> (${cls})</span></span>`;
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
