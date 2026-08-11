const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function activateOverlay({ backdrop, panel, opener, onEscape }) {
  panel.tabIndex = -1;
  const background = hideBackground(backdrop);
  document.body.classList.add('overlay-open');

  const onKeyDown = event => trapOverlayFocus(event, panel, onEscape);
  backdrop.addEventListener('keydown', onKeyDown);
  queueMicrotask(() => focusFirst(panel));

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    backdrop.removeEventListener('keydown', onKeyDown);
    restoreBackground(background);
    document.body.classList.toggle('overlay-open', Boolean(document.querySelector('.overlay-backdrop')));
    restoreFocus(opener);
  };
}

function focusFirst(panel) {
  const first = focusableElements(panel)[0];
  (first || panel).focus({ preventScroll: true });
}

function trapOverlayFocus(event, panel, onEscape) {
  if (event.key === 'Escape' && typeof onEscape === 'function') {
    event.preventDefault();
    onEscape();
    return;
  }
  if (event.key !== 'Tab') return;
  const elements = focusableElements(panel);
  if (!elements.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = elements[0];
  const last = elements.at(-1);
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !panel.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function focusableElements(panel) {
  return Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(element => {
    if (!(element instanceof HTMLElement) || element.hidden) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return element.getClientRects().length > 0;
  });
}

function hideBackground(backdrop) {
  const background = [];
  for (const element of document.body.children) {
    if (!(element instanceof HTMLElement) || element === backdrop || element.tagName === 'SCRIPT') continue;
    background.push({ element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') });
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
  }
  return background;
}

function restoreBackground(background) {
  for (const item of background) {
    item.element.inert = item.inert;
    if (item.ariaHidden == null) item.element.removeAttribute('aria-hidden');
    else item.element.setAttribute('aria-hidden', item.ariaHidden);
  }
}

function restoreFocus(opener) {
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus({ preventScroll: true });
    return;
  }
  document.getElementById('pageTitle')?.focus({ preventScroll: true });
}
