// Status pill with sr-only text for accessibility
export function Pill(value, extraClass = '') {
  const s = String(value || 'ok').toLowerCase();
  const cls = s.includes('fail') || s.includes('error') || s.includes('denied') || s.includes('blocked') || s === 'false' ? 'bad'
    : s.includes('pending') || s.includes('run') || s.includes('warn') || s.includes('wait') || s.includes('active') ? 'warn'
    : 'ok';
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
  const s = String(value || 'ok').toLowerCase();
  const cls = s.includes('fail') || s.includes('error') || s.includes('denied') || s.includes('blocked') || s === 'false' ? 'bad'
    : s.includes('pending') || s.includes('run') || s.includes('warn') || s.includes('wait') || s.includes('active') ? 'warn'
    : 'ok';
  return `<span class="status-pill ${cls}">${esc(String(value || 'ok'))}<span class="sr-only"> (${cls})</span></span>`;
}

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
