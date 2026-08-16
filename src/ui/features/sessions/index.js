import { fetchJson } from '../../api.js';
import { closeDrawer, openDrawer } from '../../components/drawer.js';
import { copyText } from '../../clipboard.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';
import { getRouteParams, getWorkspaceFilter, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { bindWorkspaceMenus, workspaceMenuHtml } from '../../components/workspace-menu.js';
import { taskProgressHtml } from '../../components/task-progress.js';
import { eventTimestampMs, eventTimestampValue, terminalTaskTimestamp, terminalTaskTimestampValue } from '../../../taskEvents.js';
import { taskEntityView, workSessionStateView } from '../../task-identity.js';

const SESSION_PAGE_SIZE = 50;
const TASK_SESSION_URL = '/api/tasks/session';
const DETAIL_FILE_PREVIEW = 12;
const DETAIL_EVENT_PREVIEW = 8;
const visibleCounts = new Map();
let _sessionsById = new Map();
let _requestedSessionId = '';
let _openedRequestedSession = false;

export function mountTasks(container, data = {}) {
  const workspace = getWorkspaceFilter();
  const sessions = sessionsForDisplay(data, workspace);
  const scopeKey = workspace || '__all__';
  syncSessionIndex(sessions);
  syncRequestedSession(sessions, scopeKey);

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section sessions-page';
  root.innerHTML = `
    <div class="feature-toolbar sessions-toolbar">
      <div class="sessions-summary-line" data-session-summary>${esc(sessionSummary(sessions))}</div>
      <div class="section-head-actions">
        ${workspaceMenuHtml(data.config?.workspaces || [], workspace, { id: 'sessionsWorkspaceMenu' })}
        <span class="feature-count">${esc(sessionCountLabel(sessions, workspace))}</span>
      </div>
    </div>`;

  const card = document.createElement('section');
  card.className = 'card sessions-history-card';
  card.innerHTML = '<div class="card-head"><div><h3>Recent tasks</h3></div><div class="card-head-actions"><a class="section-action" href="#activity">Activity</a><a class="section-action" href="#diagnostics">Troubleshooting</a></div></div>';
  const body = document.createElement('div');
  body.className = 'card-body task-list';
  renderSessionRows(body, sessions, scopeKey);
  body.addEventListener('click', event => {
    const loadMore = event.target.closest('[data-load-more-sessions]');
    if (loadMore) {
      visibleCounts.set(scopeKey, visibleCountFor(scopeKey) + SESSION_PAGE_SIZE);
      renderSessionRows(body, [..._sessionsById.values()], scopeKey);
      return;
    }
    const button = event.target.closest('[data-task-id]');
    if (!button) return;
    void openSession(_sessionsById.get(button.dataset.taskId));
  });
  card.appendChild(body);
  root.appendChild(card);
  container.appendChild(root);
  bindWorkspaceMenus(root);
  bindCopyActions(root);
  maybeOpenRequestedSession();
}

export function updateTaskSessions(container, data = {}) {
  const current = container.querySelector('.sessions-page');
  if (!current) return false;
  const workspace = getWorkspaceFilter();
  const sessions = sessionsForDisplay(data, workspace);
  const scopeKey = workspace || '__all__';
  syncSessionIndex(sessions);
  syncRequestedSession(sessions, scopeKey);

  const count = current.querySelector('.feature-count');
  const countText = sessionCountLabel(sessions, workspace);
  if (count && count.textContent !== countText) count.textContent = countText;
  const summary = current.querySelector('[data-session-summary]');
  const summaryText = sessionSummary(sessions);
  if (summary && summary.textContent !== summaryText) summary.textContent = summaryText;

  const body = current.querySelector('.task-list');
  if (body) reconcileSessionRows(body, sessions, scopeKey);
  maybeOpenRequestedSession();
  return true;
}

function sessionsForDisplay(data, workspace) {
  return orderSessionsForDisplay((Array.isArray(data?.tasks) ? data.tasks : [])
    .filter(session => !workspace || session.workspace === workspace));
}

function syncSessionIndex(sessions) {
  _sessionsById = new Map(sessions.map(session => [sessionIdentifier(session), session]).filter(([id]) => id));
}

function syncRequestedSession(sessions, scopeKey) {
  const requested = String(getRouteParams().get('task') || '').trim();
  if (requested !== _requestedSessionId) {
    _requestedSessionId = requested;
    _openedRequestedSession = false;
  }
  if (!requested) return;
  const index = sessions.findIndex(session => sessionIdentifier(session) === requested);
  if (index >= 0 && index >= visibleCountFor(scopeKey)) visibleCounts.set(scopeKey, index + 1);
}

function maybeOpenRequestedSession() {
  if (!_requestedSessionId || _openedRequestedSession) return;
  const session = _sessionsById.get(_requestedSessionId);
  if (!session) return;
  _openedRequestedSession = true;
  void openSession(session);
}

export function sessionSummary(sessions) {
  const counts = sessions.reduce((summary, session) => {
    const state = workSessionStateView(session);
    if (state.active) summary.active += 1;
    else if (state.open) summary.open += 1;
    else if (['waiting_for_approval', 'blocked', 'validation_failed'].includes(state.status)) summary.attention += 1;
    else if (state.status === 'inactive') summary.inactive += 1;
    else if (state.status === 'completed') summary.completed += 1;
    else if (state.status === 'cancelled') summary.cancelled += 1;
    else if (state.status === 'failed') summary.failed += 1;
    else summary.other += 1;
    return summary;
  }, { active: 0, open: 0, attention: 0, inactive: 0, completed: 0, cancelled: 0, failed: 0, other: 0 });

  const parts = [`${counts.active} active`, `${counts.open} open`];
  if (counts.attention) parts.push(`${counts.attention} need attention`);
  if (counts.inactive) parts.push(`${counts.inactive} inactive`);
  parts.push(`${counts.completed} completed`);
  if (counts.cancelled) parts.push(`${counts.cancelled} cancelled`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.other) parts.push(`${counts.other} other`);
  return parts.join(' · ');
}

function sessionCountLabel(sessions, workspace) {
  return `${sessions.length} task${sessions.length === 1 ? '' : 's'}${workspace ? ` in ${workspace}` : ''}`;
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

function renderSessionRows(body, sessions, scopeKey) {
  if (!sessions.length) {
    body.innerHTML = '<div class="empty">No tasks yet.</div>';
    return;
  }
  const visible = sessions.slice(0, visibleCountFor(scopeKey));
  const remaining = Math.max(0, sessions.length - visible.length);
  body.innerHTML = visible.map(sessionRow).join('') + sessionFooterHtml(remaining);
}

function reconcileSessionRows(body, sessions, scopeKey) {
  if (!sessions.length) {
    if (!body.querySelector('.empty') || body.querySelectorAll('[data-task-id]').length) body.innerHTML = '<div class="empty">No tasks yet.</div>';
    return;
  }
  body.querySelector('.empty')?.remove();
  const visible = sessions.slice(0, visibleCountFor(scopeKey));
  const visibleIds = new Set(visible.map(sessionIdentifier));
  const existing = new Map([...body.querySelectorAll('[data-task-id]')].map(node => [node.dataset.taskId, node]));

  for (let index = 0; index < visible.length; index += 1) {
    const session = visible[index];
    const id = sessionIdentifier(session);
    const fingerprint = sessionFingerprint(session);
    let node = existing.get(id);
    if (!node || node.dataset.sessionFingerprint !== fingerprint) {
      const replacement = createSessionRowNode(session);
      if (node) node.replaceWith(replacement);
      node = replacement;
    }
    const currentAtIndex = body.children[index];
    if (node !== currentAtIndex) body.insertBefore(node, currentAtIndex || body.querySelector('.session-list-footer'));
  }

  for (const [id, node] of existing) {
    if (!visibleIds.has(id)) node.remove();
  }

  const remaining = Math.max(0, sessions.length - visible.length);
  syncSessionFooter(body, remaining);
}

function createSessionRowNode(session) {
  const template = document.createElement('template');
  template.innerHTML = sessionRow(session).trim();
  return template.content.firstElementChild;
}

function syncSessionFooter(body, remaining) {
  let footer = body.querySelector('.session-list-footer');
  if (!remaining) {
    footer?.remove();
    return;
  }
  const next = sessionFooterHtml(remaining);
  if (!footer) {
    body.insertAdjacentHTML('beforeend', next);
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = next;
  const replacement = template.content.firstElementChild;
  if (!footer.isEqualNode(replacement)) footer.replaceWith(replacement);
}

function sessionFooterHtml(remaining) {
  return remaining
    ? `<div class="session-list-footer"><span>${remaining} older session${remaining === 1 ? '' : 's'} hidden</span><button class="secondary" type="button" data-load-more-sessions>Show ${Math.min(SESSION_PAGE_SIZE, remaining)} more</button></div>`
    : '';
}

function visibleCountFor(scopeKey) {
  return Math.max(SESSION_PAGE_SIZE, Number(visibleCounts.get(scopeKey) || SESSION_PAGE_SIZE));
}

function sessionRow(session) {
  const id = sessionIdentifier(session);
  const state = workSessionStateView(session);
  const live = isOngoingSession(session);
  const operation = session.currentActivity || session.operation || operationForTool(session.lastTool);
  const description = sessionDescription(session, live, operation);
  const facts = sessionFacts(session, live);
  const progress = live && session.progress ? taskProgressHtml(session.progress, session.status, { compact: true }) : '';

  return `
    <button class="task-row" type="button" data-task-id="${esc(id)}" data-session-fingerprint="${esc(sessionFingerprint(session))}">
      <span class="task-row-status">${statusPill(state.label, state.pillClass)}</span>
      <span class="task-row-main">
        <strong>${esc(session.title || operation)}</strong>
        <span class="task-row-description">${esc(session.workspace || 'project')} · ${esc(description)}</span>
        ${facts ? `<span class="task-row-facts">${esc(facts)}</span>` : ''}
        ${progress}
      </span>
      <span class="task-row-time">${timingHtml(session, live)}</span>
      <span aria-hidden="true">›</span>
    </button>`;
}

function sessionDescription(session, live, operation) {
  if (live) return session.currentActivity || session.currentStage || operation || 'Ready for the next step';
  if (session.summary) return session.summary;
  if (session.status === 'validation_failed') return 'Checks failed';
  if (session.status === 'blocked') return session.endReason || 'Blocked';
  if (session.status === 'cancelled') return 'Cancelled before completion';
  return session.currentActivity || session.currentStage || operation || 'Task ended';
}

function sessionFacts(session, live) {
  const facts = [];
  const toolCalls = Number(session.toolCallCount ?? session.calls ?? 0);
  const changed = Number(session.changedFileCount || session.changedFiles?.length || 0);
  const failures = Number(session.failedToolCallCount ?? session.failures ?? 0);
  const completed = workSessionStateView(session).status === 'completed';
  facts.push(`${toolCalls} action${toolCalls === 1 ? '' : 's'}`);
  facts.push(`${changed} file${changed === 1 ? '' : 's'} edited`);
  if (failures > 0) facts.push(completed
    ? `${failures} recovered failed action${failures === 1 ? '' : 's'}`
    : `${failures} failed action${failures === 1 ? '' : 's'}`);
  if (session.validation === 'failed' || session.status === 'validation_failed') facts.push('checks failed');
  if (session.status === 'waiting_for_approval') facts.push('approval required');
  if (session.status === 'blocked') facts.push('blocked');
  const publish = publishLabel(session);
  if (!live && publish) facts.push(publish.toLowerCase());
  return facts.join(' · ');
}

function sessionFingerprint(session) {
  const live = isOngoingSession(session);
  const state = workSessionStateView(session);
  const terminalDuration = live ? '' : sessionDurationMs(session);
  return JSON.stringify([
    state.status,
    state.label,
    session.title || '',
    session.workspace || '',
    session.currentStage || '',
    session.currentActivity || '',
    session.operation || '',
    session.summary || '',
    session.progress || null,
    Number(session.activeCalls || 0),
    Number(session.toolCallCount ?? session.calls ?? 0),
    Number(session.changedFileCount || session.changedFiles?.length || 0),
    Number(session.failedToolCallCount ?? session.failures ?? 0),
    session.validation || '',
    session.status || '',
    session.pushed === true,
    session.committed === true,
    session.prDrafted === true,
    terminalDuration
  ]);
}

function statusPill(status, classOverride = '') {
  return pillHtml(status, classOverride);
}

function timingHtml(session, live) {
  if (live) {
    const start = session.startedAt || session.createdAt || '';
    return `<span data-clock-elapsed-start="${esc(start)}">${esc(formatDuration(sessionDurationMs(session), { live: true }) || '0s')}</span>`;
  }
  const end = terminalTaskTimestampValue(session);
  const relative = timeAgo(end);
  return `<span${relative ? ` title="Ended ${esc(relative)}"` : ''}>${esc(formatDuration(sessionDurationMs(session), { historical: true }))}</span>`;
}

function sessionDurationMs(session) {
  const explicit = Number(session?.durationMs);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const start = Date.parse(String(session?.startedAt || session?.createdAt || ''));
  if (!Number.isFinite(start)) return 0;
  const endValue = terminalTaskTimestampValue(session);
  const parsedEnd = Date.parse(String(endValue || ''));
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
  return Math.max(0, end - start);
}

function publishLabel(session) {
  if (session.pushed) return 'Pushed';
  if (session.committed) return 'Committed';
  if (session.prDrafted) return 'PR drafted';
  return '';
}

async function openSession(session) {
  if (!session) return;
  session = await loadSessionDetail(session);
  const content = document.createElement('div');
  content.className = 'detail-stack session-detail';
  const identities = taskEntityView(session);
  const state = workSessionStateView(session);
  const live = isOngoingSession(session);
  const operationValue = session.operation || operationForTool(session.lastTool) || '—';
  const currentTitle = live ? (session.currentStage || state.label) : state.label;
  const currentCopy = live
    ? (session.currentActivity || operationValue || 'Ready for the next step.')
    : (session.summary || session.endReason || sessionDescription(session, false, operationValue));

  content.innerHTML = `
    <header class="task-detail-header">
      <div><span class="overview-kicker">Task</span><h2>${esc(session.title || operationValue)}</h2>${session.objective ? `<p>${esc(session.objective)}</p>` : ''}</div>
      ${statusPill(state.label, state.pillClass)}
    </header>
    ${live && session.progress ? taskProgressHtml(session.progress, session.status) : ''}
    <div class="task-detail-current${sessionNeedsAttention(session) ? ' attention' : ''}"><strong>${esc(currentTitle)}</strong><span>${esc(currentCopy)}</span></div>
    <div class="task-detail-grid task-detail-facts">
      ${detail('Project', session.workspace || '—')}
      ${durationDetail(session, live)}
      ${detail('Actions', session.toolCallCount ?? session.calls ?? 0)}
      ${detail('Files changed', session.changedFileCount || session.changedFiles?.length || 0)}
    </div>
    ${attentionSection(session)}
    ${sessionActionSection(session)}
    ${failureHistorySection(session)}
    ${currentOperations(session)}
    ${changedFilesSection(session.changedFiles || [])}
    ${toolEventsSection(session.events || [], session)}
    ${technicalDetailsSection(session, identities, state, operationValue)}
    <div class="session-detail-actions"><a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace, task: sessionIdentifier(session), time: 'all' })}">Open in Activity</a></div>`;

  for (const link of content.querySelectorAll('[data-task-event-link], .session-detail-actions a')) link.addEventListener('click', closeDrawer);
  bindCopyActions(content);
  const id = sessionIdentifier(session);
  openDrawer({ title: session.title || `Task ${id ? id.slice(0, 8) : 'unknown'}`, content, panelClass: 'session-detail-drawer' });
}

async function loadSessionDetail(session) {
  const id = sessionIdentifier(session);
  if (!id || Array.isArray(session.events)) return session;
  try {
    const response = await fetchJson(TASK_SESSION_URL + "?task=" + encodeURIComponent(id), { cache: 'no-store' });
    return response?.ok !== false && response?.session ? response.session : session;
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), { variant: 'error' });
    return session;
  }
}

function durationDetail(session, live) {
  if (!live) return detail('Duration', formatDuration(sessionDurationMs(session), { historical: true }));
  const start = session.startedAt || session.createdAt || '';
  return `<div><span>Duration</span><strong class="task-detail-clock" data-clock-elapsed-start="${esc(start)}">${esc(formatDuration(sessionDurationMs(session), { live: true }))}</strong></div>`;
}

function sessionNeedsAttention(session) {
  if (workSessionStateView(session).status === 'completed') return false;
  return session.sandboxRecovery?.state === 'conflict'
    || session.validation === 'failed'
    || ['failed', 'validation_failed', 'blocked'].includes(String(session.status || ''));
}

function attentionSection(session) {
  if (!sessionNeedsAttention(session)) return '';
  const items = [];
  const failures = Number(session.failures || session.failedToolCallCount || 0);
  if (failures) items.push(`${failures} action${failures === 1 ? '' : 's'} failed`);
  if (session.validation === 'failed' || session.status === 'validation_failed') items.push('Checks failed');
  const recovery = session.sandboxRecovery?.state === 'conflict' ? session.sandboxRecovery : null;
  if (recovery) {
    items.push(recovery.message || 'Private task changes conflict with newer visible workspace changes.');
    const paths = Array.isArray(recovery.changedFiles) ? recovery.changedFiles.slice(0, 8) : [];
    if (paths.length) items.push(`Conflicting files: ${paths.join(', ')}`);
  }
  if (session.status === 'blocked' && !recovery) items.push(session.endReason || 'Task is blocked');
  if (session.status === 'failed') items.push(session.endReason || 'The task ended with an unresolved problem');
  return `<section class="task-detail-section task-detail-problems"><h3>Needs attention</h3><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul></section>`;
}

function sessionActionSection(session) {
  if (session.status !== 'waiting_for_approval') return '';
  return '<section class="task-detail-section task-detail-action"><h3>Action required</h3><p>Approval is required before work can continue.</p></section>';
}

function failureHistorySection(session) {
  const failures = Number(session.failures || session.failedToolCallCount || 0);
  if (!failures || sessionNeedsAttention(session)) return '';
  const completed = workSessionStateView(session).status === 'completed';
  const callLabel = `${failures} action${failures === 1 ? '' : 's'}`;
  const title = completed ? 'Recovered during task' : 'Earlier failed actions';
  const copy = completed
    ? `${callLabel} failed earlier, but the task later completed. The failures remain visible in Activity.`
    : `${callLabel} failed earlier. They remain visible in Activity and do not change the task's current status.`;
  return `<section class="task-detail-section task-detail-history"><h3>${esc(title)}</h3><p>${esc(copy)}</p></section>`;
}

function technicalDetailsSection(session, identities, state, operationValue) {
  const workflow = workflowTechnicalHtml(session);
  return `<details class="task-detail-technical">
    <summary>Technical details</summary>
    <div class="task-detail-grid">
      ${identifierDetail('Work session ID', identities.logicalTaskId || sessionIdentifier(session) || '—')}
      ${identities.processId ? identifierDetail('Process ID', identities.processId) : ''}
      ${session.correlation?.requestId ? identifierDetail('Request ID', session.correlation.requestId) : ''}
      ${session.correlation?.traceId ? identifierDetail('Trace ID', session.correlation.traceId) : ''}
      ${session.correlation?.conversationId ? identifierDetail('Conversation ID', session.correlation.conversationId) : ''}
      ${detail('State', state.label)}
      ${detail('Last operation', operationValue)}
      ${detail('Validation', session.validation || 'not run')}
      ${detail('End reason', session.endReason || (state.terminal ? 'completed' : 'still open'))}
      ${detail('Completion confirmed', session.completionKnown ? 'Yes' : 'No')}
    </div>
    ${workflow}
  </details>`;
}

function workflowTechnicalHtml(session = {}) {
  const workflow = session.workflow;
  if (!workflow || typeof workflow !== 'object' || !workflow.stage) return '';
  const next = workflow.recommendedAction || 'No additional advisory action is recorded.';
  return `<div class="task-detail-workflow"><strong>Workflow ${esc(workflow.stage)}</strong><span>${esc(next)}</span></div>`;
}

function changedFilesSection(files) {
  const ordered = orderChangedFiles(files);
  if (!ordered.length) return '';
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
  if (!events.length) return '';
  const ordered = orderSessionEvents(events);
  const visible = ordered.slice(0, DETAIL_EVENT_PREVIEW);
  const hidden = ordered.slice(DETAIL_EVENT_PREVIEW);
  return `<section class="task-detail-section">
    <div class="task-detail-heading"><h3>Recent activity</h3><span>${events.length}</span></div>
    <div class="task-event-list">${visible.map(event => eventRow(event, session)).join('')}</div>
    ${hidden.length ? `<details class="task-detail-overflow"><summary>Show ${hidden.length} older event${hidden.length === 1 ? '' : 's'}</summary><div class="task-event-list">${hidden.map(event => eventRow(event, session)).join('')}</div></details>` : ''}
  </section>`;
}

export function orderSessionsForDisplay(sessions = []) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
    const ongoingDifference = Number(isOngoingSession(right)) - Number(isOngoingSession(left));
    if (ongoingDifference) return ongoingDifference;
    const timestampDifference = terminalTaskTimestamp(right) - terminalTaskTimestamp(left);
    if (timestampDifference) return timestampDifference;
    return sessionIdentifier(left).localeCompare(sessionIdentifier(right), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

function sessionIdentifier(session = {}) {
  return String(session.id || session.taskId || session.work_id || '').trim();
}

export function isOngoingSession(session) {
  const state = workSessionStateView(session);
  return state.active === true || state.open === true;
}

export function orderChangedFiles(files = []) {
  return [...new Set((Array.isArray(files) ? files : []).map(String).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' }));
}

export function orderSessionEvents(events = []) {
  return [...events].sort((left, right) => eventTimestampMs(right) - eventTimestampMs(left));
}

function currentOperations(session) {
  const executable = ['running', 'validating', 'working'].includes(String(session?.status || '')) && Number(session?.activeCalls || 0) > 0;
  const operations = executable && Array.isArray(session.currentOperations) ? session.currentOperations : [];
  if (!operations.length) return '';
  return `<section class="task-detail-section"><div class="task-detail-heading"><h3>Running operations</h3><span>${operations.length}</span></div><div class="task-event-list">${operations.map(operation => `
    <div class="task-event"><span data-clock-elapsed-start="${esc(operation.startedAt || '')}">${formatDuration(Date.now() - Number(operation.startedAt || Date.now()), { live: true })}</span><code>${esc(operation.label || operation.tool || 'operation')}</code>${pillHtml('running')}</div>`).join('')}</div></section>`;
}

function detail(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function identifierDetail(label, value) {
  return `<div><span>${esc(label)}</span><strong class="task-detail-identifier"><code>${esc(value)}</code><button class="runtime-copy-id" type="button" data-copy-value="${esc(value)}" aria-label="Copy ${esc(label)} ${esc(value)}">Copy</button></strong></div>`;
}

function eventRow(event, session) {
  const operation = event.title || event.tool?.operation || event.operation || operationForTool(event.tool?.name || event.tool);
  const href = routeHref('activity', {
    workspace: event.workspace || session.workspace,
    task: event.taskId || sessionIdentifier(session),
    event: activityEventId(event),
    time: 'all'
  });
  const timestamp = eventTimestampValue(event);
  const status = event.status || (event.ok === false ? 'failed' : 'succeeded');
  return `<a class="task-event task-event-link" data-task-event-link href="${esc(href)}" aria-label="Open ${esc(operation)} event in Activity"><span data-clock-relative="${esc(timestamp)}">${esc(timeAgo(timestamp))}</span><span class="task-event-copy"><code title="${esc(event.tool?.name || event.tool || '')}">${esc(operation)}</code>${event.summary ? `<small>${esc(event.summary)}</small>` : ''}</span>${pillHtml(status)}</a>`;
}

function operationForTool(tool) {
  const value = String(tool || '').replace(/^relai_/, '').replaceAll('_', ' ');
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Rel.AI activity';
}
