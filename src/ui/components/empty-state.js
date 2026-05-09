export function EmptyState({ icon = '□', title, body, cta, onCta } = {}) {
  const el = document.createElement('div');
  el.className = 'empty';
  el.style.cssText = 'display:grid;gap:8px;text-align:center;padding:32px 16px;';
  const iconEl = document.createElement('div');
  iconEl.style.cssText = 'font-size:24px;';
  iconEl.textContent = icon;
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight:700;font-size:14px;';
  titleEl.textContent = title || '';
  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'color:var(--muted,var(--text-muted));font-size:13px;';
  bodyEl.textContent = body || '';
  el.appendChild(iconEl);
  el.appendChild(titleEl);
  el.appendChild(bodyEl);
  if (cta && onCta) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.style.marginTop = '8px';
    btn.textContent = cta;
    btn.onclick = onCta;
    el.appendChild(btn);
  }
  return el;
}
