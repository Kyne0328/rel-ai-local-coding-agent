let _drawerOpener = null;

export function openDrawer({ title, content, onClose } = {}) {
  closeDrawer();
  _drawerOpener = document.activeElement;

  const backdrop = document.createElement('div');
  backdrop.id = '__relai-drawer-backdrop';
  backdrop.className = 'overlay-backdrop drawer-backdrop';

  const panel = document.createElement('div');
  panel.className = 'drawer-panel';
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
  closeButton.textContent = 'Close';
  closeButton.onclick = () => finishClose(onClose);
  head.append(titleElement, closeButton);
  panel.appendChild(head);

  if (typeof content === 'string') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;
    panel.appendChild(wrapper);
  } else if (content instanceof Node) {
    panel.appendChild(content);
  }

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  closeButton.focus();
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) finishClose(onClose);
  });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') finishClose(onClose);
  });
  return { panel, close: () => finishClose(onClose) };
}

function finishClose(onClose) {
  closeDrawer();
  if (onClose) onClose();
}

export function closeDrawer() {
  document.getElementById('__relai-drawer-backdrop')?.remove();
  if (_drawerOpener && typeof _drawerOpener.focus === 'function') _drawerOpener.focus();
  _drawerOpener = null;
}
