// Command palette — Cmd/Ctrl-K, fuzzy match, recent actions
const RECENT_KEY = 'relai_palette_recent';
const MAX_RECENT = 10;
let _registry = [];
let _backdrop = null;
let _keyHandler = null;
let _previousFocus = null;
let _selectedIndex = 0;
let _resultsEl = null;

export function initCommandPalette(registry) {
  _registry = registry || [];
  if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
  _keyHandler = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      _backdrop ? _close() : _open();
    }
    if (e.key === 'Escape' && _backdrop) _close();
  };
  document.addEventListener('keydown', _keyHandler);
}

export function registerActions(actions) {
  _registry = [..._registry, ...actions];
}

function _getCurrentItems(query) {
  return query ? _fuzzyMatch(query, _registry) : [..._getRecent(), ..._registry.slice(0, 6)];
}

function categoryHtml(item) {
  if (!item.category) return '';
  return `<div style="font-size:11px;color:var(--text-muted);">${esc(item.category)}</div>`;
}

function itemOptionStyle(index) {
  const background = index === 0 ? 'var(--blue-dim)' : 'transparent';
  return `padding:10px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px;background:${background};`;
}

function renderItem(item, index) {
  const el = document.createElement('div');
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  el.style.cssText = itemOptionStyle(index);
  el.innerHTML = `<div><div style="font-weight:600;">${esc(item.label)}</div>${categoryHtml(item)}</div>`;
  el.addEventListener('mouseenter', () => { _selectedIndex = index; _highlightSelected(); });
  el.onclick = () => { _execute(item); };
  return el;
}

function _renderResults(query) {
  const items = _getCurrentItems(query);
  _resultsEl.innerHTML = '';
  if (!items.length) {
    _resultsEl.innerHTML = '<div style="padding:12px 16px;color:var(--text-muted);font-size:13px;">No results</div>';
    return;
  }
  _selectedIndex = 0;
  items.forEach((item, index) => _resultsEl.appendChild(renderItem(item, index)));
}

function _open() {
  _previousFocus = document.activeElement;
  _close();
  _backdrop = document.createElement('div');
  _backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:var(--z-modal,60);display:flex;align-items:flex-start;justify-content:center;padding:80px 24px 24px;';
  _backdrop.addEventListener('click', (e) => { if (e.target === _backdrop) _close(); });

  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Command palette');
  panel.style.cssText = 'background:var(--surface);border:1px solid var(--line-soft);border-radius:14px;width:100%;max-width:560px;box-shadow:0 24px 64px rgba(0,0,0,.5);overflow:hidden;';

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'Type a command or search…';
  input.setAttribute('aria-label', 'Command palette search');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.style.cssText = 'width:100%;border:none;border-radius:0;padding:14px 16px;font-size:15px;background:transparent;border-bottom:1px solid var(--line-soft);outline:none;color:var(--text);';

  _resultsEl = document.createElement('div');
  _resultsEl.setAttribute('role', 'listbox');
  _resultsEl.style.cssText = 'max-height:360px;overflow:auto;';

  let searchTimer;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => _renderResults(input.value), 100);
  });

  input.addEventListener('keydown', _handleInputKeydown);

  _renderResults('');

  panel.appendChild(input);
  panel.appendChild(_resultsEl);
  _backdrop.appendChild(panel);
  document.body.appendChild(_backdrop);
  setTimeout(() => input.focus(), 10);
}

function _highlightSelected() {
  Array.from(_resultsEl.children).forEach((el, i) => {
    el.style.background = i === _selectedIndex ? 'var(--blue-dim)' : 'transparent';
    el.setAttribute('aria-selected', i === _selectedIndex ? 'true' : 'false');
  });
  const selected = _resultsEl.children[_selectedIndex];
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function _handleInputKeydown(e) {
  const count = _resultsEl.children.length;
  if (!count) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); _selectedIndex = (_selectedIndex + 1) % count; _highlightSelected(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); _selectedIndex = (_selectedIndex - 1 + count) % count; _highlightSelected(); }
  if (e.key === 'Enter') {
    const selected = _resultsEl.children[_selectedIndex];
    if (selected) selected.click();
  }
}

function _close() {
  if (_backdrop) { _backdrop.remove(); _backdrop = null; _resultsEl = null; }
  if (_previousFocus && typeof _previousFocus.focus === 'function') {
    _previousFocus.focus();
    _previousFocus = null;
  }
}

function _execute(item) {
  _close();
  _saveRecent(item);
  if (item.action) item.action();
  else if (item.href) location.hash = item.href;
}

function _fuzzyScore(label, query) {
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;
  let qi = 0;
  for (let i = 0; i < label.length && qi < query.length; i++) {
    if (label[i] === query[qi]) qi += 1;
  }
  return qi === query.length ? 40 : 0;
}

function _fuzzyMatch(query, items) {
  const q = query.toLowerCase();
  const scored = items.map(item => ({ item, score: _fuzzyScore(item.label.toLowerCase(), q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map(x => x.item);
}

function _getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch (error) {
    if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
    return [];
  }
}

function _saveRecent(item) {
  if (item.action && !item.href) return; // action functions can't be serialized to localStorage; only nav items appear in recents
  const recent = _getRecent().filter(r => r.label !== item.label);
  recent.unshift({ label: item.label, href: item.href, category: 'Recent' });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch (error) {
    if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
  }
}

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
