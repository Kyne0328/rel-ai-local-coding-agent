import { openModal, closeModal } from './modal.js';

export function confirmAction({
  title = 'Confirm action',
  message = 'Continue with this action?',
  detail = '',
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  danger = false
} = {}) {
  return new Promise(resolve => {
    let settled = false;
    const content = document.createElement('div');
    content.className = 'confirm-dialog';
    const copy = document.createElement('div');
    copy.className = 'confirm-dialog-copy';
    const messageElement = document.createElement('strong');
    messageElement.textContent = message;
    copy.appendChild(messageElement);
    if (detail) {
      const detailElement = document.createElement('span');
      detailElement.textContent = detail;
      copy.appendChild(detailElement);
    }
    const actions = document.createElement('div');
    actions.className = 'ws-form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary';
    cancel.textContent = cancelLabel;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = danger ? 'danger' : 'primary';
    confirm.textContent = confirmLabel;
    actions.append(cancel, confirm);
    content.append(copy, actions);

    const settle = value => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };
    const modal = openModal({
      title,
      content,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }
    });
    cancel.onclick = () => modal.dismiss();
    confirm.onclick = () => settle(true);
    window.setTimeout(() => (danger ? cancel : confirm).focus(), 0);
  });
}
