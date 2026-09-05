import { fetchJson } from '../../api.js';
import { createFilterBar } from '../../components/filter-bar.js';
import { filterRadioField, filterSelectField, openFilterDrawer } from '../../components/filter-drawer.js';
import { setStateIconButton, stateIconButton } from '../../components/state-icon-button.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { virtualizeTable } from '../../components/table.js';
import { esc, timeAgo } from '../../utils.js';
import { getRouteParams, getWorkspaceFilter, navigate, replaceRouteParams, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { copyText } from '../../clipboard.js';
import { iconActionHtml } from '../../components/icons.js';
import { eventTimestampValue } from '../../../taskEvents.js';
import {
  activityAbsoluteTime,
  activityActionLabel,
  activityDisplayAction,
  activityToolLabel,
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
let _entriesRevision = 0;
let _renderedTableKey = '';
let _nextExpiryAt = Number.POSITIVE_INFINITY;
let _clockListenerBound = false;
let _filterOptions = { workspaces: [], tools: [] };
let _sessionIndex = new Map();
let _sessionIndexRevision = 0;
let _historyRenderPending = false;
let _historyRetryPending = false;

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
  const initialEntries = replaceActivityHistory(data.auditTail?.entries || []);
  _allEntries = initialEntries;
  _paused = false;
  _pausedEntries = [];
  _liveEntriesSinceLoad = [];
  _historyLoading = true;
  _loadError = '';
  _entriesRevision = initialEntries.length ? 1 : 0;
  _renderedTableKey = '';
  _nextExpiryAt = Number.POSITIVE_INFINITY;
  _historyRenderPending = false;
  _historyRetryPending = false;
  bindClockListener();
  container.innerHTML = '';
  container.appendChild(buildActivity());
  updateFilterOptions();
  renderFilteredTable();
  void loadLogs(token, { mode: 'replace' });
}

export function updateActivityLiveState(data = {}) {
  const visible = document.visibilityState === 'visible';
  let deferredChanged = false;
  if (visible && _historyRetryPending) {
    _historyRetryPending = false;
    _historyRenderPending = false;
    _historyLoading = true;
    _loadError = '';
    renderFilteredTable();
    void loadLogs(_mountToken, { mode: 'replace' });
    deferredChanged = true;
  } else if (visible && _historyRenderPending) {
    _historyRenderPending = false;
    updateFilterOptions();
    renderFilteredTable({ rebuildFilterBar: true });
    maybeOpenRequestedEvent();
    deferredChanged = true;
  }
  const sessionsChanged = updateSessionIndex(data.tasks || []);
  const liveEntries = Array.isArray(data.auditTail?.entries) ? data.auditTail.entries : [];
  const entriesChanged = mergeEntries(liveEntries);
  if (sessionsChanged && !entriesChanged && !deferredChanged) renderFilteredTable({ rebuildFilterBar: true });
  return sessionsChanged || entriesChanged || deferredChanged;
}

function updateSessionIndex(tasks = []) {
  const seen = new Set();
  let changed = false;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const id = sessionIdentifier(task);
    if (!id) continue;
    seen.add(id);
    const next = {
      id,
      title: task.title || task.objective || task.currentActivity || 'Task',
      workspace: task.workspace || '',
      status: task.status || ''
    };
    const current = _sessionIndex.get(id);
    if (!sameSessionView(current, next)) {
      _sessionIndex.set(id, next);
      changed = true;
    }
  }
  for (const id of [..._sessionIndex.keys()]) {
    if (seen.has(id)) continue;
    _sessionIndex.delete(id);
    changed = true;
  }
  if (changed) _sessionIndexRevision += 1;
  return changed;
}

function sameSessionView(left, right) {
  return Boolean(left)
    && left.id === right.id
    && left.title === right.title
    && left.workspace === right.workspace
    && left.status === right.status;
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
  _entriesRevision += 1;
  if (document.visibilityState !== 'visible') {
    _historyRenderPending = true;
    return true;
  }
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
  tableCard.innerHTML = '<div class="card-head"><h3>Activity history</h3><span class="section-action" id="__activity-count">Loading…</span></div><div class="activity-master-detail"><div class="activity-list-pane"><div class="card-body"><div class="table-wrap"><table class="data-table activity-table"><caption class="sr-only">Activity history</caption><colgroup><col class="activity-col-time"><col class="activity-col-message"></colgroup><thead><tr><th scope="col" class="activity-time-column">Time</th><th scope="col" class="activity-message-column">Activity</th></tr></thead><tbody id="__activity-tbody"></tbody></table></div></div></div><aside class="activity-inspector" data-activity-inspector><div class="inspector-empty"><strong>Select an activity</strong><span>Choose an event to inspect its result, task context, and technical details without leaving the activity stream.</span></div></aside></div>';
  root.append(toolbar, tableCard);
  queueMicrotask(() => renderActivityFilterBar(root));
  return root;
}

function renderActivityFilterBar(scope = document) {
  const host = scope.querySelector?.('#__activity-filter-bar') || document.getElementById('__activity-filter-bar');
  if (!host) return;
  const filtered = filteredEntries(Date.now());
  const pause = stateIconButton({
    pressed: _paused,
    label: _paused ? 'Resume live activity' : 'Freeze live activity',
    icon: _paused ? 'play' : 'pause',
    className: 'activity-freeze',
    onClick: async () => {
      if (_paused) {
        await resumeLiveActivity();
        return;
      }
      _paused = true;
      updatePauseButton();
    }
  });
  pause.id = '__activity-freeze';

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
    sorted: true,
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
  add('tool', 'Action', _filterState.tool, activityToolLabel(_filterState.tool));
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
        filterRadioField({
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
          options: activitySelectOptions('All actions', _filterOptions.tools, draft.tool, activityToolLabel),
          onChange: value => { draft.tool = value; }
        }),
        filterRadioField({
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

function activitySelectOptions(allLabel, values, selected, labelFor = value => value) {
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  return [{ value: '', label: allLabel }, ...options.map(value => ({ value, label: labelFor(value) }))];
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
    const data = await fetchJson('/api/logs?limit=500', { pauseTimeoutWhenHidden: false });
    if (token !== _mountToken) return false;
    const parsed = parseActivityHistoryResponse(data);
    if (!parsed.ok) throw new Error(parsed.error);

    if (mode === 'replace') {
      const stored = replaceActivityHistory(parsed.entries);
      _allEntries = mergeActivityEntries(stored, _liveEntriesSinceLoad).entries;
      _entriesRevision += 1;
      _liveEntriesSinceLoad = [];
    } else {
      const merged = mergeActivityEntries(_allEntries, parsed.entries);
      if (merged.changed) {
        _allEntries = merged.entries;
        _entriesRevision += 1;
      }
    }
    _historyLoading = false;
    _loadError = '';
    _historyRetryPending = false;
    if (document.visibilityState !== 'visible') {
      _historyRenderPending = true;
      return true;
    }
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
      _entriesRevision += 1;
      _liveEntriesSinceLoad = [];
      if (document.visibilityState !== 'visible') {
        _historyRenderPending = true;
        _historyRetryPending = true;
        return false;
      }
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
    _entriesRevision += 1;
    updateFilterOptions();
    renderFilteredTable();
    maybeOpenRequestedEvent();
  }
  updatePauseButton();
  await loadLogs(_mountToken, { mode: 'merge' });
}

function updatePauseButton() {
  const button = document.getElementById('__activity-freeze');
  setStateIconButton(button, {
    pressed: _paused,
    label: _paused ? 'Resume live activity' : 'Freeze live activity',
    icon: _paused ? 'play' : 'pause'
  });
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
  renderTable(filtered, currentTableKey());
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

function currentTableKey() {
  return [
    _entriesRevision,
    _sessionIndexRevision,
    _filterState.search,
    _filterState.timeRange,
    _filterState.workspace,
    _filterState.tool,
    _filterState.status,
    _filterState.task,
    _historyLoading ? 1 : 0,
    _loadError,
    _requestedEventId,
    Number.isFinite(_nextExpiryAt) ? _nextExpiryAt : 'infinity'
  ].join('|');
}

function renderTable(entries, tableKey) {
  const body = document.getElementById('__activity-tbody');
  const count = document.getElementById('__activity-count');
  if (!body) return false;
  if (_renderedTableKey === tableKey) return false;
  _renderedTableKey = tableKey;

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
      body.innerHTML = `<tr><td colspan="2"><div class="empty">${esc(emptyMessage)}</div></td></tr>`;
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
      <td class="activity-message-column activity-message-cell">
        <span class="activity-skeleton activity-skeleton-message${index % 3 === 1 ? ' activity-skeleton-message-short' : ''}"></span>
        <span class="activity-skeleton-meta">
          <span class="activity-skeleton activity-skeleton-status"></span>
          <span class="activity-skeleton activity-skeleton-context"></span>
        </span>
      </td>
    </tr>`).join('');
}

function renderActivityRow(entry) {
  const group = activityStatusGroup(entry);
  const status = entry.status || (group === 'other' ? 'unknown' : group);
  const message = activityMessage(entry);
  const timestamp = eventTimestampValue(entry);
  const absoluteTime = activityAbsoluteTime(entry);
  const action = activityDisplayAction(entry);
  const session = activitySessionView(entry, _sessionIndex);
  const project = session.workspace || entry.workspace || 'project';
  const taskTitle = session.title || 'Task';
  const relativeTime = timeAgo(timestamp) || '—';
  const row = document.createElement('tr');
  row.classList.add('activity-data-row');
  const eventId = activityEventId(entry);
  if (_requestedEventId && eventId === _requestedEventId) row.classList.add('activity-requested-row');
  row.innerHTML = `
    <td class="activity-time-column nowrap small" title="${esc(absoluteTime)}" data-clock-relative="${esc(timestamp)}">${esc(relativeTime)}</td>
    <td class="activity-message-column activity-message-cell">
      <button class="activity-row-trigger" type="button" data-focus-key="activity-${esc(eventId)}" aria-label="${esc(activityActionLabel(entry))}">
        <span class="activity-message-copy">${esc(message)}</span>
        <span class="activity-row-meta">
          ${pillHtml(status)}
          <span class="activity-row-action">${esc(action)}</span>
          <span class="activity-row-task" title="${esc(taskTitle)}">${esc(taskTitle)}</span>
          <span class="activity-row-project" title="${esc(project)}">${esc(project)}</span>
        </span>
      </button>
    </td>`;
  row.querySelector('.activity-row-trigger')?.addEventListener('click', () => openDetail(entry));
  row.addEventListener('click', event => {
    if (event.target.closest('button, a')) return;
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
    context.innerHTML = `<h3>Task</h3><strong>${esc(session.title)}</strong><span>${esc([session.workspace, session.shortId].filter(Boolean).join(' · '))}</span><div class="activity-session-actions"><a class="buttonlike secondary" href="${routeHref('tasks', { workspace: session.workspace || entry.workspace, task: session.id })}">${iconActionHtml('chevronRight', 'Task', { position: 'end' })}</a><a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace || entry.workspace, task: session.id, time: 'all' })}">Show only this task</a></div>`;
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
  const inspector = document.querySelector('[data-activity-inspector]');
  if (!inspector) return;
  const heading = document.createElement('div');
  heading.className = 'activity-inspector-head';
  heading.innerHTML = `<span class="overview-kicker">Activity</span><h2 tabindex="-1">${esc(entry.title || entry.operation || toolName(entry) || 'Activity detail')}</h2>`;
  inspector.replaceChildren(heading, content);
  inspector.scrollTop = 0;
  revealStackedActivityInspector(inspector);
  const selectedId = activityEventId(entry);
  for (const row of document.querySelectorAll('#__activity-tbody tr')) {
    row.classList.toggle('is-selected', row.querySelector('[data-focus-key]')?.dataset.focusKey === `activity-${selectedId}`);
  }
}

function revealStackedActivityInspector(inspector) {
  if (!window.matchMedia('(max-width: 1140px)').matches) return;
  const heading = inspector.querySelector('.activity-inspector-head h2');
  if (!(heading instanceof HTMLElement)) return;
  heading.focus({ preventScroll: true });
  heading.scrollIntoView({ block: 'start', inline: 'nearest' });
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
