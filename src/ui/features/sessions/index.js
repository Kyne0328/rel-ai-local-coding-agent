import { closeDrawer, openDrawer } from '../../components/drawer.js';
import { pillHtml } from '../../components/pill.js';
import { esc, formatDuration, metricHtml, timeAgo } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { bindWorkspaceMenus, workspaceMenuHtml } from '../../components/workspace-menu.js';
import { taskProgressHtml } from '../../components/task-progress.js';

const SESSION_PAGE_SIZE = 50;
const DETAIL_FILE_PREVIEW = 12;
const DETAIL_EVENT_PREVIEW = 20;
const visibleCounts = new Map();

export function mountTasks(container, data = {}) {
  const workspace = getWorkspaceFilter();
  const sessions = orderSessionsForDisplay((Array.isArray(data.tasks) ? data.tasks : [])
    .filter(session => !workspace || session.workspace === workspace));
  const working = sessions.filter(session => ['running', 'validating', 'working'].includes(session.status)).length;
  const open = sessions.filter(session => ['queued', 'planning', 'waiting_for_approval', 'blocked', 'waiting', 'settling'].includes(session.status)).length;
  const completed = sessions.filter(session => ['completed', 'completed_with_warnings'].includes(session.status)).length;
  const scopeKey = workspace || '__all__';

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section sessions-page';
  root.innerHTML = `
    <div class="feature-toolbar sessions-toolbar">
      <p>An open session is an explicit logical task with no Rel.AI tool call executing at this moment.</p>
      <div class="section-head-actions">
        ${workspaceMenuHtml(data.config?.workspaces || [], workspace, { id: 'sessionsWorkspaceMenu' })}
        <span class="feature-count">${sessions.length} session${sessions.length === 1 ? '' : 's'}${workspace ? ` in ${esc(workspace)}` : ''}</span>
      </div>
    </div>
    <div class="overview-grid overview-grid-compact summary-metrics">
      ${metricHtml('Running now', working, 'tool calls currently executing', working ? 'blue' : 'good')}
      ${metricHtml('Open', open, 'no tool call currently executing', open ? 'blue' : 'good')}
      ${metricHtml('Completed', completed, 'explicit completion reported', completed ? 'good' : 'blue')}
    </div>`;

  const card = document.createElement('section');
  card.className = 'card sessions-history-card';
  card.innerHTML = '<div class="card-head"><h3>Session history</h3><div class="card-head-actions"><a class="section-action" href="#activity">Open tool events</a><a class="section-action" href="#settings/diagnostics">History controls</a></div></div>';
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
    openSession(sessions.find(session => session.id === button.dataset.taskId));
  });
  card.appendChild(body);
  root.appendChild(card);
  container.appendChild(root);
  bindWorkspaceMenus(root);
}

function renderSessionRows(body, sessions, scopeKey) {
  if (!sessions.length) {
    body.innerHTML = '<div class="empty">Sessions appear when ChatGPT starts an explicit Rel.AI logical task.</div>';
    return;
  }
  const visible = sessions.slice(0, visibleCountFor(scopeKey));
  const remaining = Math.max(0, sessions.length - visible.length);
  body.innerHTML = visible.map(sessionRow).join('') + (remaining
    ? `<div class="session-list-footer"><span>${remaining} older session${remaining === 1 ? '' : 's'} hidden</span><button class="secondary" type="button" data-load-more-sessions>Show ${Math.min(SESSION_PAGE_SIZE, remaining)} more</button></div>`
    : '');
}

function visibleCountFor(scopeKey) {
  return Math.max(SESSION_PAGE_SIZE, Number(visibleCounts.get(scopeKey) || SESSION_PAGE_SIZE));
}

function sessionRow(session) {
  const live = isOngoingSession(session);
  const status = statusLabel(session.status);
  const workspace = session.workspace || 'workspace';
  const validation = validationLabel(session.validation);
  const operation = session.currentActivity || session.operation || operationForTool(session.lastTool);
  const timing = timingHtml(session, live);
  const calls = Number(session.toolCallCount ?? session.calls ?? 0);
  const activity = Number(session.activeCalls || 0) > 0
    ? `${session.activeCalls || 0} active · ${calls} total calls`
    : live
      ? `No active call · ${calls} total calls`
      : `${calls} total calls`;
  const publish = publishLabel(session);

  return `
    <button class="task-row" type="button" data-task-id="${esc(session.id)}">
      <span class="task-row-status">${statusPill(status)}</span>
      <span class="task-row-main">
        <strong>${esc(session.title || operation)}</strong>
        <span>${esc(workspace)} · ${esc(session.currentStage || operation)} · ${activity} · ${session.changedFileCount || 0} file${session.changedFileCount === 1 ? '' : 's'} changed · ${validation}</span>
        ${taskProgressHtml(session.progress, session.status, { compact: true })}
      </span>
      ${publish ? `<span class="task-row-publish">${publish}</span>` : ''}
      <span class="task-row-time">${timing}</span>
      <span aria-hidden="true">›</span>
    </button>`;
}

function statusLabel(status) {
  if (status === 'running' || status === 'working') return 'running';
  if (status === 'validating') return 'validating';
  if (status === 'queued' || status === 'planning' || status === 'waiting' || status === 'settling') return 'open';
  if (status === 'waiting_for_approval') return 'approval';
  if (status === 'blocked') return 'blocked';
  if (status === 'failed' || status === 'attention') return 'error';
  if (status === 'completed_with_warnings') return 'warning';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'unknown';
}

function statusPill(status) {
  if (status === 'open') return '<span class="status-pill open">open<span class="sr-only"> (open, no active call)</span></span>';
  if (status === 'completed') return pillHtml('completed');
  if (status === 'cancelled') return '<span class="status-pill incomplete">cancelled<span class="sr-only"> (completion not reported)</span></span>';
  return pillHtml(status);
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

  content.innerHTML = `
    <header class="task-detail-header">
      <div><span class="overview-kicker">Logical task</span><h2>${esc(session.title || session.operation || operationForTool(session.lastTool))}</h2>${session.objective ? `<p>${esc(session.objective)}</p>` : ''}</div>
      ${statusPill(statusLabel(session.status))}
    </header>
    ${taskProgressHtml(session.progress, session.status)}
    <div class="task-detail-current"><strong>${esc(session.currentStage || 'Current stage unavailable')}</strong><span>${esc(session.currentActivity || session.operation || 'No current activity recorded.')}</span></div>
    <div class="task-detail-grid">
      ${detail('Workspace', session.workspace || '—')}
      ${detail('Observed state', statusLabel(session.status))}
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
    <div class="session-detail-actions"><a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace, task: session.id })}">Open in Activity</a></div>`;
  for (const link of content.querySelectorAll('[data-task-event-link], .session-detail-actions a')) {
    link.addEventListener('click', closeDrawer);
  }
  openDrawer({ title: session.title || `Session ${session.id.slice(0, 8)}`, content, panelClass: 'session-detail-drawer' });
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
    return String(left?.id || '').localeCompare(String(right?.id || ''), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

function isOngoingSession(session) {
  const status = String(session?.status || '');
  return ['queued', 'planning', 'running', 'waiting_for_approval', 'blocked', 'validating', 'working', 'waiting', 'settling'].includes(status);
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
  if (status === 'running' || status === 'working') return 'A Rel.AI tool operation is executing now.';
  if (status === 'validating') return 'Rel.AI is running validation for this task.';
  if (status === 'waiting_for_approval') return 'The task is paused until the required approval is provided.';
  if (status === 'blocked') return 'The task cannot continue until the reported blocker is resolved.';
  if (status === 'queued' || status === 'planning' || status === 'waiting') return 'This logical task remains open, but no Rel.AI tool operation is executing now.';
  if (status === 'completed' || status === 'completed_with_warnings') return 'Task completion was explicitly reported; warnings remain visible when present.';
  if (status === 'failed') return 'The task ended after a failure. Review the failed activity and normalized error.';
  return 'The task was cancelled or expired before completion was reported.';
}

function currentOperations(session) {
  const operations = Array.isArray(session.currentOperations) ? session.currentOperations : [];
  if (!operations.length) return '';
  return `<section class="task-detail-section"><div class="task-detail-heading"><h3>Running operations</h3><span>${operations.length}</span></div><div class="task-event-list">${operations.map(operation => `
    <div class="task-event"><span data-clock-elapsed-start="${esc(operation.startedAt || '')}">${formatDuration(Date.now() - Number(operation.startedAt || Date.now()))}</span><code>${esc(operation.label || operation.tool || 'operation')}</code>${pillHtml('running')}</div>`).join('')}</div></section>`;
}

function detail(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function clockDetail(label, start, end, durationMs) {
  const endAttribute = end ? ` data-clock-elapsed-end="${esc(end)}"` : '';
  return `<div><span>${esc(label)}</span><strong class="task-detail-clock" data-clock-elapsed-start="${esc(start || '')}"${endAttribute}>${esc(formatDuration(durationMs))}</strong></div>`;
}

function eventRow(event, session) {
  const operation = event.title || event.tool?.operation || event.operation || operationForTool(event.tool?.name || event.tool);
  const href = routeHref('activity', {
    workspace: event.workspace || session.workspace,
    task: event.taskId || session.id,
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

