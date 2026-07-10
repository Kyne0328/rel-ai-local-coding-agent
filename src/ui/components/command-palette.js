const RECENT_KEY = 'relai_palette_recent';
const MAX_RECENT = 10;
let _registry = [];
let _backdrop = null;
let _keyHandler = null;
let _previousFocus = null;
let _selectedIndex = 0;
let _resultsElement = null;

export function initCommandPalette(registry) {
  _registry = registry || [];
  if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
  _keyHandler = event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      _backdrop ? closePalette() : openPalette();
    }
    if (event.key === 'Escape' && _backdrop) closePalette();
  };
  document.addEventListener('keydown', _keyHandler);
}

export function registerActions(actions) {
  _registry = [..._registry, ...actions];
}

export function openCommandPalette() {
  if (!_backdrop) openPalette();
}

function currentItems(query) {
  return query ? fuzzyMatch(query, _registry) : [...recentItems(), ..._registry.slice(0, 6)];
}

function renderItem(item, index) {
  const element = document.createElement('div');
  element.className = 'command-option';
  element.setAttribute('role', 'option');
  element.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  element.innerHTML = `
    <div>
      <div class="command-label">${escapeHtml(item.label)}</div>
      ${item.category ? `<div class="command-category">${escapeHtml(item.category)}</div>` : ''}
    </div>`;
  element.addEventListener('mouseenter', () => {
    _selectedIndex = index;
    highlightSelected();
  });
  element.onclick = () => executeItem(item);
  return element;
}

function renderResults(query) {
  const items = currentItems(query);
  _resultsElement.innerHTML = '';
  if (!items.length) {
    _resultsElement.innerHTML = '<div class="command-empty">No results</div>';
    return;
  }
  _selectedIndex = 0;
  items.forEach((item, index) => _resultsElement.appendChild(renderItem(item, index)));
}

function openPalette() {
  closePalette();
  _previousFocus = document.activeElement;

  _backdrop = document.createElement('div');
  _backdrop.className = 'overlay-backdrop command-backdrop';
  _backdrop.addEventListener('click', event => {
    if (event.target === _backdrop) closePalette();
  });

  const panel = document.createElement('div');
  panel.className = 'command-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Command palette');

  const input = document.createElement('input');
  input.className = 'command-input';
  input.type = 'search';
  input.placeholder = 'Type a command or search…';
  input.setAttribute('aria-label', 'Command palette search');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  _resultsElement = document.createElement('div');
  _resultsElement.className = 'command-results';
  _resultsElement.setAttribute('role', 'listbox');

  let searchTimer;
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderResults(input.value), 100);
  });
  input.addEventListener('keydown', handleInputKeydown);

  renderResults('');
  panel.append(input, _resultsElement);
  _backdrop.appendChild(panel);
  document.body.appendChild(_backdrop);
  setTimeout(() => input.focus(), 10);
}

function highlightSelected() {
  Array.from(_resultsElement.children).forEach((element, index) => {
    element.setAttribute('aria-selected', index === _selectedIndex ? 'true' : 'false');
  });
  _resultsElement.children[_selectedIndex]?.scrollIntoView({ block: 'nearest' });
}

function handleInputKeydown(event) {
  const count = _resultsElement.children.length;
  if (!count) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    _selectedIndex = (_selectedIndex + 1) % count;
    highlightSelected();
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    _selectedIndex = (_selectedIndex - 1 + count) % count;
    highlightSelected();
  }
  if (event.key === 'Enter') _resultsElement.children[_selectedIndex]?.click();
}

function closePalette() {
  if (_backdrop) {
    _backdrop.remove();
    _backdrop = null;
    _resultsElement = null;
  }
  if (_previousFocus && typeof _previousFocus.focus === 'function') {
    _previousFocus.focus();
    _previousFocus = null;
  }
}

function executeItem(item) {
  closePalette();
  saveRecent(item);
  if (item.action) item.action();
  else if (item.href) location.hash = item.href;
}

function fuzzyScore(label, query) {
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;
  let queryIndex = 0;
  for (let index = 0; index < label.length && queryIndex < query.length; index += 1) {
    if (label[index] === query[queryIndex]) queryIndex += 1;
  }
  return queryIndex === query.length ? 40 : 0;
}

function fuzzyMatch(query, items) {
  const normalized = query.toLowerCase();
  return items
    .map(item => ({ item, score: fuzzyScore(item.label.toLowerCase(), normalized) }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .map(result => result.item);
}

function recentItems() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch (error) {
    debugError(error);
    return [];
  }
}

function saveRecent(item) {
  if (item.action && !item.href) return;
  const recent = recentItems().filter(entry => entry.label !== item.label);
  recent.unshift({ label: item.label, href: item.href, category: 'Recent' });
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch (error) {
    debugError(error);
  }
}

function debugError(error) {
  if (window.localStorage?.getItem('relai_debug') === '1') console.error(error);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
