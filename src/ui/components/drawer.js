import { activateOverlay } from './overlay-focus.js';

let _drawerOpener = null;
let _drawerCleanup = null;

export function openDrawer({ title, content, onClose, panelClass = '' } = {}) {
  if (content != null && !(content instanceof Node)) throw new TypeError('Drawer content must be a DOM Node.');
  closeDrawer();
  _drawerOpener = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.id = '__relai-drawer-backdrop';
  backdrop.className = 'overlay-backdrop drawer-backdrop';

  const panel = document.createElement('div');
  panel.className = ['drawer-panel', panelClass].filter(Boolean).join(' ');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', '__relai-drawer-title');

  const head = document.createElement('div');
  head.className = 'drawer-head';
  const titleElement = document.createElement('h2');
  titleElement.id = '__relai-drawer-title';
  titleElement.className = 'drawer-title';
  titleElement.textContent = title || '';
  const closeButton = document.createElement('button');
  closeButton.className = 'secondary compact-button';
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  const finish = () => finishClose(onClose);
  closeButton.onclick = finish;
  head.append(titleElement, closeButton);

  const body = document.createElement('div');
  body.className = 'drawer-body';
  if (content instanceof Node) body.appendChild(content);

  panel.append(head, body);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) finish();
  });
  _drawerCleanup = activateOverlay({ backdrop, panel, opener: _drawerOpener, onEscape: finish });
  return { panel, close: finish };
}

function finishClose(onClose) {
  closeDrawer();
  if (onClose) onClose();
}

export function closeDrawer() {
  document.getElementById('__relai-drawer-backdrop')?.remove();
  _drawerCleanup?.();
  _drawerCleanup = null;
  _drawerOpener = null;
}
