const ICONS = Object.freeze({
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>'
});

export function stateIconButton({ pressed = false, label = '', icon = 'play', className = '', onClick } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ['secondary', 'filter-state-toggle', className].filter(Boolean).join(' ');
  setStateIconButton(button, { pressed, label, icon });
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

export function setStateIconButton(button, { pressed = false, label = '', icon = 'play' } = {}) {
  if (!button) return;
  button.setAttribute('aria-pressed', String(Boolean(pressed)));
  button.setAttribute('aria-label', label);
  button.title = label;
  button.classList.toggle('active', Boolean(pressed));
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon] || ICONS.play}</svg>`;
}
