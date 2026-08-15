import { fetchJson } from '../../api.js';
import { closeDrawer, openDrawer } from '../../components/drawer.js';
import { createFilterBar } from '../../components/filter-bar.js';
import { filterSelectField, openFilterDrawer } from '../../components/filter-drawer.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { virtualizeTable } from '../../components/table.js';
import { esc, timeAgo } from '../../utils.js';
import { getRouteParams, getWorkspaceFilter, navigate, replaceRouteParams, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { copyText } from '../../clipboard.js';
import { eventTimestampValue } from '../../../taskEvents.js';
import {
  activityAbsoluteTime,
  activityActionLabel,
  activityEntriesFingerprint,
  activityFilterTransition,
  activityMessage,
  activitySessionView,
  activityStatusGroup,
  filterActivityEntries,
  mergeActivityEntries,
  nextActivityExpiry,
  parseActivityHistoryResponse,
  replaceActivityHistory,
  sortActivityEntries
} from './model.js';

let _allEntries = [];
let _paused = false;
let _pausedEntries = [];
let _liveEntriesSinceLoad = [];
let _historyLoading = false;
let _filterState = { search: '', timeRange: '1h', workspace: '', tool: '', status: '', task: '' };
let _virtualizer = null;
let _mountToken = 0;
let _requestedEventId = '';
let _requestedEventRoute = '';
let _openedRequestedEvent = false;
let _loadError = '';
let _renderedEntriesFingerprint = '';
let _nextExpiryAt = Number.POSITIVE_INFINITY;
let _clockListenerBound = false;
let _filterOptions = { workspaces: [], tools: [] };
let _sessionIndex = new Map();
let _sessionIndexFingerprint = '';
let _liveSnapshotFingerprint = '';

export function mountActivity(container, data = {}) {
  const token = ++_mountToken;
  updateSessionIndex(data.tasks || []);
  const params = getRouteParams();
  _filterState.workspace = getWorkspaceFilter();
  _filterState.task = params.get('task') || '';
  _filterState.tool = params.get('tool') || '';
  _filterState.status = routeStatus(params.get('status'));
  _filterState.search = params.get('search') || '';
  _requestedEventId = params.get('event') || '';
  const requestedEventRoute = _requestedEventId ? _filterState.task + '|' + _requestedEventId : '';
  if (requestedEventRoute !== _requestedEventRoute) {
    _requestedEventRoute = requestedEventRoute;
    _openedRequestedEvent = false;
  }
  const requestedRange = String(params.get('time') || '').toLowerCase();
  _filterState.timeRange = ['15m', '1h', '24h', '7d', 'all'].includes(requestedRange) ? requestedRange : '1h';
  _virtualizer?.destroy();
  _virtualizer = null;
  _allEntries = [];
  _paused = false;
  _pausedEntries = [];
  _liveEntriesSinceLoad = [];
  _historyLoading = true;
  _loadError = '';
  _renderedEntriesFingerprint = '';
  _liveSnapshotFingerprint = '';
  _nextExpiryAt = Number.POSITIVE_INFINITY;
  bindClockListener();
  container.innerHTML = '';
  container.appendChild(buildActivity());
  renderFilteredTable();
  void loadLogs(token, { mode: 'replace' });
}

export function updateActivityLiveState(data = {}) {
  const sessionsChanged = updateSessionIndex(data.tasks || []);
  const liveEntries = Array.isArray(data.auditTail?.entries) ? data.auditTail.entries : [];
  const liveFingerprint = activityEntriesFingerprint(liveEntries);
  const entriesChanged = liveFingerprint === _liveSnapshotFingerprint ? false : mergeEntries(liveEntries);
  _liveSnapshotFingerprint = liveFingerprint;
  if (sessionsChanged && !entriesChanged) {
    _renderedEntriesFingerprint = '';
    renderFilteredTable({ rebuildFilterBar: true });
  }
  return sessionsChanged || entriesChanged;
}

function updateSessionIndex(tasks = []) {
  const next = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = sessionIdentifier(task);
    if (!id) continue;
    next.set(id, {
      id,
      title: task.title || task.objective || task.currentActivity || 'Task',
      workspace: task.workspace || '',
      status: task.status || ''
    });
  }
  const fingerprint = JSON.stringify([...next.values()].map(item => [item.id, item.title, item.workspace, item.status]));
  if (fingerprint === _sessionIndexFingerprint) return false;
  _sessionIndex = next;
  _sessionIndexFingerprint = fingerprint;
  return true;
}

function sessionIdentifier(task = {}) {
  return String(task.id || task.taskId || task.work_id || '').trim();
}

export function mergeEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (_historyLoading) _liveEntriesSinceLoad = mergeActivityEntries(_liveEntriesSinceLoad, entries).entries;
  if (_paused) {
    _pausedEntries = mergeActivityEntries(_pausedEntries, entries).entries;
    return false;
  }
  const merged = mergeActivityEntries(_allEntries, entries);
  if (!merged.changed) return false;
  _allEntries = merged.entries;
  updateFilterOptions();
  renderFilteredTable();
  maybeOpenRequestedEvent();
  return true;
}

export function prependEntry(entry) {
  return mergeEntries(entry ? [entry] : []);
}

function routeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'ok') return 'succeeded';
  if (status === 'error') return 'failed';
  return ['succeeded', 'active', 'failed', 'blocked', 'cancelled', 'other'].includes(status) ? status : '';
}

function bindClockListener() {
  if (_clockListenerBound) return;
  window.addEventListener('relai:clock-tick', event => {
    const now = Number(event?.detail?.now || Date.now());
    if (now < _nextExpiryAt) return;
    renderFilteredTable({ now });
  });
  _clockListenerBound = true;
}

function buildActivity() {
  const root = document.createElement('div');
  root.className = 'section activity-page';

  const toolbar = document.createElement('div');
  toolbar.id = '__activity-filter-bar';

  const tableCard = document.createElement('div');
  tableCard.id = '__activity-table-wrap';
  tableCard.className = 'card activity-event-card';
  tableCard.innerHTML = '<div class="card-head"><h3>Activity history</h3><span class="section-action" id="__activity-count">Loading…</span></div><div class="card-body"><div class="table-wrap"><table class="data-table activity-table"><caption class="sr-only">Activity history</caption><colgroup><col class="activity-col-time"><col class="activity-col-tool"><col class="activity-col-workspace"><col class="activity-col-status"><col class="activity-col-message"><col class="activity-col-action"></colgroup><thead><tr><th scope="col" class="activity-time-column">Time</th><th scope="col" class="activity-tool-column">Action</th><th scope="col" class="activity-workspace-column">Project</th><th scope="col" class="activity-status-column">Status</th><th scope="col" class="activity-message-column">Message</th><th scope="col" class="activity-action-column"><span class="sr-only">Actions</span></th></tr></thead><tbody id="__activity-tbody"></tbody></table></div></div>';
  root.append(toolbar, tableCard);
  queueMicrotask(() => renderActivityFilterBar(root));
  return root;
}

function renderActivityFilterBar(scope = document) {
  const host = scope.querySelector?.('#__activity-filter-bar') || document.getElementById('__activity-filter-bar');
  if (!host) return;
  const filtered = filteredEntries(Date.now());
  const pause = document.createElement('button');
  pause.type = 'button';
  pause.id = '__activity-freeze';
  pause.className = `secondary activity-freeze${_paused ? ' active' : ''}`;
  pause.textContent = _paused ? 'Resume live list' : 'Freeze live list';
  pause.title = 'Freeze the table so new events do not shift rows while you read.';
  pause.setAttribute('aria-pressed', String(_paused));
  pause.addEventListener('click', async () => {
    if (_paused) {
      await resumeLiveActivity();
      return;
    }
    _paused = true;
    updatePauseButton();
    toast('Live activity is frozen. New events will be applied when you resume.', { variant: 'warn', duration: 2200 });
  });

  let searchTimer;
  host.replaceChildren(createFilterBar({
    search: {
      label: 'Search activity',
      placeholder: 'Search task, activity, action, project, or file',
      value: _filterState.search,
      onInput: value => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          _filterState.search = value;
          syncFilterRoute();
          renderFilteredTable({ preserveFilterBar: true });
        }, 160);
      }
    },
    filters: activeActivityFilters(),
    onOpenFilters: openActivityFilters,
    onClearAll: clearActivityFilters,
    summary: activityFilterSummary(filtered.length),
    action: pause
  }));
}

function filteredEntries(now) {
  return filterActivityEntries(_allEntries, _filterState, now, {
    sessionTitle: entry => activitySessionView(entry, _sessionIndex).title
  });
}

function activeActivityFilters() {
  const filters = [];
  const add = (key, label, value, display = value) => {
    if (!value) return;
    filters.push({ label, value: display, onRemove: () => removeActivityFilter(key) });
  };
  if (_filterState.timeRange !== '1h') add('timeRange', 'Time', _filterState.timeRange, _filterState.timeRange === 'all' ? 'All time' : _filterState.timeRange);
  add('workspace', 'Project', _filterState.workspace);
  add('tool', 'Action', _filterState.tool);
  add('status', 'Status', _filterState.status, statusFilterLabel(_filterState.status));
  if (_filterState.task) {
    const session = _sessionIndex.get(_filterState.task);
    add('task', 'Task', _filterState.task, session?.title || `Task ${_filterState.task.slice(0, 8)}`);
  }
  return filters;
}

function openActivityFilters() {
  openFilterDrawer({
    title: 'Activity filters',
    value: {
      timeRange: _filterState.timeRange,
      workspace: _filterState.workspace,
      tool: _filterState.tool,
      status: _filterState.status
    },
    resetValue: { timeRange: '1h', workspace: '', tool: '', status: '' },
    renderFields(fields, draft) {
      fields.append(
        filterSelectField({
          label: 'Time range',
          value: draft.timeRange,
          options: [
            { value: '15m', label: 'Last 15 minutes' },
            { value: '1h', label: 'Last hour' },
            { value: '24h', label: 'Last 24 hours' },
            { value: '7d', label: 'Last 7 days' },
            { value: 'all', label: 'All time' }
          ],
          onChange: value => { draft.timeRange = value; }
        }),
        filterSelectField({
          label: 'Project',
          value: draft.workspace,
          options: activitySelectOptions('All projects', _filterOptions.workspaces, draft.workspace),
          onChange: value => { draft.workspace = value; }
        }),
        filterSelectField({
          label: 'Action',
          value: draft.tool,
          options: activitySelectOptions('All actions', _filterOptions.tools, draft.tool),
          onChange: value => { draft.tool = value; }
        }),
        filterSelectField({
          label: 'Status',
          value: draft.status,
          options: [
            { value: '', label: 'All statuses' },
            { value: 'succeeded', label: 'Succeeded' },
            { value: 'active', label: 'In progress' },
            { value: 'failed', label: 'Failed' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'other', label: 'Other' }
          ],
          onChange: value => { draft.status = value; }
        })
      );
    },
    onApply: applyActivityFilters
  });
}

function activitySelectOptions(allLabel, values, selected) {
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  return [{ value: '', label: allLabel }, ...options.map(value => ({ value, label: value }))];
}

function applyActivityFilters(draft) {
  const transition = activityFilterTransition(_filterState, draft);
  _filterState = transition.filterState;
  if (transition.workspaceChanged) {
    navigate('activity', activityRouteParams());
    return;
  }
  syncFilterRoute();
  renderFilteredTable({ rebuildFilterBar: true, resetHorizontalScroll: true });
}

function removeActivityFilter(key) {
  if (key === 'workspace') {
    _filterState.workspace = '';
    navigate('activity', activityRouteParams());
    return;
  }
  if (key === 'timeRange') _filterState.timeRange = '1h';
  else _filterState[key] = '';
  syncFilterRoute();
  renderFilteredTable({ rebuildFilterBar: true, resetHorizontalScroll: true });
}

function clearActivityFilters() {
  const hadWorkspace = Boolean(_filterState.workspace);
  _filterState = { search: '', timeRange: '1h', workspace: '', tool: '', status: '', task: '' };
  if (hadWorkspace) {
    navigate('activity', activityRouteParams());
    return;
  }
  syncFilterRoute();
  renderFilteredTable({ rebuildFilterBar: true, resetHorizontalScroll: true });
}

async function loadLogs(token, options = {}) {
  const mode = options.mode === 'merge' ? 'merge' : 'replace';
  try {
    const data = await fetchJson('/api/logs?limit=500');
    if (token !== _mountToken) return false;
    const parsed = parseActivityHistoryResponse(data);
    if (!parsed.ok) throw new Error(parsed.error);

    if (mode === 'replace') {
      const stored = replaceActivityHistory(parsed.entries);
      _allEntries = mergeActivityEntries(stored, _liveEntriesSinceLoad).entries;
      _liveEntriesSinceLoad = [];
    } else {
      _allEntries = mergeActivityEntries(_allEntries, parsed.entries).entries;
    }
    _historyLoading = false;
    _loadError = '';
    updateFilterOptions();
    renderFilteredTable();
    maybeOpenRequestedEvent();
    return true;
  } catch (error) {
    if (token !== _mountToken) return false;
    const message = error instanceof Error ? error.message : String(error);
    if (mode === 'replace') {
      _historyLoading = false;
      _loadError = message;
      _allEntries = mergeActivityEntries([], _liveEntriesSinceLoad).entries;
      _liveEntriesSinceLoad = [];
      updateFilterOptions();
      renderFilteredTable();
    } else {
      toast(`Live activity resumed, but stored history could not be refreshed: ${message}`, { variant: 'warn', duration: 3600 });
    }
    return false;
  }
}

async function resumeLiveActivity() {
  const buffered = _pausedEntries;
  _paused = false;
  _pausedEntries = [];
  const merged = mergeActivityEntries(_allEntries, buffered);
  if (merged.changed) {
    _allEntries = merged.entries;
    updateFilterOptions();
    renderFilteredTable();
    maybeOpenRequestedEvent();
  }
  updatePauseButton();
  toast(buffered.length ? 'Buffered activity applied.' : 'Live activity resumed.', { variant: 'success', duration: 2200 });
  await loadLogs(_mountToken, { mode: 'merge' });
}

function updatePauseButton() {
  const button = document.getElementById('__activity-freeze');
  if (!button) return;
  button.textContent = _paused ? 'Resume live list' : 'Freeze live list';
  button.classList.toggle('active', _paused);
  button.setAttribute('aria-pressed', String(_paused));
}

function updateFilterOptions() {
  _filterOptions = {
    workspaces: uniqueValues(_allEntries, entry => entry.workspace),
    tools: uniqueValues(_allEntries, toolName)
  };
}

function uniqueValues(entries, selector) {
  return [...new Set(entries.map(selector).filter(Boolean).map(String))].sort((left, right) => left.localeCompare(right));
}

function renderFilteredTable(options = {}) {
  const now = Number(options.now || Date.now());
  const filtered = filteredEntries(now);
  _nextExpiryAt = nextActivityExpiry(_allEntries, _filterState, now);
  renderTable(filtered);
  if (options.resetHorizontalScroll === true) {
    const tableWrap = document.querySelector('#__activity-table-wrap .table-wrap');
    if (tableWrap) tableWrap.scrollLeft = 0;
  }
  if (options.rebuildFilterBar === true) renderActivityFilterBar();
  else syncActivityFilterBar(filtered.length);
}

function syncActivityFilterBar(filteredCount) {
  const summary = document.querySelector('#__activity-filter-bar .filter-summary');
  if (summary) summary.textContent = activityFilterSummary(filteredCount);
  const clear = document.querySelector('#__activity-filter-bar .filter-clear-button');
  if (clear) clear.hidden = !hasActiveFilters();
}

function activityFilterSummary(filteredCount) {
  if (_historyLoading) return 'Loading stored activity history…';
  if (_loadError) return `${filteredCount} live event${filteredCount === 1 ? '' : 's'} shown · stored history could not be loaded.`;
  return `${filteredCount} of ${_allEntries.length} events shown`;
}

function statusFilterLabel(status) {
  return {
    succeeded: 'succeeded',
    active: 'in progress',
    failed: 'failed',
    blocked: 'blocked',
    cancelled: 'cancelled',
    other: 'other'
  }[status] || status;
}

function activityRouteParams() {
  return {
    workspace: _filterState.workspace,
    search: _filterState.search || null,
    time: _filterState.timeRange === '1h' ? null : _filterState.timeRange,
    tool: _filterState.tool || null,
    status: _filterState.status || null,
    task: _filterState.task || null
  };
}

function syncFilterRoute() {
  replaceRouteParams({ ...activityRouteParams(), event: null });
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

function renderTable(entries) {
  const body = document.getElementById('__activity-tbody');
  const count = document.getElementById('__activity-count');
  if (!body) return false;
  const fingerprint = JSON.stringify([
    activityEntriesFingerprint(entries),
    _sessionIndexFingerprint,
    _historyLoading,
    _loadError,
    _requestedEventId
  ]);
  if (_renderedEntriesFingerprint === fingerprint) return false;
  _renderedEntriesFingerprint = fingerprint;

  if (count) count.textContent = _historyLoading
    ? 'Loading…'
    : _loadError
      ? (entries.length ? `${entries.length} live event${entries.length === 1 ? '' : 's'} · history unavailable` : 'History unavailable')
      : `${entries.length} event${entries.length === 1 ? '' : 's'}`;
  if (!entries.length) {
    if (_historyLoading) {
      body.innerHTML = activityLoadingRows();
    } else {
      const emptyMessage = _loadError
        ? 'Activity history could not be loaded. Live events will appear here when available.'
        : 'No activity matches these filters.';
      body.innerHTML = `<tr><td colspan="6"><div class="empty">${esc(emptyMessage)}</div></td></tr>`;
    }
    _virtualizer?.destroy();
    _virtualizer = null;
    return true;
  }
  if (_virtualizer) {
    _virtualizer.reinit(entries);
    return true;
  }
  _virtualizer = virtualizeTable(body, entries, renderActivityRow);
  return true;
}

function activityLoadingRows() {
  return Array.from({ length: 6 }, (_, index) => `
    <tr class="activity-skeleton-row" aria-hidden="true">
      <td class="activity-time-column"><span class="activity-skeleton activity-skeleton-time"></span></td>
      <td class="activity-tool-column"><span class="activity-skeleton activity-skeleton-tool"></span></td>
      <td class="activity-workspace-column"><span class="activity-skeleton activity-skeleton-workspace"></span></td>
      <td class="activity-status-column"><span class="activity-skeleton activity-skeleton-status"></span></td>
      <td class="activity-message-column activity-message-cell">
        <span class="activity-message-mobile-meta">
          <span class="activity-skeleton activity-skeleton-status"></span>
          <span class="activity-skeleton activity-skeleton-tool"></span>
          <span class="activity-skeleton activity-skeleton-time"></span>
        </span>
        <span class="activity-skeleton activity-skeleton-message${index % 3 === 1 ? ' activity-skeleton-message-short' : ''}"></span>
      </td>
      <td class="activity-action-column"><span class="activity-skeleton activity-skeleton-action"></span></td>
    </tr>`).join('');
}

function renderActivityRow(entry) {
  const group = activityStatusGroup(entry);
  const status = entry.status || (group === 'other' ? 'unknown' : group);
  const message = activityMessage(entry);
  const timestamp = eventTimestampValue(entry);
  const absoluteTime = activityAbsoluteTime(entry);
  const tool = toolName(entry);
  const title = entry.title || entry.operation || '';
  const relativeTime = timeAgo(timestamp) || '—';
  const row = document.createElement('tr');
  row.className = 'clickable-row';
  if (_requestedEventId && activityEventId(entry) === _requestedEventId) row.classList.add('activity-requested-row');
  row.innerHTML = `
    <td class="activity-time-column nowrap small" title="${esc(absoluteTime)}" data-clock-relative="${esc(timestamp)}">${esc(relativeTime)}</td>
    <td class="activity-tool-column truncate mono" title="${esc(title)}">${esc(tool)}</td>
    <td class="activity-workspace-column truncate">${esc(entry.workspace || '—')}</td>
    <td class="activity-status-column">${pillHtml(status)}</td>
    <td class="activity-message-column activity-message-cell">
      <span class="activity-message-mobile-meta">${pillHtml(status)}<code>${esc(tool)}</code><span class="activity-message-mobile-time" data-clock-relative="${esc(timestamp)}">${esc(relativeTime)}</span></span>
      <span class="activity-message-copy">${esc(message)}</span>
      ${title ? `<span class="activity-message-title">${esc(title)}</span>` : ''}
    </td>
    <td class="activity-action-column"><button class="secondary activity-row-button" type="button" aria-label="${esc(activityActionLabel(entry))}">›</button></td>`;
  row.onclick = () => openDetail(entry);
  row.querySelector('.activity-row-button')?.addEventListener('click', event => {
    event.stopPropagation();
    openDetail(entry);
  });
  return row;
}

function toolName(entry) {
  return entry?.tool?.name || entry?.tool || entry?.type || 'activity';
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
  content.className = 'detail-stack activity-detail';
  const group = activityStatusGroup(entry);
  const displayStatus = entry.status || (group === 'other' ? 'unknown' : group);
  const session = activitySessionView(entry, _sessionIndex);

  const head = document.createElement('div');
  head.className = 'activity-detail-head';
  head.innerHTML = `<div>${pillHtml(displayStatus)}</div><span class="muted">${esc(activityAbsoluteTime(entry))}</span>`;
  content.appendChild(head);

  if (session.id) {
    const context = document.createElement('section');
    context.className = 'activity-detail-section activity-session-context';
    context.innerHTML = `<h3>Task</h3><strong>${esc(session.title)}</strong><span>${esc([session.workspace, session.shortId].filter(Boolean).join(' · '))}</span><div class="activity-session-actions"><a class="buttonlike secondary" href="${routeHref('tasks', { workspace: session.workspace || entry.workspace, task: session.id })}">Open task</a><a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace || entry.workspace, task: session.id, time: 'all' })}">Show only this task</a></div>`;
    for (const link of context.querySelectorAll('a')) link.addEventListener('click', closeDrawer);
    content.appendChild(context);
  }

  appendReadableSection(content, 'What happened', activityMessage(entry));
  appendReadableSection(content, 'Target', activityTargetLabel(entry));
  appendReadableSection(content, 'Result', activityResultText(entry));
  const error = activityErrorText(entry);
  if (error) appendReadableSection(content, 'Error', error, 'activity-detail-error');

  const technical = document.createElement('details');
  technical.className = 'activity-detail-technical';
  technical.innerHTML = '<summary>Technical details</summary>';
  const fields = [
    ['Tool', toolName(entry)],
    ['Action', entry.action || entry.operation || 'execute'],
    ['Category', entry.category || 'tool'],
    ['Event ID', entry.eventId || entry.id || '—'],
    ['Work session ID', entry.taskId || entry.sessionId || '—'],
    ...(entry.sequence != null ? [['Sequence', entry.sequence]] : [])
  ];
  const fieldGroup = document.createElement('div');
  fieldGroup.className = 'activity-detail-fields';
  for (const [label, value] of fields) {
    const row = document.createElement('div');
    row.className = 'detail-field';
    row.innerHTML = `<span class="detail-field-label">${esc(label)}</span><span>${esc(value)}</span>`;
    fieldGroup.appendChild(row);
  }
  technical.appendChild(fieldGroup);
  appendRawDetail(technical, 'Raw target', entry.target);
  appendRawDetail(technical, 'Raw result', entry.result);
  appendRawDetail(technical, 'Safe metadata', entry.metadata);
  appendRawDetail(technical, 'Raw error', entry.error);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'secondary';
  copyButton.textContent = 'Copy event JSON';
  copyButton.onclick = async () => {
    try {
      await copyText(JSON.stringify(safeEventProjection(entry), null, 2));
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
  technical.appendChild(copyButton);
  content.appendChild(technical);

  openDrawer({ title: entry.title || entry.operation || toolName(entry) || 'Activity detail', content });
}

function appendReadableSection(container, title, value, className = '') {
  if (!value) return;
  const section = document.createElement('section');
  section.className = ['activity-detail-section', className].filter(Boolean).join(' ');
  const heading = document.createElement('h3');
  heading.textContent = title;
  const copy = document.createElement('p');
  copy.textContent = value;
  section.append(heading, copy);
  container.appendChild(section);
}

function appendRawDetail(container, title, value) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value === 'object' && Object.keys(value).length === 0) return;
  const section = document.createElement('section');
  section.className = 'activity-detail-raw';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const pre = document.createElement('pre');
  pre.className = 'detail-pre';
  pre.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  section.append(heading, pre);
  container.appendChild(section);
}

function activityTargetLabel(entry) {
  if (typeof entry.path === 'string' && entry.path.trim()) return entry.path.trim();
  if (typeof entry.target === 'string' && entry.target.trim()) return entry.target.trim();
  return entry.target?.workspaceRelativePath || entry.target?.path || '';
}

function activityResultText(entry) {
  if (typeof entry.result === 'string') return entry.result.trim();
  return String(entry.result?.outcome || entry.result?.summary || '').trim();
}

function activityErrorText(entry) {
  if (typeof entry.error === 'string') return entry.error.trim();
  return String(entry.error?.message || '').trim();
}

export function sortEntries(entries) {
  return sortActivityEntries(entries);
}

function safeEventProjection(entry) {
  if (entry?.safeCopy && typeof entry.safeCopy === 'object') return entry.safeCopy;
  return {
    eventId: entry.eventId || entry.id,
    taskId: entry.taskId,
    sessionId: entry.sessionId,
    sequence: entry.sequence,
    timestamp: entry.timestamp || entry.ts,
    category: entry.category,
    action: entry.action,
    status: entry.status || activityStatusGroup(entry),
    title: entry.title || entry.operation,
    summary: entry.summary || entry.message || activityMessage(entry),
    durationMs: entry.durationMs || entry.ms,
    tool: entry.tool,
    workspace: entry.workspace,
    target: entry.target || (entry.path ? { workspaceRelativePath: entry.path } : undefined),
    result: entry.result,
    error: entry.error,
    metadata: entry.metadata
  };
}
