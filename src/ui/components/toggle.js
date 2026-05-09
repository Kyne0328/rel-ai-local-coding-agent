export function Toggle({ checked = false, label, onChange, id } = {}) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.setAttribute('aria-checked', String(checked));
  if (id) input.id = id;
  input.addEventListener('change', () => {
    input.setAttribute('aria-checked', String(input.checked));
    if (onChange) onChange(input.checked);
  });
  if (label) { const span = document.createElement('span'); span.textContent = label; wrap.appendChild(input); wrap.appendChild(span); }
  else wrap.appendChild(input);
  wrap.getValue = () => input.checked;
  return wrap;
}
