let _opener = null;

export function openModal({ title, content, onClose, escDisabled = false } = {}) {
  closeModal();
  _opener = document.activeElement;

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
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop && !escDisabled) finishClose(onClose);
  });

  const focusable = dialog.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
  focusable[0]?.focus();
  backdrop.addEventListener('keydown', event => trapFocus(event, dialog, escDisabled, onClose));
  return { backdrop, dialog, close: () => finishClose(onClose) };
}

function trapFocus(event, dialog, escDisabled, onClose) {
  if (!escDisabled && event.key === 'Escape') {
    finishClose(onClose);
    return;
  }
  if (event.key !== 'Tab') return;
  const elements = Array.from(dialog.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])'));
  if (!elements.length) {
    event.preventDefault();
    return;
  }
  const first = elements[0];
  const last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function finishClose(onClose) {
  closeModal();
  if (onClose) onClose();
}

export function closeModal() {
  document.getElementById('__relai-modal-backdrop')?.remove();
  if (_opener && typeof _opener.focus === 'function') _opener.focus();
  _opener = null;
}
