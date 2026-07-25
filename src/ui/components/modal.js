import { activateOverlay } from './overlay-focus.js';
import { confirmOverlayDismiss } from '../interaction-safety.js';

let _opener = null;
let _cleanup = null;
let _onClose = null;

export function openModal({ title, content, onClose, escDisabled = false } = {}) {
  closeModal();
  _opener = document.activeElement;
  _onClose = typeof onClose === 'function' ? onClose : null;

  const backdrop = document.createElement('div');
  backdrop.id = '__relai-modal-backdrop';
  backdrop.className = 'overlay-backdrop modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'modal-panel';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', '__relai-modal-title');

  const titleElement = document.createElement('h2');
  titleElement.id = '__relai-modal-title';
  titleElement.className = 'modal-title';
  titleElement.textContent = title || '';
  dialog.appendChild(titleElement);

  if (typeof content === 'string') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;
    dialog.appendChild(wrapper);
  } else if (content instanceof Node) {
    dialog.appendChild(content);
  }

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  const finish = () => finishClose();
  const dismiss = () => {
    if (!confirmOverlayDismiss(dialog)) return false;
    finishClose();
    return true;
  };
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop && !escDisabled) dismiss();
  });
  _cleanup = activateOverlay({
    backdrop,
    panel: dialog,
    opener: _opener,
    onEscape: escDisabled ? null : dismiss
  });
  return { backdrop, dialog, close: finish, dismiss };
}

function finishClose() {
  closeModal();
}

export function closeModal() {
  const onClose = _onClose;
  _onClose = null;
  document.getElementById('__relai-modal-backdrop')?.remove();
  _cleanup?.();
  _cleanup = null;
  _opener = null;
  onClose?.();
}
