export function EmptyState({ icon = '□', title, body, description, cta, onCta } = {}) {
  const el = document.createElement('div');
  el.className = 'empty empty-state';

  const iconEl = document.createElement('div');
  iconEl.className = 'empty-state-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const titleEl = document.createElement('div');
  titleEl.className = 'empty-state-title';
  titleEl.textContent = title || '';

  const bodyEl = document.createElement('div');
  bodyEl.className = 'empty-state-copy';
  bodyEl.textContent = body || description || '';

  el.append(iconEl, titleEl, bodyEl);
  if (cta && onCta) {
    const button = document.createElement('button');
    button.className = 'secondary empty-state-action';
    button.type = 'button';
    button.textContent = cta;
    button.onclick = onCta;
    el.appendChild(button);
  }
  return el;
}
