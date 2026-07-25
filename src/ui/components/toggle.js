export function Toggle({ checked = false, label, onChange, id } = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'toggle-control';

  const input = document.createElement('input');
  input.className = 'toggle-input';
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.setAttribute('aria-checked', String(checked));
  if (id) input.id = id;
  input.addEventListener('change', () => {
    input.setAttribute('aria-checked', String(input.checked));
    if (onChange) onChange(input.checked);
  });

  wrap.appendChild(input);
  if (label) {
    const span = document.createElement('span');
    span.className = 'toggle-label';
    span.textContent = label;
    wrap.appendChild(span);
  }

  wrap.getValue = () => input.checked;
  return wrap;
}
