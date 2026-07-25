import { closeDrawer, openDrawer } from '../../components/drawer.js';
import { pillHtml } from '../../components/pill.js';
import { esc, metricHtml, timeAgo } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { bindWorkspaceMenus, workspaceMenuHtml } from '../../components/workspace-menu.js';

const SESSION_PAGE_SIZE = 50;
const DETAIL_FILE_PREVIEW = 12;
const DETAIL_EVENT_PREVIEW = 20;
const visibleCounts = new Map();

export function mountTasks(container, data = {}) {
  const workspace = getWorkspaceFilter();
  const sessions = orderSessionsForDisplay((Array.isArray(data.tasks) ? data.tasks : [])
    .filter(session => !workspace || session.workspace === workspace));
  const working = sessions.filter(session => session.status === 'working').length;
  const waiting = sessions.filter(session => session.status === 'waiting').length;
  const completed = sessions.filter(session => session.status === 'completed').length;
  const scopeKey = workspace || '__all__';

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section sessions-page';
  root.innerHTML = `
    <div class="feature-toolbar sessions-toolbar">
      <p>A waiting session has no active Rel.AI call. ChatGPT may still be reasoning, waiting for approval, or already finished.</p>
      <div class="section-head-actions">
        ${workspaceMenuHtml(data.config?.workspaces || [], workspace, { id: 'sessionsWorkspaceMenu' })}
        <span class="feature-count">${sessions.length} session${sessions.length === 1 ? '' : 's'}${workspace ? ` in ${esc(workspace)}` : ''}</span>
      </div>
    </div>
    <div class="overview-grid overview-grid-compact summary-metrics">
      ${metricHtml('Running now', working, 'tool calls currently executing', working ? 'blue' : 'good')}
      ${metricHtml('Waiting', waiting, 'no active Rel.AI call', waiting ? 'warn' : 'good')}
      ${metricHtml('Completed', completed, 'explicitly completed after validation', completed ? 'good' : 'blue')}
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
    body.innerHTML = '<div class="empty">Sessions appear when ChatGPT or the local dashboard calls a Rel.AI tool.</div>';
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
  const live = session.status === 'working' || session.status === 'waiting';
  const status = statusLabel(session.status);
  const workspace = session.workspace || 'workspace';
  const validation = validationLabel(session.validation);
  const operation = session.operation || operationForTool(session.lastTool);
  const timing = live
    ? formatDuration(session.durationMs)
    : timeAgo(session.endedAt || session.completedAt);
  const activity = session.status === 'working'
    ? `${session.activeCalls || 0} active · ${session.calls || 0} total calls`
    : session.status === 'waiting'
      ? `No active call · ${session.calls || 0} total calls`
      : `${session.calls || 0} total calls`;
  const publish = publishLabel(session);

  return `
    <button class="task-row" type="button" data-task-id="${esc(session.id)}">
      <span class="task-row-status">${statusPill(status)}</span>
      <span class="task-row-main">
        <strong>${esc(operation)}</strong>
        <span>${esc(workspace)} · ${activity} · ${session.changedFileCount || 0} file${session.changedFileCount === 1 ? '' : 's'} changed · ${validation}</span>
      </span>
      ${publish ? `<span class="task-row-publish">${publish}</span>` : ''}
      <span class="task-row-time">${esc(timing || 'now')}</span>
      <span aria-hidden="true">›</span>
    </button>`;
}

function statusLabel(status) {
  if (status === 'working') return 'working';
  if (status === 'waiting' || status === 'settling') return 'waiting';
  if (status === 'attention') return 'error';
  if (status === 'completed') return 'completed';
  return 'inactive';
}

function statusPill(status) {
  if (status === 'waiting') return '<span class="status-pill warn">waiting<span class="sr-only"> (warning)</span></span>';
  if (status === 'completed') return pillHtml('completed');
  if (status === 'inactive') return '<span class="status-pill">inactive<span class="sr-only"> (inactive)</span></span>';
  return pillHtml(status);
}

function validationLabel(validation) {
  if (validation === 'passed') return 'validation passed';
  if (validation === 'failed') return 'validation failed';
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
    <div class="task-detail-grid">
      ${detail('Workspace', session.workspace || '—')}
      ${detail('Observed state', statusLabel(session.status))}
      ${detail('Current operation', session.operation || operationForTool(session.lastTool))}
      ${detail('Duration', formatDuration(session.durationMs))}
      ${detail('Tool calls', session.calls)}
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
  openDrawer({ title: `Session ${session.id.slice(0, 8)}`, content, panelClass: 'session-detail-drawer' });
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
  return status === 'working' || status === 'waiting' || status === 'settling';
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
  const timestamp = Date.parse(event?.ts || event?.at || event?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionMeaning(status) {
  if (status === 'working') return 'A Rel.AI tool call is executing now.';
  if (status === 'waiting') return 'No Rel.AI tool call is active. This is not a claim that ChatGPT has finished the overall request.';
  if (status === 'completed') return 'ChatGPT explicitly reported completion after a successful final validation and no later code changes.';
  return 'This session became inactive after the grouping window elapsed. Overall ChatGPT task completion was not reported to Rel.AI.';
}

function currentOperations(session) {
  const operations = Array.isArray(session.currentOperations) ? session.currentOperations : [];
  if (!operations.length) return '';
  return `<section class="task-detail-section"><div class="task-detail-heading"><h3>Running operations</h3><span>${operations.length}</span></div><div class="task-event-list">${operations.map(operation => `
    <div class="task-event"><span>${formatDuration(Date.now() - Number(operation.startedAt || Date.now()))}</span><code>${esc(operation.label || operation.tool || 'operation')}</code>${pillHtml('working')}</div>`).join('')}</div></section>`;
}

function detail(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function eventRow(event, session) {
  const operation = event.operation || operationForTool(event.tool);
  const href = routeHref('activity', {
    workspace: event.workspace || session.workspace,
    task: event.taskId || session.id,
    event: activityEventId(event),
    time: 'all'
  });
  return `<a class="task-event task-event-link" data-task-event-link href="${esc(href)}" aria-label="Open ${esc(operation)} event in Activity"><span>${esc(timeAgo(event.ts))}</span><code title="${esc(event.tool || '')}">${esc(operation)}</code>${pillHtml(event.ok === false ? 'error' : 'ok')}</a>`;
}

function operationForTool(tool) {
  const value = String(tool || '').replace(/^relai_/, '').replaceAll('_', ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Rel.AI activity';
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
