import { postJson, requestDashboardRefresh } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { closeDrawer, openDrawer } from '../../components/drawer.js';
import { copyText } from '../../clipboard.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { esc, formatDuration, metricHtml, timeAgo } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { bindWorkspaceMenus, workspaceMenuHtml } from '../../components/workspace-menu.js';
import { taskProgressHtml } from '../../components/task-progress.js';
import {
  clientCapabilityViews,
  nativeTaskCollection,
  nativeTaskView,
  recoveryStateView,
  taskEntityView,
  workSessionStateView
} from '../../task-identity.js';

const SESSION_PAGE_SIZE = 50;
const DETAIL_FILE_PREVIEW = 12;
const DETAIL_EVENT_PREVIEW = 20;
const visibleCounts = new Map();

export function mountTasks(container, data = {}) {
  const workspace = getWorkspaceFilter();
  const sessions = orderSessionsForDisplay((Array.isArray(data.tasks) ? data.tasks : [])
    .filter(session => !workspace || session.workspace === workspace));
  const sessionById = new Map(sessions.map(session => [sessionIdentifier(session), session]));
  const nativeCollection = nativeTaskCollection(data);
  const nativeTasks = nativeCollection.tasks
    .map(task => nativeTaskView(task, data.managedProcesses || []))
    .filter(task => !workspace || task.workspace === workspace || sessionById.get(task.logicalTaskId)?.workspace === workspace)
    .sort(orderNativeTasks);
  const working = sessions.filter(session => workSessionStateView(session).active).length;
  const open = sessions.filter(session => !workSessionStateView(session).terminal && !workSessionStateView(session).active).length;
  const completed = sessions.filter(session => workSessionStateView(session).status === 'completed').length;
  const scopeKey = workspace || '__all__';

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section sessions-page runtime-observability-page';
  root.innerHTML = `
    <div class="feature-toolbar sessions-toolbar">
      <p>A work session is a repository objective. A native MCP Task is one asynchronous request. A managed process is one operating-system process.</p>
      <div class="section-head-actions">
        ${workspaceMenuHtml(data.config?.workspaces || [], workspace, { id: 'sessionsWorkspaceMenu' })}
        <span class="feature-count">${sessions.length} work session${sessions.length === 1 ? '' : 's'}${workspace ? ` in ${esc(workspace)}` : ''}</span>
      </div>
    </div>
    <div class="overview-grid overview-grid-compact summary-metrics">
      ${metricHtml('Active work sessions', working, 'repository workflows currently executing', working ? 'blue' : 'good')}
      ${metricHtml('Open work sessions', open, 'waiting, blocked, or ready for another step', open ? 'blue' : 'good')}
      ${metricHtml('Completed', completed, 'work-session completion explicitly reported', completed ? 'good' : 'blue')}
    </div>`;

  root.appendChild(capabilityCard(data));
  root.appendChild(nativeTasksCard(nativeCollection, nativeTasks));

  const card = document.createElement('section');
  card.className = 'card sessions-history-card';
  card.innerHTML = '<div class="card-head"><div><h3>Repository work sessions</h3><p>Objectives spanning multiple Rel.AI tool calls. Their lifecycle is independent from native tasks and managed processes.</p></div><div class="card-head-actions"><a class="section-action" href="#activity">Open tool events</a><a class="section-action" href="#settings/diagnostics">History controls</a></div></div>';
  const body = document.createElement('div');
  body.className = 'card-body task-list';
  renderSessionRows(body, sessions, scopeKey);
  body.addEventListener('click', event => {
    const loadMore = event.target.closest('[data-load-more-sessions]');
    if (loadMore) {
      visibleCounts.set(scopeKey, visibleCountFor(scopeKey) + SESSION_PAGE_SIZE);
      renderSessionRows(body, sessions, scopeKey);
      return;
    }
    const button = event.target.closest('[data-task-id]');
    if (!button) return;
    openSession(sessions.find(session => sessionIdentifier(session) === button.dataset.taskId));
  });
  card.appendChild(body);
  root.appendChild(card);
  container.appendChild(root);
  bindWorkspaceMenus(root);
  bindCopyActions(root);
  bindNativeTaskActions(root);
}

function capabilityCard(data) {
  const views = clientCapabilityViews(data);
  const card = document.createElement('section');
  card.className = 'card runtime-capability-card';
  card.innerHTML = `
    <div class="card-head"><div><h3>Client task capability</h3><p>Observed from actual MCP client capability advertisements. Transport or product branding is not used as a proxy.</p></div><span class="feature-count">${views.length} observed</span></div>
    <div class="card-body runtime-capability-list">${views.map(capabilityRow).join('')}</div>`;
  return card;
}

function capabilityRow(view) {
  const observed = view.observedAt
    ? `<span data-clock-relative="${esc(view.observedAt)}">Observed ${esc(timeAgo(view.observedAt) || 'now')}</span>`
    : '<span>Observation time unavailable</span>';
  return `<article class="runtime-capability-row" aria-label="${esc(`${view.capabilityLabel}. ${view.executionLabel}.`)}">
    <div class="runtime-capability-main">
      <div class="runtime-entity-heading"><strong>${esc(view.clientLabel)}</strong>${pillHtml(view.pill, view.pillClass)}</div>
      <span>${esc(view.capabilityLabel)}</span>
      <span>${esc(view.executionLabel)}</span>
      <small>${esc(view.description)}</small>
    </div>
    <div class="runtime-capability-meta">
      ${observed}
      ${view.connectionId ? identifierHtml('Request or connection ID', view.connectionId) : '<span>Connection ID unavailable</span>'}
    </div>
  </article>`;
}

function nativeTasksCard(collection, tasks) {
  const card = document.createElement('section');
  card.className = 'card native-tasks-card';
  const source = collection.available ? `Backend field: ${collection.sourceField}` : `Required backend field: ${collection.requiredField}`;
  card.innerHTML = `
    <div class="card-head"><div><h3>Native MCP tasks</h3><p>One asynchronous MCP request per record. Persistent processes may continue after their startup task completes.</p></div><span class="feature-count">${esc(source)}</span></div>
    <div class="card-body native-task-list">${nativeTaskListHtml(collection, tasks)}</div>`;
  return card;
}

function nativeTaskListHtml(collection, tasks) {
  if (!collection.available) {
    return '<div class="empty runtime-data-unknown" role="status"><strong>Native task records are unavailable.</strong><span>The dashboard will render them when the backend supplies a <code>nativeTasks</code> collection. Capability status above remains based on real client advertisements.</span></div>';
  }
  if (!tasks.length) return '<div class="empty">No retained native MCP tasks match the current workspace filter.</div>';
  return tasks.map(nativeTaskRow).join('');
}

function nativeTaskRow(task) {
  const summary = task.errorSummary || task.resultSummary || task.statusMessage || task.description;
  const relationship = relationshipHtml(task.logicalTaskId, task.taskId, task.processId);
  const statusMarker = task.showSpinner
    ? '<span class="runtime-activity-spinner" aria-hidden="true"></span>'
    : '<span class="runtime-status-symbol" aria-hidden="true">•</span>';
  const updated = task.updatedAt || task.startedAt;
  return `<article class="native-task-row${task.active ? ' active' : ''}${task.terminal ? ' terminal' : ''}" aria-label="Native task ${esc(task.taskId || 'unknown')}: ${esc(task.label)}">
    <div class="native-task-head">
      <div class="runtime-status-marker">${statusMarker}</div>
      <div class="native-task-title">
        <div class="runtime-entity-heading"><strong>${esc(task.operation)}</strong>${pillHtml(task.label, task.pillClass)}</div>
        ${identifierHtml('Native task ID', task.taskId || 'unknown')}
      </div>
      <div class="native-task-time">
        ${task.startedAt ? `<span>Started <span data-clock-relative="${esc(task.startedAt)}">${esc(timeAgo(task.startedAt) || 'now')}</span></span>` : '<span>Start time unavailable</span>'}
        ${updated ? `<span>Updated <span data-clock-relative="${esc(updated)}">${esc(timeAgo(updated) || 'now')}</span></span>` : ''}
      </div>
    </div>
    ${relationship}
    <div class="native-task-detail-grid">
      <div><span>Status</span><strong>${esc(task.label)}</strong></div>
      <div><span>Work session</span><strong>${esc(task.logicalTaskId || 'Not associated')}</strong></div>
      <div><span>Managed process</span><strong>${esc(task.processId || 'Not associated')}</strong></div>
      <div><span>Workspace</span><strong>${esc(task.workspace || 'Unavailable')}</strong></div>
    </div>
    <div class="runtime-state-copy${task.waitingForInput ? ' input-required' : ''}" role="status">
      <strong>${esc(task.description)}</strong>
      ${summary ? `<span>${esc(summary)}</span>` : ''}
      ${task.canCancel ? '<span>This active native task has an explicit backend-published cancellation action.</span>' : '<span>No dashboard native-task cancel control is shown without an explicit cancellable backend action.</span>'}
    </div>
    ${task.canCancel ? `<div class="native-task-actions"><button class="secondary danger" type="button" data-cancel-native-task data-cancel-url="${esc(task.cancelUrl)}" data-native-task-id="${esc(task.taskId)}" aria-label="Cancel native task ${esc(task.taskId)}">Cancel native task</button></div>` : ''}
  </article>`;
}

function relationshipHtml(workSessionId, nativeTaskId, processId) {
  const items = [
    ['Work session', workSessionId],
    ['Native task', nativeTaskId],
    ['Process', processId]
  ].filter(([, value]) => value);
  if (!items.length) return '<div class="runtime-relationship muted">No lifecycle relationships were supplied.</div>';
  return `<div class="runtime-relationship" aria-label="Lifecycle relationship">${items.map(([label, value], index) => `${index ? '<span aria-hidden="true">→</span>' : ''}<span><small>${esc(label)}</small><code>${esc(value)}</code></span>`).join('')}</div>`;
}

function identifierHtml(label, value) {
  return `<span class="runtime-identifier"><span>${esc(label)}</span><code>${esc(value)}</code><button class="runtime-copy-id" type="button" data-copy-value="${esc(value)}" aria-label="Copy ${esc(label)} ${esc(value)}">Copy</button></span>`;
}

function bindCopyActions(root) {
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-copy-value]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const value = button.dataset.copyValue || '';
    void copyText(value)
      .then(() => toast('Identifier copied.', { variant: 'success' }))
      .catch(error => toast(error instanceof Error ? error.message : String(error), { variant: 'error' }));
  });
}

function bindNativeTaskActions(root) {
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-cancel-native-task]');
    if (!button) return;
    const url = button.dataset.cancelUrl || '';
    const taskId = button.dataset.nativeTaskId || '';
    if (!url.startsWith('/api/') || !taskId) return;
    void runButtonAction(button, {
      idleText: 'Cancel native task',
      loadingText: 'Requesting cancellation…',
      successText: 'Cancellation requested',
      errorText: 'Retry cancellation'
    }, () => postJson(url, { taskId }, { timeout: 10000 }))
      .then(result => {
        if (result?.ok !== false) requestDashboardRefresh();
      });
  });
}

function orderNativeTasks(left, right) {
  const activeDifference = Number(right.active) - Number(left.active);
  if (activeDifference) return activeDifference;
  const timeDifference = Date.parse(right.updatedAt || right.startedAt || 0) - Date.parse(left.updatedAt || left.startedAt || 0);
  if (Number.isFinite(timeDifference) && timeDifference) return timeDifference;
  return String(left.taskId).localeCompare(String(right.taskId), 'en-US', { numeric: true, sensitivity: 'base' });
}

function renderSessionRows(body, sessions, scopeKey) {
  if (!sessions.length) {
    body.innerHTML = '<div class="empty">Work sessions appear when ChatGPT starts an explicit Rel.AI repository objective.</div>';
    return;
  }
  const visible = sessions.slice(0, visibleCountFor(scopeKey));
  const remaining = Math.max(0, sessions.length - visible.length);
  body.innerHTML = visible.map(sessionRow).join('') + (remaining
    ? `<div class="session-list-footer"><span>${remaining} older work session${remaining === 1 ? '' : 's'} hidden</span><button class="secondary" type="button" data-load-more-sessions>Show ${Math.min(SESSION_PAGE_SIZE, remaining)} more</button></div>`
    : '');
}

function visibleCountFor(scopeKey) {
  return Math.max(SESSION_PAGE_SIZE, Number(visibleCounts.get(scopeKey) || SESSION_PAGE_SIZE));
}

function sessionRow(session) {
  const id = sessionIdentifier(session);
  const state = workSessionStateView(session);
  const live = isOngoingSession(session);
  const status = state.label;
  const workspace = session.workspace || 'workspace';
  const validation = validationLabel(session.validation);
  const operation = session.currentActivity || session.operation || operationForTool(session.lastTool);
  const timing = timingHtml(session, live);
  const calls = Number(session.toolCallCount ?? session.calls ?? 0);
  const warnings = session.status === 'completed'
    ? Number(session.failedToolCallCount ?? session.failures ?? 0)
    : 0;
  const warningText = warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : '';
  const activity = Number(session.activeCalls || 0) > 0
    ? `${session.activeCalls || 0} active · ${calls} total calls`
    : live
      ? `No active call · ${calls} total calls`
      : `${calls} total calls${warningText}`;
  const publish = publishLabel(session);

  return `
    <button class="task-row" type="button" data-task-id="${esc(id)}">
      <span class="task-row-status">${statusPill(status, state.pillClass)}</span>
      <span class="task-row-main">
        <strong>${esc(session.title || operation)}</strong>
        <span class="task-row-id">Work session ID <code>${esc(id || 'unknown')}</code></span>
        <span>${esc(workspace)} · ${esc(session.currentStage || operation)} · ${activity} · ${session.changedFileCount || 0} file${session.changedFileCount === 1 ? '' : 's'} changed · ${validation}</span>
        ${taskProgressHtml(session.progress, session.status, { compact: true })}
      </span>
      ${publish ? `<span class="task-row-publish">${publish}</span>` : ''}
      <span class="task-row-time">${timing}</span>
      <span aria-hidden="true">›</span>
    </button>`;
}

function statusPill(status, classOverride = '') {
  return pillHtml(status, classOverride);
}

function timingHtml(session, live) {
  if (live) {
    const start = session.startedAt || session.createdAt || '';
    return `<span data-clock-elapsed-start="${esc(start)}">${esc(formatDuration(session.durationMs) || '0s')}</span>`;
  }
  const end = session.endedAt || session.completedAt || '';
  return `<span data-clock-relative="${esc(end)}">${esc(timeAgo(end) || 'now')}</span>`;
}

function validationLabel(validation) {
  if (validation === 'passed') return 'validation passed';
  if (validation === 'failed') return 'validation failed';
  if (validation === 'not_required') return 'validation not required';
  return 'validation not run';
}

function publishLabel(session) {
  if (session.pushed) return 'Pushed';
  if (session.committed) return 'Committed';
  if (session.prDrafted) return 'PR drafted';
  return '';
}

function openSession(session) {
  if (!session) return;
  const content = document.createElement('div');
  content.className = 'detail-stack session-detail';
  const operations = currentOperations(session);
  const endMeaning = sessionMeaning(session.status);
  const identities = taskEntityView(session);
  const recovery = recoveryStateView(session);
  const state = workSessionStateView(session);

  content.innerHTML = `
    <header class="task-detail-header">
      <div><span class="overview-kicker">Work session</span><h2>${esc(session.title || session.operation || operationForTool(session.lastTool))}</h2>${session.objective ? `<p>${esc(session.objective)}</p>` : ''}</div>
      ${statusPill(state.label, state.pillClass)}
    </header>
    ${taskProgressHtml(session.progress, session.status)}
    <div class="task-detail-current"><strong>${esc(session.currentStage || 'Current stage unavailable')}</strong><span>${esc(session.currentActivity || session.operation || 'No current activity recorded.')}</span></div>
    ${recovery ? `<div class="connection-notice ${esc(recovery.tone)}"><strong>${esc(recovery.title)}</strong><div>${esc(recovery.message)}</div><div>${esc(recovery.action)}</div></div>` : ''}
    <div class="task-detail-grid">
      ${detail('Workspace', session.workspace || '—')}
      ${identifierDetail('Work session ID', identities.logicalTaskId || '—')}
      ${identities.nativeTaskId ? identifierDetail('Native task ID', identities.nativeTaskId) : ''}
      ${identities.processId ? identifierDetail('Process ID', identities.processId) : ''}
      ${session.correlation?.requestId ? identifierDetail('Request ID', session.correlation.requestId) : ''}
      ${session.correlation?.traceId ? identifierDetail('Trace ID', session.correlation.traceId) : ''}
      ${session.correlation?.conversationId ? identifierDetail('Conversation ID', session.correlation.conversationId) : ''}
      ${detail('Work-session state', state.label)}
      ${detail('Current operation', session.operation || operationForTool(session.lastTool))}
      ${clockDetail('Duration', session.startedAt || session.createdAt, session.endedAt || session.completedAt, session.durationMs)}
      ${detail('Tool calls', session.toolCallCount ?? session.calls)}
      ${detail('Currently active', session.activeCalls || 0)}
      ${detail('Failures', session.failures)}
      ${detail('Validation', session.validation)}
      ${detail('End reason', session.endReason || 'still open')}
      ${detail('Completion confirmed', session.completionKnown ? 'Yes' : 'No')}
    </div>
    <div class="connection-notice session-meaning"><strong>What this state means</strong><div>${esc(endMeaning)}</div></div>
    ${session.summary ? `<section class="task-detail-section"><h3>Completion summary</h3><p>${esc(session.summary)}</p></section>` : ''}
    ${operations}
    ${changedFilesSection(session.changedFiles || [])}
    ${toolEventsSection(session.events || [], session)}
    <div class="session-detail-actions"><a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace, task: sessionIdentifier(session) })}">Open in Activity</a></div>`;
  for (const link of content.querySelectorAll('[data-task-event-link], .session-detail-actions a')) {
    link.addEventListener('click', closeDrawer);
  }
  bindCopyActions(content);
  const id = sessionIdentifier(session);
  openDrawer({ title: session.title || `Work session ${id ? id.slice(0, 8) : 'unknown'}`, content, panelClass: 'session-detail-drawer' });
}

function changedFilesSection(files) {
  const ordered = orderChangedFiles(files);
  if (!ordered.length) return '<section class="task-detail-section"><h3>Changed files</h3><div class="muted">No changed files recorded.</div></section>';
  const visible = ordered.slice(0, DETAIL_FILE_PREVIEW);
  const hidden = ordered.slice(DETAIL_FILE_PREVIEW);
  return `<section class="task-detail-section">
    <div class="task-detail-heading"><h3>Changed files</h3><span>${ordered.length}</span></div>
    ${fileList(visible)}
    ${hidden.length ? `<details class="task-detail-overflow"><summary>Show ${hidden.length} more file${hidden.length === 1 ? '' : 's'}</summary>${fileList(hidden)}</details>` : ''}
  </section>`;
}

function fileList(files) {
  return `<ul class="task-file-list">${files.map(file => `<li><code>${esc(file)}</code></li>`).join('')}</ul>`;
}

function toolEventsSection(events, session) {
  if (!events.length) return '<section class="task-detail-section"><h3>Tool events</h3><div class="muted">No persisted events.</div></section>';
  const ordered = orderSessionEvents(events);
  const visible = ordered.slice(0, DETAIL_EVENT_PREVIEW);
  const hidden = ordered.slice(DETAIL_EVENT_PREVIEW);
  return `<section class="task-detail-section">
    <div class="task-detail-heading"><h3>Tool events</h3><span>${events.length}</span></div>
    <div class="task-event-list">${visible.map(event => eventRow(event, session)).join('')}</div>
    ${hidden.length ? `<details class="task-detail-overflow"><summary>Show ${hidden.length} older event${hidden.length === 1 ? '' : 's'}</summary><div class="task-event-list">${hidden.map(event => eventRow(event, session)).join('')}</div></details>` : ''}
  </section>`;
}

export function orderSessionsForDisplay(sessions = []) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
    const ongoingDifference = Number(isOngoingSession(right)) - Number(isOngoingSession(left));
    if (ongoingDifference) return ongoingDifference;
    const timestampDifference = sessionTimestamp(right) - sessionTimestamp(left);
    if (timestampDifference) return timestampDifference;
    return sessionIdentifier(left).localeCompare(sessionIdentifier(right), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

function sessionIdentifier(session = {}) {
  return String(session.id || session.taskId || session.work_id || '').trim();
}

function isOngoingSession(session) {
  const state = workSessionStateView(session);
  return !state.terminal && state.status !== 'unknown';
}

export function orderChangedFiles(files = []) {
  return [...new Set((Array.isArray(files) ? files : []).map(String).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' }));
}

export function orderSessionEvents(events = []) {
  return [...events].sort((left, right) => eventTimestamp(right) - eventTimestamp(left));
}

function sessionTimestamp(session) {
  const timestamp = Date.parse(session?.endedAt || session?.completedAt || session?.lastActivityAt || session?.startedAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventTimestamp(event) {
  const timestamp = Date.parse(event?.timestamp || event?.ts || event?.at || event?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionMeaning(status) {
  if (status === 'running' || status === 'working') return 'A Rel.AI tool operation is executing within this repository work session.';
  if (status === 'validating') return 'Rel.AI is validating repository changes for this work session.';
  if (status === 'waiting_for_approval') return 'The work session is paused until the required approval is provided.';
  if (status === 'blocked') return 'The work session cannot continue until the reported blocker is resolved.';
  if (status === 'validation_failed') return 'Validation failed. The work session remains open for repair and another validation run.';
  if (status === 'queued' || status === 'planning' || status === 'waiting' || status === 'settling') return 'This work session remains open, but no Rel.AI tool operation is executing now.';
  if (status === 'completed') return 'Work-session completion was explicitly reported. A managed process started earlier may still be running independently.';
  if (status === 'failed' || status === 'attention') return 'The work session ended after a failure. Review the failed activity and normalized error.';
  if (status === 'expired' || status === 'inactive') return 'The work session expired after inactivity and is no longer active.';
  if (status === 'cancelled') return 'The work session was cancelled before completion was reported.';
  return 'The work-session state is unavailable or unrecognized.';
}

function currentOperations(session) {
  const executable = ['running', 'validating', 'working'].includes(String(session?.status || '')) && Number(session?.activeCalls || 0) > 0;
  const operations = executable && Array.isArray(session.currentOperations) ? session.currentOperations : [];
  if (!operations.length) return '';
  return `<section class="task-detail-section"><div class="task-detail-heading"><h3>Running operations</h3><span>${operations.length}</span></div><div class="task-event-list">${operations.map(operation => `
    <div class="task-event"><span data-clock-elapsed-start="${esc(operation.startedAt || '')}">${formatDuration(Date.now() - Number(operation.startedAt || Date.now()))}</span><code>${esc(operation.label || operation.tool || 'operation')}</code>${pillHtml('running')}</div>`).join('')}</div></section>`;
}

function detail(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function identifierDetail(label, value) {
  return `<div><span>${esc(label)}</span><strong class="task-detail-identifier"><code>${esc(value)}</code><button class="runtime-copy-id" type="button" data-copy-value="${esc(value)}" aria-label="Copy ${esc(label)} ${esc(value)}">Copy</button></strong></div>`;
}

function clockDetail(label, start, end, durationMs) {
  const endAttribute = end ? ` data-clock-elapsed-end="${esc(end)}"` : '';
  return `<div><span>${esc(label)}</span><strong class="task-detail-clock" data-clock-elapsed-start="${esc(start || '')}"${endAttribute}>${esc(formatDuration(durationMs))}</strong></div>`;
}

function eventRow(event, session) {
  const operation = event.title || event.tool?.operation || event.operation || operationForTool(event.tool?.name || event.tool);
  const href = routeHref('activity', {
    workspace: event.workspace || session.workspace,
    task: event.taskId || sessionIdentifier(session),
    event: activityEventId(event),
    time: 'all'
  });
  const timestamp = event.timestamp || event.ts || event.at || event.createdAt || '';
  const status = event.status || (event.ok === false ? 'failed' : 'succeeded');
  return `<a class="task-event task-event-link" data-task-event-link href="${esc(href)}" aria-label="Open ${esc(operation)} event in Activity"><span data-clock-relative="${esc(timestamp)}">${esc(timeAgo(timestamp))}</span><span class="task-event-copy"><code title="${esc(event.tool?.name || event.tool || '')}">${esc(operation)}</code>${event.summary ? `<small>${esc(event.summary)}</small>` : ''}</span>${pillHtml(status)}</a>`;
}

function operationForTool(tool) {
  const value = String(tool || '').replace(/^relai_/, '').replaceAll('_', ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Rel.AI activity';
}
