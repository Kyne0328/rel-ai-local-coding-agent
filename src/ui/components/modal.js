import { activateOverlay } from './overlay-focus.js';
import { hasUnsavedChanges } from '../interaction-safety.js';
import { iconHtml } from './icons.js';

const MODAL_SIZES = new Set(['compact', 'standard', 'wide']);
let _state = null;
let _confirmationSequence = 0;

export function openModal({
  title,
  content,
  onClose,
  escDisabled = false,
  showClose = true,
  size = 'standard'
} = {}) {
  if (content != null && !(content instanceof Node)) throw new TypeError('Modal content must be a DOM Node.');
  closeModal();

  const opener = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.id = '__relai-modal-backdrop';
  backdrop.className = 'overlay-backdrop modal-backdrop';

  const dialog = document.createElement('div');
  dialog.className = `modal-panel modal-${MODAL_SIZES.has(size) ? size : 'standard'}`;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', '__relai-modal-title');

  const header = document.createElement('header');
  header.className = 'modal-head';
  const titleElement = document.createElement('h2');
  titleElement.id = '__relai-modal-title';
  titleElement.className = 'modal-title';
  titleElement.textContent = title || '';
  header.appendChild(titleElement);

  let closeButton = null;
  if (showClose) {
    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal-close';
    closeButton.setAttribute('aria-label', title ? `Close ${title}` : 'Close dialog');
    closeButton.innerHTML = iconHtml('close');
    header.appendChild(closeButton);
  }

  const body = document.createElement('div');
  body.className = 'modal-body';
  if (content instanceof Node) body.appendChild(content);
  dialog.append(header, body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const state = {
    backdrop,
    body,
    cleanup: null,
    closeButton,
    dialog,
    dismissEnabled: !escDisabled,
    header,
    inlineSettle: null,
    onClose: typeof onClose === 'function' ? onClose : null,
    opener
  };
  _state = state;

  const finish = () => finishClose(state);
  const dismiss = async () => {
    if (_state !== state || !state.dismissEnabled || state.inlineSettle) return false;
    if (hasUnsavedChanges(dialog)) {
      const confirmed = await showModalConfirmation({
        title: 'Discard changes?',
        message: 'Discard the unsaved changes in this dialog?',
        detail: 'Your changes will not be saved.',
        confirmLabel: 'Discard changes',
        danger: true
      });
      if (!confirmed) return false;
    }
    finishClose(state);
    return true;
  };
  const setDismissEnabled = enabled => {
    state.dismissEnabled = enabled === true;
    if (state.closeButton) state.closeButton.hidden = !state.dismissEnabled;
  };

  closeButton?.addEventListener('click', () => { void dismiss(); });
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop && state.dismissEnabled && !state.inlineSettle) void dismiss();
  });
  state.cleanup = activateOverlay({
    backdrop,
    panel: dialog,
    opener,
    onEscape: () => {
      if (_state !== state) return;
      if (state.inlineSettle) {
        state.inlineSettle(false);
        return;
      }
      if (state.dismissEnabled) void dismiss();
    }
  });
  setDismissEnabled(!escDisabled);
  return { backdrop, body, dialog, close: finish, dismiss, setDismissEnabled, titleElement };
}

export function hasOpenModal() {
  return Boolean(_state?.dialog?.isConnected);
}

export function showModalConfirmation({
  title = 'Confirm action',
  message = 'Continue with this action?',
  detail = '',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false
} = {}) {
  const state = _state;
  if (!state?.dialog?.isConnected || state.inlineSettle) return Promise.resolve(false);

  return new Promise(resolve => {
    const opener = document.activeElement;
    const id = `__relai-modal-confirm-${++_confirmationSequence}`;
    const layer = document.createElement('div');
    layer.className = 'modal-inline-confirm-layer';
    const card = document.createElement('section');
    card.className = 'modal-inline-confirm-card';
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', `${id}-title`);
    card.setAttribute('aria-describedby', `${id}-message`);

    const heading = document.createElement('h3');
    heading.id = `${id}-title`;
    heading.className = 'modal-inline-confirm-title';
    heading.textContent = title;
    const copy = document.createElement('div');
    copy.className = 'confirm-dialog-copy';
    const messageElement = document.createElement('strong');
    messageElement.id = `${id}-message`;
    messageElement.textContent = message;
    copy.appendChild(messageElement);
    if (detail) {
      const detailElement = document.createElement('span');
      detailElement.textContent = detail;
      copy.appendChild(detailElement);
    }
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = cancelLabel;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = danger ? 'danger' : 'primary';
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);
    card.append(heading, copy, actions);
    layer.appendChild(card);

    const previousHeaderInert = state.header.inert;
    const previousBodyInert = state.body.inert;
    state.header.inert = true;
    state.body.inert = true;
    state.dialog.appendChild(layer);

    let settled = false;
    const settle = (value, { restoreFocus = true } = {}) => {
      if (settled) return;
      settled = true;
      state.inlineSettle = null;
      state.header.inert = previousHeaderInert;
      state.body.inert = previousBodyInert;
      layer.remove();
      if (restoreFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
      resolve(value);
    };
    state.inlineSettle = (value, options) => settle(value, options);
    cancel.addEventListener('click', () => settle(false));
    confirm.addEventListener('click', () => settle(true));
    queueMicrotask(() => (danger ? cancel : confirm).focus({ preventScroll: true }));
  });
}

function finishClose(state) {
  if (_state !== state) return;
  closeModal();
}

export function closeModal() {
  const state = _state;
  if (!state) return;
  _state = null;
  state.inlineSettle?.(false, { restoreFocus: false });
  state.backdrop.remove();
  state.cleanup?.();
  state.onClose?.();
}
