const UNSAVED_SELECTOR = '[data-unsaved-changes="true"]';
let initialized = false;

export function initInteractionSafety() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

export function markUnsaved(element, dirty) {
  if (!isElement(element)) return;
  element.dataset.unsavedChanges = dirty ? 'true' : 'false';
}

export function hasUnsavedChanges(root = globalThis.document) {
  if (isElement(root) && root.matches(UNSAVED_SELECTOR)) return true;
  return Boolean(root?.querySelector?.(UNSAVED_SELECTOR));
}

export function clearUnsavedChanges(root = globalThis.document) {
  if (isElement(root) && root.matches(UNSAVED_SELECTOR)) root.dataset.unsavedChanges = 'false';
  root?.querySelectorAll?.(UNSAVED_SELECTOR).forEach(element => {
    element.dataset.unsavedChanges = 'false';
  });
}

export function hasActiveOverlay() {
  return Boolean(document.querySelector('#__relai-modal-backdrop, #__relai-drawer-backdrop'));
}

function isElement(value) {
  return typeof globalThis.HTMLElement === 'function' && value instanceof globalThis.HTMLElement;
}
