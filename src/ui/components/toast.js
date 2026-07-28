const TOAST_VARIANTS = Object.freeze({
  info: { symbol: 'i', label: 'Information', role: 'status' },
  success: { symbol: '✓', label: 'Success', role: 'status' },
  warn: { symbol: '!', label: 'Warning', role: 'status' },
  error: { symbol: '×', label: 'Error', role: 'alert' }
});

let _region = null;

function getRegion() {
  if (_region) return _region;
  _region = document.createElement('div');
  _region.className = 'toast-region';
  _region.setAttribute('aria-live', 'polite');
  document.body.appendChild(_region);
  return _region;
}

export function toast(message, { variant = 'info', duration = 4000 } = {}) {
  const tone = Object.hasOwn(TOAST_VARIANTS, variant) ? variant : 'info';
  const metadata = TOAST_VARIANTS[tone];
  const element = document.createElement('div');
  element.className = `toast toast-${tone}`;
  element.setAttribute('role', metadata.role);

  const marker = document.createElement('span');
  marker.className = 'toast-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = metadata.symbol;

  const copy = document.createElement('span');
  copy.className = 'toast-copy';
  copy.textContent = String(message || '');
  copy.setAttribute('aria-label', `${metadata.label}: ${String(message || '')}`);

  element.append(marker, copy);
  getRegion().appendChild(element);
  if (duration > 0) setTimeout(() => element.remove(), duration);
  return element;
}
