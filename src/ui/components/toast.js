import { iconHtml } from './icons.js';

const TOAST_VARIANTS = Object.freeze({
  info: { symbol: 'i', label: 'Information', role: 'status', duration: 5000 },
  success: { symbol: '✓', label: 'Success', role: 'status', duration: 4000 },
  warn: { symbol: '!', label: 'Warning', role: 'status', duration: 8000 },
  error: { symbol: '×', label: 'Error', role: 'alert', duration: 0 }
});

let _region = null;
const _active = new Map();

function getRegion() {
  if (_region?.isConnected) return _region;
  _region = document.createElement('div');
  _region.className = 'toast-region';
  document.body.appendChild(_region);
  return _region;
}

export function toast(message, { variant = 'info', duration } = {}) {
  const tone = Object.hasOwn(TOAST_VARIANTS, variant) ? variant : 'info';
  const metadata = TOAST_VARIANTS[tone];
  const text = String(message || '');
  const effectiveDuration = Number.isFinite(duration) ? Math.max(0, duration) : metadata.duration;
  const key = `${tone}\u0000${text}`;
  const existing = _active.get(key);
  if (existing?.element?.isConnected) {
    existing.restart(effectiveDuration);
    return existing.element;
  }
  _active.delete(key);

  const element = document.createElement('div');
  element.className = `toast toast-${tone}`;

  const marker = document.createElement('span');
  marker.className = 'toast-marker';
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = metadata.symbol;

  const copy = document.createElement('span');
  copy.className = 'toast-copy';
  copy.textContent = text;
  copy.setAttribute('role', metadata.role);
  copy.setAttribute('aria-atomic', 'true');
  copy.setAttribute('aria-label', `${metadata.label}: ${text}`);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'toast-dismiss';
  dismiss.setAttribute('aria-label', `Dismiss ${metadata.label.toLowerCase()} notification`);
  dismiss.innerHTML = iconHtml('close');

  let timer = null;
  let timerStartedAt = 0;
  let remainingMs = effectiveDuration;
  let paused = false;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    timerStartedAt = 0;
  };
  const remove = () => {
    clearTimer();
    _active.delete(key);
    element.remove();
  };
  const schedule = () => {
    clearTimer();
    if (paused || remainingMs <= 0) return;
    timerStartedAt = Date.now();
    timer = setTimeout(remove, remainingMs);
  };
  const pause = () => {
    if (paused) return;
    paused = true;
    if (timer && timerStartedAt) remainingMs = Math.max(0, remainingMs - (Date.now() - timerStartedAt));
    clearTimer();
  };
  const resume = () => {
    if (!paused) return;
    paused = false;
    schedule();
  };
  const restart = nextDuration => {
    remainingMs = nextDuration;
    if (!paused) schedule();
  };

  dismiss.addEventListener('click', remove, { once: true });
  element.addEventListener('mouseenter', pause);
  element.addEventListener('mouseleave', resume);
  element.addEventListener('focusin', pause);
  element.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (!element.contains(document.activeElement)) resume();
    });
  });

  element.append(marker, copy, dismiss);
  getRegion().appendChild(element);
  _active.set(key, { element, restart });
  schedule();
  return element;
}
