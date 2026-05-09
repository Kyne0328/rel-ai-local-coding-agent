// Modal — role=dialog, focus-trap, Esc-close, restore-focus
let _opener = null;

export function openModal({ title, content, onClose, escDisabled = false } = {}) {
  closeModal();
  _opener = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.id = '__relai-modal-backdrop';
  backdrop.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.65);
    display:flex;align-items:center;justify-content:center;
    z-index:var(--z-modal,60);padding:24px;
  `;

  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', '__relai-modal-title');
  dialog.style.cssText = `
    background:var(--surface,#ffffff);border:1px solid var(--line-soft);
    border-radius:16px;padding:24px;max-width:520px;width:100%;
    box-shadow:0 24px 64px rgba(0,0,0,.5);
  `;

  const titleEl = document.createElement('h2');
  titleEl.id = '__relai-modal-title';
  titleEl.style.cssText = 'margin:0 0 16px;font-size:16px;';
  titleEl.textContent = title || '';
  dialog.appendChild(titleEl);

  if (typeof content === 'string') {
    const div = document.createElement('div');
    div.innerHTML = content;
    dialog.appendChild(div);
  } else if (content instanceof Node) {
    dialog.appendChild(content);
  }

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  // Focus first focusable
  const focusable = dialog.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
  if (focusable[0]) focusable[0].focus();

  // Focus trap
  backdrop.addEventListener('keydown', (e) => {
    if (!escDisabled && e.key === 'Escape') { closeModal(); if (onClose) onClose(); return; }
    if (e.key !== 'Tab') return;
    const els = Array.from(dialog.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])'));
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  return { backdrop, dialog, close: () => { closeModal(); if (onClose) onClose(); } };
}

export function closeModal() {
  const el = document.getElementById('__relai-modal-backdrop');
  if (el) el.remove();
  if (_opener && typeof _opener.focus === 'function') _opener.focus();
  _opener = null;
}
