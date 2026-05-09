export function Badge(text, variant = '') {
  const el = document.createElement('span');
  el.className = `badge ${variant}`.trim();
  el.textContent = text;
  return el;
}

export function badgeHtml(text, variant = '') {
  const v = String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<span class="badge ${variant}">${v}</span>`;
}
