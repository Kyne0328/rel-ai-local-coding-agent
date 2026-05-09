// Accessible tablist with roving tabindex
export function TabList(tabs, onSelect) {
  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'tablist');
  wrap.style.cssText = 'display:flex;gap:4px;border-bottom:1px solid var(--line-soft);padding-bottom:1px;';

  const buttons = tabs.map((tab, i) => {
    const btn = document.createElement('button');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('tabindex', i === 0 ? '0' : '-1');
    btn.style.cssText = 'border-radius:8px 8px 0 0;border-bottom:2px solid transparent;padding:8px 14px;font-size:13px;';
    btn.textContent = tab.label || tab;
    btn.dataset.tabId = tab.id || String(i);
    btn.onclick = () => select(i);
    wrap.appendChild(btn);
    return btn;
  });

  wrap.addEventListener('keydown', (e) => {
    const cur = buttons.findIndex(b => b === document.activeElement);
    if (cur < 0) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); const next = (cur + 1) % buttons.length; select(next); buttons[next].focus(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); const prev = (cur - 1 + buttons.length) % buttons.length; select(prev); buttons[prev].focus(); }
  });

  function select(i) {
    buttons.forEach((b, j) => { b.setAttribute('aria-selected', j === i ? 'true' : 'false'); b.setAttribute('tabindex', j === i ? '0' : '-1'); });
    if (onSelect) onSelect(tabs[i].id || String(i), i);
  }

  return wrap;
}
