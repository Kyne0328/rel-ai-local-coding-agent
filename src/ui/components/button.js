// Button factory — primary | secondary | danger | ghost; sm | md | lg; loading state
export function Button({ variant = 'primary', size = 'md', label = '', onClick, loading = false, type = 'button' } = {}) {
  const el = document.createElement('button');
  el.type = type;
  el.className = `btn btn-${variant} btn-${size}`;

  // Use existing class names from components.css where possible
  if (variant === 'secondary') el.classList.add('secondary');
  if (variant === 'danger') el.classList.add('danger');

  _update(el, { label, loading, onClick });
  return el;
}

export function updateButton(el, { label, loading, onClick } = {}) {
  _update(el, { label, loading, onClick });
}

function _update(el, { label, loading, onClick }) {
  if (loading !== undefined) {
    el.disabled = loading;
    el.setAttribute('aria-busy', String(loading));
  }
  if (label !== undefined) el.textContent = loading ? '…' : label;
  if (onClick !== undefined) el.onclick = onClick;
}
