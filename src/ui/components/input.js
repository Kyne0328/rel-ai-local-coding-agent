// Input factory — text | password (with visibility toggle) | search | number
export function Input({ type = 'text', placeholder = '', value = '', id, name, autocomplete = 'off', onChange, debounce = 0 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'input-wrap';
  wrap.style.cssText = 'position:relative;display:flex;align-items:center;';

  const el = document.createElement('input');
  el.type = type === 'password' ? 'password' : type;
  el.placeholder = placeholder;
  el.value = value;
  el.autocomplete = autocomplete;
  el.spellcheck = false;
  if (id) el.id = id;
  if (name) el.name = name;
  el.style.flex = '1';

  wrap.appendChild(el);

  if (type === 'password') {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-label', 'Show token');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.style.cssText = 'position:absolute;right:8px;font-size:11px;color:var(--text-muted);';
    toggle.onclick = () => {
      const shown = el.type === 'text';
      el.type = shown ? 'password' : 'text';
      toggle.textContent = shown ? 'Show' : 'Hide';
      toggle.setAttribute('aria-pressed', String(!shown));
    };
    wrap.appendChild(toggle);
  }

  if (onChange) {
    if (debounce > 0) {
      let timer;
      el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => onChange(el.value), debounce); });
    } else {
      el.addEventListener('input', () => onChange(el.value));
    }
  }

  wrap.getInput = () => el;
  wrap.getValue = () => el.value;
  wrap.setValue = (v) => { el.value = v; };
  return wrap;
}
