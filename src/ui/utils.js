// Shared UI helpers for dashboard sections.
export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

export function statusClass(v) {
  const s = String(v || '').toLowerCase();
  if (s.includes('fail') || s.includes('error') || s.includes('rejected') || s.includes('repair') || s.includes('blocked') || s === 'false') return 'bad';
  if (s.includes('pending') || s.includes('run') || s.includes('warn') || s.includes('active') || s.includes('created') || s.includes('paused')) return 'warn';
  return 'ok';
}

export function metricHtml(label, value, meta, type) {
  return `<div class="metric ${esc(type || '')}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-meta">${esc(meta || '')}</div></div>`;
}

export function listItemHtml(title, sub, time, state) {
  const c = statusClass(state || 'ok');
  return `<div class="list-item"><span class="dot ${c === 'ok' ? '' : c}"></span><div><div class="item-title">${esc(title)}</div><div class="item-sub">${esc(sub || '')}</div></div><div class="item-time">${esc(time || '')}</div></div>`;
}

export function short(v, head = 10, tail = 5, max = 20) {
  const s = String(v || '');
  return s.length > max ? s.slice(0, head) + '…' + s.slice(-tail) : s;
}

export function timeAgo(v) {
  const ts = Date.parse(String(v || ''));
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor(Math.max(0, Date.now() - ts) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h ago' : Math.floor(h / 24) + 'd ago';
}

export function titleize(v) {
  return String(v || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
