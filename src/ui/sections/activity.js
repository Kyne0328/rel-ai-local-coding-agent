// Activity section — full: toolbar, filters, drawer, pause-live
import { fetchJson } from '/ui/api.js';
import { openDrawer } from '/ui/components/drawer.js';
import { pillHtml } from '/ui/components/pill.js';
import { virtualizeTable } from '/ui/components/table.js';
import { esc, timeAgo } from '/ui/utils.js';

let _allEntries = [];
let _paused = false;
let _filterState = { search: '', timeRange: '1h', workspace: '', tool: '', status: '' };
let _virtualizer = null;
let _mountToken = 0;

export function mountActivity(container) {
  const token = ++_mountToken;
  if (_virtualizer) { _virtualizer.destroy(); }
  _virtualizer = null;
  container.innerHTML = '';
  container.appendChild(_buildActivity());
  _loadLogs(token);
}

export function prependEntry(entry) {
  if (!entry || typeof entry !== 'object') return;
  if (_paused) return;
  const key = _entryKey(entry);
  if (key && _allEntries.some(item => _entryKey(item) === key)) return;
  _allEntries.unshift(entry);
  _allEntries = sortEntries(_allEntries);
  if (_allEntries.length > 1000) {
    _allEntries = _allEntries.slice(0, 1000);
  }
  _renderTable(_applyFilters(_allEntries));
}

function _buildActivity() {
  const root = document.createElement('div');
  root.className = 'section';

  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search tools, messages…';
  searchInput.style.cssText = 'width:200px;min-height:32px;font-size:13px;';
  searchInput.value = _filterState.search || '';
  let searchTimer;
  searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { _filterState.search = searchInput.value; _renderTable(_applyFilters(_allEntries)); }, 200); });

  const timeRangeWrap = document.createElement('div');
  timeRangeWrap.style.cssText = 'display:flex;gap:4px;';
  for (const range of ['15m', '1h', '24h', '7d', 'All']) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.style.cssText = 'min-height:28px;padding:0 10px;font-size:12px;';
    btn.textContent = range;
    if (range.toLowerCase() === _filterState.timeRange) { btn.style.background = 'rgba(78,161,255,.2)'; btn.dataset.active = '1'; }
    btn.onclick = () => {
      timeRangeWrap.querySelectorAll('button').forEach(b => { b.style.background = ''; delete b.dataset.active; });
      btn.style.background = 'rgba(78,161,255,.2)'; btn.dataset.active = '1';
      _filterState.timeRange = range.toLowerCase();
      _renderTable(_applyFilters(_allEntries));
    };
    timeRangeWrap.appendChild(btn);
  }

  // Freezes only this table so new rows do not shift under the user while reading.
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'secondary';
  pauseBtn.style.cssText = 'min-height:28px;padding:0 12px;font-size:12px;margin-left:auto;';
  pauseBtn.textContent = _paused ? 'Resume list' : 'Freeze list';
  pauseBtn.title = 'Freeze this table so new events do not shift rows while you read.';
  if (_paused) pauseBtn.style.background = 'rgba(255,194,75,.15)';
  pauseBtn.onclick = () => {
    _paused = !_paused;
    pauseBtn.textContent = _paused ? 'Resume list' : 'Freeze list';
    pauseBtn.style.background = _paused ? 'rgba(255,194,75,.15)' : '';
  };

  toolbar.appendChild(searchInput);
  toolbar.appendChild(timeRangeWrap);
  toolbar.appendChild(pauseBtn);

  const tableWrap = document.createElement('div');
  tableWrap.id = '__activity-table-wrap';
  tableWrap.className = 'card';
  tableWrap.innerHTML = '<div class="card-head"><h3>Activity</h3><span class="section-action" id="__activity-count">Loading…</span></div><div class="card-body"><div class="table-wrap"><table class="data-table"><caption class="sr-only">Audit activity log</caption><thead><tr><th scope="col">Time</th><th scope="col">Tool</th><th scope="col">Workspace</th><th scope="col">Status</th><th scope="col">Message</th><th scope="col"></th></tr></thead><tbody id="__activity-tbody"></tbody></table></div></div>';

  root.appendChild(toolbar);
  root.appendChild(tableWrap);
  return root;
}

async function _loadLogs(token) {
  const data = await fetchJson('/api/logs?limit=500');
  if (token !== _mountToken) return;
  _allEntries = sortEntries(Array.isArray(data) ? data : (data && Array.isArray(data.entries) ? data.entries : []));
  _renderTable(_applyFilters(_allEntries));
}

function _applyFilters(entries) {
  const now = Date.now();
  const ranges = { '15m': 15 * 60000, '1h': 60 * 60000, '24h': 24 * 60 * 60000, '7d': 7 * 24 * 60 * 60000 };
  const rangeMs = ranges[_filterState.timeRange];

  return sortEntries(entries).filter(x => {
    if (rangeMs) { const ts = Date.parse(String(x.ts || x.at || x.createdAt || '')); if (!Number.isFinite(ts) || now - ts > rangeMs) return false; }
    if (_filterState.search) {
      const q = _filterState.search.toLowerCase();
      const haystack = [x.tool, x.message, x.error, x.path, x.workspace].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (_filterState.workspace && x.workspace !== _filterState.workspace) return false;
    if (_filterState.tool && x.tool !== _filterState.tool) return false;
    if (_filterState.status) {
      const ok = x.ok === false ? 'error' : 'ok';
      if (ok !== _filterState.status) return false;
    }
    return true;
  });
}

function _renderTable(entries) {
  const tbody = document.getElementById('__activity-tbody');
  const countEl = document.getElementById('__activity-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = entries.length + ' events';

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty">Activity will appear here when ChatGPT calls a Rel.AI tool.</div></td></tr>`;
    if (_virtualizer) { _virtualizer.destroy(); }
    _virtualizer = null;
    return;
  }

  if (_virtualizer) {
    _virtualizer.reinit(entries);
  } else {
    _virtualizer = virtualizeTable(tbody, entries, (x) => {
      const ok = x.ok === false ? 'error' : 'ok';
      const msg = x.error || x.message || x.path || '';
      const row = document.createElement('tr');
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <td class="nowrap" style="font-size:12px;">${esc(timeAgo(x.ts || x.at || x.createdAt))}</td>
        <td class="truncate mono" style="max-width:180px;">${esc(x.tool || x.type || 'activity')}</td>
        <td class="truncate" style="max-width:120px;">${esc(x.workspace || '—')}</td>
        <td>${pillHtml(ok)}</td>
        <td class="truncate" style="max-width:240px;">${esc(msg)}</td>
        <td><button class="secondary" style="min-height:24px;padding:0 8px;font-size:11px;">▸</button></td>
      `;
      row.onclick = () => _openDetail(x);
      return row;
    });
  }
}

function _openDetail(entry) {
  if (!entry) return;
  const content = document.createElement('div');
  content.style.cssText = 'display:grid;gap:12px;font-size:13px;';
  const fields = [
    ['Tool', entry.tool || entry.type || 'activity'],
    ['Workspace', entry.workspace || '—'],
    ['Status', entry.ok === false ? 'error' : 'ok'],
    ['Time', new Date(entry.ts || entry.at || entry.createdAt || '').toLocaleString()],
    // Tool-call audit entries carry no sessionId, so the row was almost always
    // an empty "—". Only show it when a session id is actually present.
    ...(entry.sessionId ? [['Session', entry.sessionId]] : []),
  ];
  for (const [k, v] of fields) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';
    row.innerHTML = `<span style="color:var(--text-muted);min-width:80px;">${esc(k)}</span><span>${esc(v)}</span>`;
    content.appendChild(row);
  }
  if (entry.error || entry.message) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:10px;font-size:12px;overflow:auto;white-space:pre-wrap;';
    pre.textContent = entry.error || entry.message;
    content.appendChild(pre);
  }
  if (entry.args) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:10px;font-size:12px;overflow:auto;';
    pre.textContent = JSON.stringify(entry.args, null, 2);
    content.appendChild(pre);
  }
  openDrawer({ title: entry.tool || 'Activity detail', content });
}

function sortEntries(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((a, b) => Date.parse(b.ts || b.at || b.createdAt || 0) - Date.parse(a.ts || a.at || a.createdAt || 0));
}

function _entryKey(entry) { if (!entry) return ''; return entry.id || [entry.ts || entry.at || entry.createdAt || '', entry.tool || entry.type || '', entry.workspace || '', entry.message || entry.error || entry.path || ''].join('|'); }
