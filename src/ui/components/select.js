export function Select({ options = [], value, onChange, id } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'select-control';
  const el = document.createElement('select');
  if (id) el.id = id;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value != null ? opt.value : opt;
    o.textContent = opt.label != null ? opt.label : opt;
    if (opt.value === value || opt === value) o.selected = true;
    el.appendChild(o);
  }
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  wrap.appendChild(el);
  wrap.getValue = () => el.value;
  wrap.setValue = (v) => { el.value = v; };
  return wrap;
}
