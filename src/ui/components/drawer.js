// Right-side detail drawer with focus-trap and Esc-close
let _drawerOpener = null;

export function openDrawer({ title, content, onClose } = {}) {
  closeDrawer();
  _drawerOpener = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.id = '__relai-drawer-backdrop';
  backdrop.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:var(--z-overlay,50);
  `;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { closeDrawer(); if (onClose) onClose(); } });

  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', '__relai-drawer-title');
  panel.style.cssText = `
    position:fixed;top:0;right:0;bottom:0;width:min(480px,95vw);
    background:var(--surface,#ffffff);border-left:1px solid var(--line-soft);
    padding:24px;overflow:auto;box-shadow:-8px 0 32px rgba(0,0,0,.4);
    display:flex;flex-direction:column;gap:16px;
  `;

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
  const titleEl = document.createElement('h2');
  titleEl.id = '__relai-drawer-title';
  titleEl.style.cssText = 'margin:0;font-size:15px;';
  titleEl.textContent = title || '';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'secondary';
  closeBtn.style.cssText = 'min-height:28px;padding:0 10px;font-size:12px;';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => { closeDrawer(); if (onClose) onClose(); };
  head.appendChild(titleEl);
  head.appendChild(closeBtn);
  panel.appendChild(head);

  if (typeof content === 'string') { const d = document.createElement('div'); d.innerHTML = content; panel.appendChild(d); }
  else if (content instanceof Node) panel.appendChild(content);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  closeBtn.focus();

  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDrawer(); if (onClose) onClose(); }
  });

  return { panel, close: () => { closeDrawer(); if (onClose) onClose(); } };
}

export function closeDrawer() {
  const el = document.getElementById('__relai-drawer-backdrop');
  if (el) el.remove();
  if (_drawerOpener && typeof _drawerOpener.focus === 'function') _drawerOpener.focus();
  _drawerOpener = null;
}
