// Toast — role=status region, top-right, auto-dismiss
let _region = null;

function _getRegion() {
  if (_region) return _region;
  _region = document.createElement('div');
  _region.setAttribute('role', 'status');
  _region.setAttribute('aria-live', 'polite');
  _region.style.cssText = `
    position:fixed;top:16px;right:16px;z-index:var(--z-toast,70);
    display:flex;flex-direction:column;gap:8px;max-width:320px;
  `;
  document.body.appendChild(_region);
  return _region;
}

export function toast(message, { variant = 'info', duration = 4000 } = {}) {
  const region = _getRegion();
  const colors = { info: 'var(--blue-dim,rgba(78,161,255,.15))', warn: 'var(--yellow-dim,rgba(255,194,75,.15))', error: 'var(--red-dim,rgba(255,102,128,.15))', success: 'var(--green-dim,rgba(71,221,138,.15))' };
  const el = document.createElement('div');
  el.style.cssText = `
    padding:12px 14px;border-radius:10px;font-size:13px;
    background:${colors[variant] || colors.info};
    border:1px solid var(--line-soft);color:var(--text);
    box-shadow:var(--shadow-1);
  `;
  el.textContent = message;
  region.appendChild(el);
  if (duration > 0) setTimeout(() => el.remove(), duration);
  return el;
}
