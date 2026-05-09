// Keyed DOM patcher — replaces full innerHTML rebuilds
// mount(parent, items, keyFn, renderFn) → only swaps changed children
export function mount(parent, items, keyFn, renderFn) {
  if (!parent) return;
  const existing = new Map();
  for (const child of Array.from(parent.children)) {
    const k = child.dataset.key;
    if (k != null) existing.set(k, child);
  }

  const fragment = document.createDocumentFragment();

  for (const item of items) {
    const key = String(keyFn(item));
    let el = existing.get(key);
    if (!el) {
      el = renderFn(item);
      if (el) el.dataset.key = key;
    } else {
      const fresh = renderFn(item);
      if (fresh && el.outerHTML !== fresh.outerHTML) {
        fresh.dataset.key = key;
        el = fresh;
      }
    }
    if (el) fragment.appendChild(el);
  }

  // Clear any stale nodes (not moved to fragment), then append
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  parent.appendChild(fragment);
}
