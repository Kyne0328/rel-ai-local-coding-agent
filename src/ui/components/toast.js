let _region = null;

function getRegion() {
  if (_region) return _region;
  _region = document.createElement('div');
  _region.className = 'toast-region';
  _region.setAttribute('role', 'status');
  _region.setAttribute('aria-live', 'polite');
  document.body.appendChild(_region);
  return _region;
}

export function toast(message, { variant = 'info', duration = 4000 } = {}) {
  const element = document.createElement('div');
  element.className = `toast toast-${variant}`;
  element.textContent = message;
  getRegion().appendChild(element);
  if (duration > 0) setTimeout(() => element.remove(), duration);
  return element;
}
