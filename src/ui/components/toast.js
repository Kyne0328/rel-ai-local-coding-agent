const TOAST_VARIANTS = Object.freeze({
  info: { symbol: 'i', label: 'Information', role: 'status', duration: 5000 },
  success: { symbol: '✓', label: 'Success', role: 'status', duration: 4000 },
  warn: { symbol: '!', label: 'Warning', role: 'status', duration: 8000 },
  error: { symbol: '×', label: 'Error', role: 'alert', duration: 0 }
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

export function toast(message, { variant = 'info', duration } = {}) {
  const tone = Object.hasOwn(TOAST_VARIANTS, variant) ? variant : 'info';
  const metadata = TOAST_VARIANTS[tone];
  const effectiveDuration = Number.isFinite(duration) ? Math.max(0, duration) : metadata.duration;
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

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-dismiss';
  dismiss.setAttribute('aria-label', `Dismiss ${metadata.label.toLowerCase()} notification`);
  dismiss.textContent = '×';
  let timer = null;
  const remove = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    element.remove();
  };
  dismiss.addEventListener('click', remove, { once: true });

  element.append(marker, copy, dismiss);
  getRegion().appendChild(element);
  if (effectiveDuration > 0) timer = setTimeout(remove, effectiveDuration);
  return element;
}
