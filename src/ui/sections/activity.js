import { fetchJson } from '../api.js';
import { openDrawer } from '../components/drawer.js';
import { pillHtml } from '../components/pill.js';
import { toast } from '../components/toast.js';
import { virtualizeTable } from '../components/table.js';
import { esc, timeAgo } from '../utils.js';
import { getRouteParams, getWorkspaceFilter, setWorkspaceFilter } from '../router.js';
import { activityEventId } from '../activity-event.js';
import { copyText } from '../clipboard.js';

let _allEntries = [];
let _paused = false;
let _filterState = { search: '', timeRange: '1h', workspace: '', tool: '', status: '', task: '' };
let _virtualizer = null;
let _mountToken = 0;
let _requestedEventId = '';
let _requestedEventRoute = '';
let _openedRequestedEvent = false;

export function mountActivity(container) {
  const token = ++_mountToken;
  const params = getRouteParams();
  _filterState.workspace = getWorkspaceFilter();
  _filterState.task = params.get('task') || '';
  _filterState.tool = params.get('tool') || '';
  _filterState.search = params.get('search') || '';
  _requestedEventId = params.get('event') || '';
  const requestedEventRoute = _requestedEventId ? `${_filterState.task}|${_requestedEventId}` : '';
  if (requestedEventRoute !== _requestedEventRoute) {
    _requestedEventRoute = requestedEventRoute;
    _openedRequestedEvent = false;
  }
  const requestedRange = String(params.get('time') || '').toLowerCase();
  if (['15m', '1h', '24h', '7d', 'all'].includes(requestedRange)) _filterState.timeRange = requestedRange;
  _virtualizer?.destroy();
  _virtualizer = null;
  container.innerHTML = '';
  container.appendChild(buildActivity());
  loadLogs(token);
}

export function mergeEntries(entries) {
  if (_paused || !Array.isArray(entries) || entries.length === 0) return;
  const byKey = new Map(_allEntries.map(entry => [entryKey(entry), entry]));
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    byKey.set(entryKey(entry), entry);
  }
  _allEntries = sortEntries([...byKey.values()]).slice(0, 1000);
  updateFilterOptions();
  renderFilteredTable();
  maybeOpenRequestedEvent();
}

export function prependEntry(entry) {
  mergeEntries(entry ? [entry] : []);
}

function buildActivity() {
  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = '<div class="section-head"><div><h2>Activity log</h2><p>Inspect individual Rel.AI tool events. Use Tasks for grouped ChatGPT work.</p></div></div>';

  const toolbar = document.createElement('div');
  toolbar.className = 'activity-toolbar';

  const searchInput = document.createElement('input');
  searchInput.className = 'activity-search';
  searchInput.type = 'search';
  searchInput.placeholder = 'Search tool, workspace, path, or message';
  searchInput.setAttribute('aria-label', 'Search activity');
  searchInput.value = _filterState.search || '';
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      _filterState.search = searchInput.value;
      renderFilteredTable();
    }, 160);
  });

  const timeRange = document.createElement('div');
  timeRange.className = 'segment-group';
  timeRange.setAttribute('aria-label', 'Activity time range');
  for (const range of ['15m', '1h', '24h', '7d', 'All']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `secondary segment-button${range.toLowerCase() === _filterState.timeRange ? ' active' : ''}`;
    button.textContent = range;
    button.onclick = () => {
      timeRange.querySelectorAll('button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      _filterState.timeRange = range.toLowerCase();
      renderFilteredTable();
    };
    timeRange.appendChild(button);
  }

  const workspaceFilter = createFilterSelect('activityWorkspaceFilter', 'All workspaces', value => {
    _filterState.workspace = value;
    setWorkspaceFilter(value);
    renderFilteredTable();
  });
  const toolFilter = createFilterSelect('activityToolFilter', 'All tools', value => {
    _filterState.tool = value;
    renderFilteredTable();
  });
  const statusFilter = createFilterSelect('activityStatusFilter', 'All statuses', value => {
    _filterState.status = value;
    renderFilteredTable();
  });
  statusFilter.append(new Option('Successful', 'ok'), new Option('Failed', 'error'));
  statusFilter.value = _filterState.status;

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.id = '__activity-clear-filters';
  clearButton.className = 'secondary activity-clear-filters';
  clearButton.textContent = 'Clear filters';
  clearButton.hidden = !hasActiveFilters();
  clearButton.onclick = () => {
    _filterState = { search: '', timeRange: '1h', workspace: '', tool: '', status: '', task: '' };
    setWorkspaceFilter('');
    searchInput.value = '';
    workspaceFilter.value = '';
    toolFilter.value = '';
    statusFilter.value = '';
    timeRange.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.textContent === '1h'));
    renderFilteredTable();
  };

  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.className = `secondary activity-freeze${_paused ? ' active' : ''}`;
  pauseButton.textContent = _paused ? 'Resume live list' : 'Freeze live list';
  pauseButton.title = 'Freeze the table so new events do not shift rows while you read.';
  pauseButton.onclick = () => {
    _paused = !_paused;
    pauseButton.textContent = _paused ? 'Resume live list' : 'Freeze live list';
    pauseButton.classList.toggle('active', _paused);
    toast(_paused ? 'Live activity is frozen.' : 'Live activity resumed.', { variant: _paused ? 'warn' : 'success', duration: 1800 });
  };

  const summary = document.createElement('div');
  summary.id = '__activity-filter-summary';
  summary.className = 'activity-filter-summary';
  toolbar.append(searchInput, timeRange, workspaceFilter, toolFilter, statusFilter, clearButton, pauseButton, summary);

  const tableCard = document.createElement('div');
  tableCard.id = '__activity-table-wrap';
  tableCard.className = 'card';
  tableCard.innerHTML = '<div class="card-head"><h3>Event log</h3><span class="section-action" id="__activity-count">Loading…</span></div><div class="card-body"><div class="table-wrap"><table class="data-table"><caption class="sr-only">Audit activity log</caption><thead><tr><th scope="col">Time</th><th scope="col">Tool</th><th scope="col">Workspace</th><th scope="col">Status</th><th scope="col">Message</th><th scope="col"></th></tr></thead><tbody id="__activity-tbody"></tbody></table></div></div>';
  root.append(toolbar, tableCard);
  return root;
}

function createFilterSelect(id, allLabel, onChange) {
  const select = document.createElement('select');
  select.id = id;
  select.className = 'activity-filter-select';
  select.setAttribute('aria-label', allLabel);
  select.appendChild(new Option(allLabel, ''));
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

async function loadLogs(token) {
  const data = await fetchJson('/api/logs?limit=500');
  if (token !== _mountToken) return;
  const fallbackEntries = data && Array.isArray(data.entries) ? data.entries : [];
  _allEntries = sortEntries(Array.isArray(data) ? data : fallbackEntries);
  updateFilterOptions();
  renderFilteredTable();
  maybeOpenRequestedEvent();
}

function updateFilterOptions() {
  replaceDynamicOptions('activityWorkspaceFilter', uniqueValues(_allEntries, entry => entry.workspace), 'All workspaces', _filterState.workspace);
  replaceDynamicOptions('activityToolFilter', uniqueValues(_allEntries, entry => entry.tool || entry.type), 'All tools', _filterState.tool);
}

function uniqueValues(entries, selector) {
  return [...new Set(entries.map(selector).filter(Boolean).map(String))].sort((left, right) => left.localeCompare(right));
}

function replaceDynamicOptions(id, values, allLabel, selected) {
  const select = document.getElementById(id);
  if (!select) return;
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  select.innerHTML = '';
  select.appendChild(new Option(allLabel, ''));
  for (const value of options) select.appendChild(new Option(value, value));
  select.value = selected || '';
}

function renderFilteredTable() {
  const filtered = applyFilters(_allEntries);
  renderTable(filtered);
  const clearButton = document.getElementById('__activity-clear-filters');
  if (clearButton) clearButton.hidden = !hasActiveFilters();
  const summary = document.getElementById('__activity-filter-summary');
  if (!summary) return;
  const active = [
    _filterState.search && `search “${_filterState.search}”`,
    _filterState.workspace && `workspace ${_filterState.workspace}`,
    _filterState.tool && `tool ${_filterState.tool}`,
    _filterState.status && (_filterState.status === 'ok' ? 'successful only' : 'failed only'),
    _filterState.task && `task ${_filterState.task.slice(0, 8)}`
  ].filter(Boolean);
  summary.textContent = active.length
    ? `Showing ${filtered.length} of ${_allEntries.length} events · ${active.join(' · ')}`
    : `Showing ${filtered.length} events from the selected time range.`;
}

function hasActiveFilters() {
  return Boolean(
    _filterState.search ||
    _filterState.workspace ||
    _filterState.tool ||
    _filterState.status ||
    _filterState.task ||
    _filterState.timeRange !== '1h'
  );
}

function applyFilters(entries) {
  const now = Date.now();
  const ranges = { '15m': 15 * 60000, '1h': 60 * 60000, '24h': 24 * 60 * 60000, '7d': 7 * 24 * 60 * 60000 };
  const rangeMs = ranges[_filterState.timeRange];
  return sortEntries(entries).filter(entry => {
    if (rangeMs) {
      const timestamp = Date.parse(String(entry.ts || entry.at || entry.createdAt || ''));
      if (!Number.isFinite(timestamp) || now - timestamp > rangeMs) return false;
    }
    if (_filterState.search) {
      const query = _filterState.search.toLowerCase();
      const haystack = [entry.tool, entry.type, entry.message, entry.error, entry.path, entry.workspace, JSON.stringify(entry.args || '')]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (_filterState.workspace && entry.workspace !== _filterState.workspace) return false;
    if (_filterState.tool && (entry.tool || entry.type) !== _filterState.tool) return false;
    if (_filterState.status && (entry.ok === false ? 'error' : 'ok') !== _filterState.status) return false;
    if (_filterState.task && entry.taskId !== _filterState.task) return false;
    return true;
  });
}

function renderTable(entries) {
  const body = document.getElementById('__activity-tbody');
  const count = document.getElementById('__activity-count');
  if (!body) return;
  if (count) count.textContent = `${entries.length} event${entries.length === 1 ? '' : 's'}`;
  if (!entries.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty">No activity matches these filters.</div></td></tr>';
    _virtualizer?.destroy();
    _virtualizer = null;
    return;
  }
  if (_virtualizer) {
    _virtualizer.reinit(entries);
    return;
  }
  _virtualizer = virtualizeTable(body, entries, entry => {
    const status = entry.ok === false ? 'error' : 'ok';
    const message = entry.error || entry.message || entry.path || '';
    const row = document.createElement('tr');
    row.className = 'clickable-row';
    if (_requestedEventId && activityEventId(entry) === _requestedEventId) row.classList.add('activity-requested-row');
    row.tabIndex = 0;
    row.setAttribute('aria-label', `Open ${entry.tool || entry.type || 'activity'} event details`);
    row.innerHTML = `
      <td class="nowrap small">${esc(timeAgo(entry.ts || entry.at || entry.createdAt))}</td>
      <td class="truncate mono">${esc(entry.tool || entry.type || 'activity')}</td>
      <td class="truncate">${esc(entry.workspace || '—')}</td>
      <td>${pillHtml(status)}</td>
      <td class="truncate">${esc(message)}</td>
      <td><button class="secondary activity-row-button" type="button" aria-label="Open activity detail">›</button></td>`;
    row.onclick = () => openDetail(entry);
    row.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(entry);
      }
    };
    return row;
  });
}

function maybeOpenRequestedEvent() {
  if (!_requestedEventId || _openedRequestedEvent) return;
  const entry = _allEntries.find(item => activityEventId(item) === _requestedEventId);
  if (!entry) return;
  _openedRequestedEvent = true;
  openDetail(entry);
}

function openDetail(entry) {
  if (!entry) return;
  const content = document.createElement('div');
  content.className = 'detail-stack';

  const head = document.createElement('div');
  head.className = 'activity-detail-head';
  head.innerHTML = `<div>${pillHtml(entry.ok === false ? 'error' : 'ok')}</div><span class="muted">${esc(new Date(entry.ts || entry.at || entry.createdAt || '').toLocaleString())}</span>`;
  content.appendChild(head);

  const fields = [
    ['Tool', entry.tool || entry.type || 'activity'],
    ['Workspace', entry.workspace || '—'],
    ...(entry.path ? [['Path', entry.path]] : []),
    ...(entry.sessionId ? [['Session', entry.sessionId]] : []),
    ...(entry.taskId ? [['Task', entry.taskId]] : []),
  ];
  const fieldGroup = document.createElement('div');
  fieldGroup.className = 'activity-detail-section';
  fieldGroup.innerHTML = '<h3>Event</h3>';
  for (const [label, value] of fields) {
    const row = document.createElement('div');
    row.className = 'detail-field';
    row.innerHTML = `<span class="detail-field-label">${esc(label)}</span><span>${esc(value)}</span>`;
    fieldGroup.appendChild(row);
  }
  content.appendChild(fieldGroup);

  appendDetailSection(content, entry.error ? 'Error' : 'Message', entry.error || entry.message);
  appendDetailSection(content, 'Arguments', entry.args);
  appendDetailSection(content, 'Result', entry.result || entry.output || entry.summary);

  const actions = document.createElement('div');
  actions.className = 'activity-detail-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'secondary';
  copyButton.textContent = 'Copy event JSON';
  copyButton.onclick = async () => {
    try {
      await copyText(JSON.stringify(entry, null, 2));
      copyButton.dataset.state = 'success';
      copyButton.textContent = 'Copied';
      window.setTimeout(() => {
        delete copyButton.dataset.state;
        copyButton.textContent = 'Copy event JSON';
      }, 1200);
    } catch {
      toast('Clipboard access failed.', { variant: 'error' });
    }
  };
  actions.appendChild(copyButton);
  content.appendChild(actions);
  openDrawer({ title: entry.tool || entry.type || 'Activity detail', content });
}

function appendDetailSection(container, title, value) {
  if (value === undefined || value === null || value === '') return;
  const section = document.createElement('section');
  section.className = 'activity-detail-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading, detailPre(typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
  container.appendChild(section);
}

function detailPre(text) {
  const pre = document.createElement('pre');
  pre.className = 'detail-pre';
  pre.textContent = text;
  return pre;
}

function sortEntries(entries) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => Date.parse(right.ts || right.at || right.createdAt || 0) - Date.parse(left.ts || left.at || left.createdAt || 0));
}

function entryKey(entry) {
  return entry?.id || [entry?.ts || entry?.at || entry?.createdAt || '', entry?.tool || entry?.type || '', entry?.workspace || '', entry?.message || entry?.error || entry?.path || ''].join('|');
}
