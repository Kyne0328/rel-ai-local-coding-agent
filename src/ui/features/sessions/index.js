import { fetchJson, postJson } from '../../api.js';
import { closeDrawer, openDrawer, updateDrawer } from '../../components/drawer.js';
import { copyText } from '../../clipboard.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';
import { getRouteParams, getWorkspaceFilter, routeHref } from '../../router.js';
import { activityEventId } from '../../activity-event.js';
import { bindWorkspaceMenus, workspaceMenuHtml } from '../../components/workspace-menu.js';
import { taskProgressHtml } from '../../components/task-progress.js';
import { eventTimestampMs, eventTimestampValue, terminalTaskTimestamp, terminalTaskTimestampValue } from '../../../taskEvents.js';
import { buildTaskSemanticProgress, classifyTaskChangedFiles } from '../../../taskSemanticProgress.js';
import { taskEntityView, workSessionStateView } from '../../task-identity.js';

const SESSION_PAGE_SIZE = 50;
const TASK_SESSION_URL = '/api/tasks/session';
const APPROVALS_URL = '/api/approvals';
const APPROVAL_DECISION_URL = '/api/approvals/decide';
const DETAIL_FILE_PREVIEW = 12;
const DETAIL_EVENT_PREVIEW = 8;
const visibleCounts = new Map();
let _sessionsById = new Map();
let _requestedSessionId = '';
let _openedRequestedSession = false;
let _openSessionId = '';
let _openSessionDetail = null;
let _openSessionFingerprint = '';
let _openSessionRequest = 0;

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
    </div>
    <div data-pending-approvals></div>`;

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
  void refreshPendingApprovals(root);
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
  syncSessionWorkspaceMenu(current, data.config?.workspaces || [], workspace);

  const body = current.querySelector('.task-list');
  if (body) reconcileSessionRows(body, sessions, scopeKey);
  refreshOpenSession(data);
  void refreshPendingApprovals(current);
  maybeOpenRequestedSession();
  return true;
}

async function refreshPendingApprovals(root) {
  const host = root.querySelector('[data-pending-approvals]');
  if (!host) return;
  const response = await fetchJson(APPROVALS_URL, { cache: 'no-store' });
  const approvals = response?.ok === true && Array.isArray(response.approvals) ? response.approvals : [];
  host.innerHTML = approvals.map(approvalCardHtml).join('');
  host.onclick = event => {
    const button = event.target.closest('[data-approval-decision]');
    if (!button) return;
    void decideDashboardApproval(button, root);
  };
}

function approvalCardHtml(approval) {
  const target = [approval.remote, approval.branch].filter(Boolean).join('/');
  const title = approval.operation === 'push' ? 'Push ready' : 'Approval required';
  const approveLabel = approval.operation === 'push' && approval.remote ? `Push to ${approval.remote}` : 'Approve';
  return `<section class="card" data-approval-card="${esc(approval.approvalId)}">
    <div class="card-head"><div><h3>${esc(title)}</h3><p>${esc(approval.message || 'Confirm this Rel.AI operation.')}</p></div></div>
    <div class="card-body">
      <div class="task-detail-grid">
        ${target ? `<div><span>Target</span><strong>${esc(target)}</strong></div>` : ''}
        ${approval.head ? `<div><span>Commit</span><code>${esc(String(approval.head).slice(0, 12))}</code></div>` : ''}
        ${approval.workspace ? `<div><span>Project</span><strong>${esc(approval.workspace)}</strong></div>` : ''}
      </div>
      <div class="section-head-actions">
        <button class="section-action" type="button" data-approval-decision="approve" data-approval-id="${esc(approval.approvalId)}">${esc(approveLabel)}</button>
        <button class="section-action" type="button" data-approval-decision="cancel" data-approval-id="${esc(approval.approvalId)}">Cancel</button>
      </div>
    </div>
  </section>`;
}

async function decideDashboardApproval(button, root) {
  const approvalId = String(button.dataset.approvalId || '').trim();
  if (!approvalId) return;
  const card = button.closest('[data-approval-card]');
  for (const control of card?.querySelectorAll('button') || []) control.disabled = true;
  const approved = button.dataset.approvalDecision === 'approve';
  const result = await postJson(APPROVAL_DECISION_URL, { approvalId, approved });
  if (result?.ok === false && result?.cancelled !== true) {
    toast(result.error || 'Rel.AI could not complete this approval.', { variant: 'error' });
    for (const control of card?.querySelectorAll('button') || []) control.disabled = false;
    return;
  }
  toast(approved ? 'Operation approved.' : 'Operation cancelled.');
  await refreshPendingApprovals(root);
}

function syncSessionWorkspaceMenu(current, workspaces, selected) {
  const existing = current.querySelector('[data-workspace-menu]');
  if (!existing) return;
  const template = document.createElement('template');
  template.innerHTML = workspaceMenuHtml(workspaces, selected, { id: 'sessionsWorkspaceMenu' }).trim();
  const next = template.content.firstElementChild;
  if (!next || existing.isEqualNode(next)) return;
  existing.replaceWith(next);
  bindWorkspaceMenus(current);
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
    ? `<div class="session-list-footer"><span>${remaining} older task${remaining === 1 ? '' : 's'} hidden</span><button class="secondary" type="button" data-load-more-sessions>Show ${Math.min(SESSION_PAGE_SIZE, remaining)} more</button></div>`
    : '';
}

function visibleCountFor(scopeKey) {
  return Math.max(SESSION_PAGE_SIZE, Number(visibleCounts.get(scopeKey) || SESSION_PAGE_SIZE));
}

function sessionRow(session) {
  const id = sessionIdentifier(session);
  const state = workSessionStateView(session);
  const live = isOngoingSession(session);
  const semantic = semanticProgressFor(session);
  const operation = semantic.currentActivity || session.currentActivity || session.operation || operationForTool(session.lastTool);
  const description = sessionDescription(session, live, operation, semantic);
  const facts = sessionFacts(session, live, semantic);
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

function sessionDescription(session, live, operation, semantic = semanticProgressFor(session)) {
  if (live) return semantic.currentActivity || semantic.currentStage || operation || 'Task is open';
  if (session.summary) return session.summary;
  if (session.status === 'validation_failed') return 'Checks failed';
  if (session.status === 'blocked') return session.endReason || workSessionStateView(session).label;
  if (session.status === 'cancelled') return 'Cancelled before completion';
  return semantic.currentActivity || session.currentActivity || session.currentStage || operation || 'Task ended';
}

function sessionFacts(session, live, semantic = semanticProgressFor(session)) {
  const facts = [];
  const toolCalls = Number(session.toolCallCount ?? session.calls ?? 0);
  const fileCounts = semanticFileCounts(session, semantic);
  const failures = Number(session.failedToolCallCount ?? session.failures ?? 0);
  const state = workSessionStateView(session);
  const completed = state.status === 'completed';
  facts.push(`${toolCalls} action${toolCalls === 1 ? '' : 's'}`);
  facts.push(`${fileCounts.product} product file${fileCounts.product === 1 ? '' : 's'}`);
  if (fileCounts.support > 0) facts.push(`${fileCounts.support} support artifact${fileCounts.support === 1 ? '' : 's'}`);
  if (failures > 0) facts.push(completed
    ? `${failures} recovered failed action${failures === 1 ? '' : 's'}`
    : `${failures} failed action${failures === 1 ? '' : 's'}`);
  if (session.validation === 'failed' || session.status === 'validation_failed') facts.push('checks failed');
  if (session.status === 'waiting_for_approval') facts.push('approval required');
  if (session.status === 'blocked') facts.push(state.label.toLowerCase());
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
    session.semanticProgress || null,
    session.operation || '',
    session.summary || '',
    session.progress || null,
    Number(session.activeCalls || 0),
    Number(session.toolCallCount ?? session.calls ?? 0),
    sessionChangedFileCount(session),
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
  const end = sessionListTimestampValue(session);
  const relative = timeAgo(end) || '—';
  return `<span${end ? ` data-clock-relative="${esc(end)}"` : ''}>${esc(relative)}</span>`;
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
  const requestedId = sessionIdentifier(session);
  if (!requestedId) return;
  closeOpenSession();
  const request = ++_openSessionRequest;
  _openSessionId = requestedId;
  session = await loadSessionDetail(session);
  if (request !== _openSessionRequest || _openSessionId !== requestedId) return;
  session = mergeSessionDetail(session, _sessionsById.get(requestedId));
  _openSessionDetail = session;
  _openSessionFingerprint = sessionDetailFingerprint(session);
  const { title, content } = buildSessionDetail(session);
  openDrawer({ title, content, panelClass: 'session-detail-drawer', onClose: clearOpenSessionState });
}

function buildSessionDetail(session) {
  const content = document.createElement('div');
  content.className = 'detail-stack session-detail';
  const identities = taskEntityView(session);
  const state = workSessionStateView(session);
  const live = isOngoingSession(session);
  const semantic = semanticProgressFor(session);
  const fileCounts = semanticFileCounts(session, semantic);
  const operationValue = session.operation || operationForTool(session.lastTool) || '—';
  const currentTitle = live ? (semantic.currentStage || state.label) : state.label;
  const currentCopy = live
    ? (semantic.currentActivity || operationValue || 'Task is open.')
    : (session.summary || session.endReason || sessionDescription(session, false, operationValue, semantic));

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
      ${detail('Project files', fileCounts.product)}
      ${fileCounts.support > 0 ? detail('Support artifacts', fileCounts.support) : ''}
    </div>
    ${attentionSection(session)}
    ${sessionActionSection(session)}
    ${taskMilestonesSection(semantic)}
    ${failureHistorySection(session)}
    ${changedFilesSection(session.changedFiles || [])}
    ${technicalDetailsSection(session, identities, state, operationValue, session.events || [])}
    <div class="session-detail-actions"><a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace, task: sessionIdentifier(session), time: 'all' })}">Open in Activity</a>${session.trace?.entries?.length ? '<button class="secondary" type="button" data-export-task-trace>Export trace (.jsonl)</button>' : ''}</div>`;

  for (const link of content.querySelectorAll('[data-task-event-link], .session-detail-actions a')) link.addEventListener('click', closeOpenSession);
  bindCopyActions(content);
  bindTraceExportAction(content, session);
  const id = sessionIdentifier(session);
  return { title: session.title || `Task ${id ? id.slice(0, 8) : 'unknown'}`, content };
}

function refreshOpenSession(data = {}) {
  if (!_openSessionId || !_openSessionDetail) return;
  const summary = _sessionsById.get(_openSessionId);
  if (!summary) return;
  const next = mergeSessionDetail(_openSessionDetail, summary, data);
  const fingerprint = sessionDetailFingerprint(next);
  if (fingerprint === _openSessionFingerprint) return;
  const { title, content } = buildSessionDetail(next);
  if (!updateDrawer({ title, content })) {
    clearOpenSessionState();
    return;
  }
  _openSessionDetail = next;
  _openSessionFingerprint = fingerprint;
}

function mergeSessionDetail(previous = {}, summary = {}, data = {}) {
  const changedFiles = orderChangedFiles([...(previous.changedFiles || []), ...(summary?.changedFiles || [])]);
  const taskId = sessionIdentifier(summary || previous);
  const liveEvents = (Array.isArray(data?.auditTail?.entries) ? data.auditTail.entries : [])
    .filter(event => String(event?.taskId || event?.sessionId || '').trim() === taskId);
  const events = mergeSessionEvents(previous.events || [], liveEvents);
  return {
    ...previous,
    ...(summary || {}),
    trace: summary?.trace || previous.trace,
    changedFiles,
    changedFileCount: Math.max(sessionChangedFileCount(previous), sessionChangedFileCount(summary), changedFiles.length),
    events
  };
}

function mergeSessionEvents(existing = [], updates = []) {
  const byId = new Map();
  for (const event of [...existing, ...updates]) {
    const id = activityEventId(event) || `${eventTimestampValue(event)}:${event.operation || event.tool || ''}`;
    byId.set(id, { ...(byId.get(id) || {}), ...event });
  }
  return orderSessionEvents([...byId.values()]);
}

function sessionDetailFingerprint(session) {
  return JSON.stringify([
    sessionFingerprint(session),
    orderChangedFiles(session.changedFiles || []),
    (Array.isArray(session.currentOperations) ? session.currentOperations : []).map(operation => [
      operation.invocationId || operation.operationId || '',
      operation.label || operation.tool || '',
      operation.status || '',
      operation.startedAt || ''
    ]),
    orderSessionEvents(session.events || []).map(event => [
      activityEventId(event),
      event.status || '',
      event.summary || '',
      eventTimestampValue(event)
    ]),
    Number(session.trace?.count || session.trace?.entries?.length || 0),
    Number(session.trace?.persistence?.droppedEntries || 0)
  ]);
}

function clearOpenSessionState() {
  _openSessionId = '';
  _openSessionDetail = null;
  _openSessionFingerprint = '';
  _openSessionRequest += 1;
}

function closeOpenSession() {
  clearOpenSessionState();
  closeDrawer();
}

async function loadSessionDetail(session) {
  const id = sessionIdentifier(session);
  if (!id || Array.isArray(session.trace?.entries)) return session;
  try {
    const response = await fetchJson(TASK_SESSION_URL + "?task=" + encodeURIComponent(id), { cache: 'no-store' });
    return response?.ok !== false && response?.session
      ? { ...response.session, ...(response.trace ? { trace: response.trace } : {}) }
      : session;
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
  return session.validation === 'failed'
    || ['failed', 'validation_failed', 'blocked'].includes(String(session.status || ''));
}

function attentionSection(session) {
  if (!sessionNeedsAttention(session)) return '';
  const items = [];
  const failures = Number(session.failures || session.failedToolCallCount || 0);
  if (failures) items.push(`${failures} action${failures === 1 ? '' : 's'} failed`);
  if (session.validation === 'failed' || session.status === 'validation_failed') items.push('Checks failed');
  if (session.status === 'blocked') items.push(session.endReason || workSessionStateView(session).label);
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

function technicalDetailsSection(session, identities, state, operationValue, events = []) {
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
    ${currentOperations(session)}
    ${taskTraceSection(session.trace, events, session)}
  </details>`;
}

function workflowTechnicalHtml(session = {}) {
  const workflow = session.workflow;
  if (!workflow || typeof workflow !== 'object' || !workflow.stage) return '';
  const next = workflow.recommendedAction || 'No additional action is recorded.';
  return `<div class="task-detail-workflow"><strong>Workflow ${esc(workflow.stage)}</strong><span>${esc(next)}</span></div>`;
}

function changedFilesSection(files) {
  const classified = classifyTaskChangedFiles(orderChangedFiles(files));
  return [
    changedFileGroup('Project files', classified.productFiles),
    changedFileGroup('Support artifacts', classified.supportArtifacts)
  ].filter(Boolean).join('');
}

function changedFileGroup(title, files) {
  const ordered = orderChangedFiles(files);
  if (!ordered.length) return '';
  const visible = ordered.slice(0, DETAIL_FILE_PREVIEW);
  const hidden = ordered.slice(DETAIL_FILE_PREVIEW);
  return `<section class="task-detail-section">
    <div class="task-detail-heading"><h3>${esc(title)}</h3><span>${ordered.length}</span></div>
    ${fileList(visible)}
    ${hidden.length ? `<details class="task-detail-overflow"><summary>Show ${hidden.length} more file${hidden.length === 1 ? '' : 's'}</summary>${fileList(hidden)}</details>` : ''}
  </section>`;
}

function fileList(files) {
  return `<ul class="task-file-list">${files.map(file => `<li><code>${esc(file)}</code></li>`).join('')}</ul>`;
}

function taskTraceSection(trace, fallbackEvents, session) {
  const traceEvents = Array.isArray(trace?.entries) ? trace.entries : [];
  const events = traceEvents.length ? traceEvents : fallbackEvents;
  if (!events.length) return '';
  const ordered = orderSessionEvents(events);
  const visible = ordered.slice(0, DETAIL_EVENT_PREVIEW);
  const hidden = ordered.slice(DETAIL_EVENT_PREVIEW);
  const dropped = Number(trace?.persistence?.droppedEntries || 0);
  const limitation = trace
    ? `Best-effort local task/tool trace. Audit rotation${trace.limited ? ', response limits' : ''}${dropped ? ` and ${dropped} dropped entr${dropped === 1 ? 'y' : 'ies'}` : ''} can make older history incomplete.`
    : 'Task activity projected from local history.';
  return `<section class="task-detail-section">
    <div class="task-detail-heading"><h3>Rel.AI task trace</h3><span>${events.length}</span></div>
    <p class="task-detail-note">${esc(limitation)}</p>
    <div class="task-event-list">${visible.map(event => eventRow(event, session)).join('')}</div>
    ${hidden.length ? `<details class="task-detail-overflow"><summary>Show ${hidden.length} older event${hidden.length === 1 ? '' : 's'}</summary><div class="task-event-list">${hidden.map(event => eventRow(event, session)).join('')}</div></details>` : ''}
  </section>`;
}

function bindTraceExportAction(root, session) {
  const button = root.querySelector('[data-export-task-trace]');
  if (!button) return;
  button.addEventListener('click', () => {
    const jsonl = taskTraceJsonl(session);
    if (!jsonl) return;
    const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relai-task-trace-${sessionIdentifier(session).slice(0, 24) || 'task'}.jsonl`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

export function taskTraceJsonl(session = {}) {
  const entries = Array.isArray(session.trace?.entries) ? session.trace.entries : [];
  return entries.length ? `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n` : '';
}

export function orderSessionsForDisplay(sessions = []) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((left, right) => {
    const leftOngoing = isOngoingSession(left);
    const rightOngoing = isOngoingSession(right);
    const ongoingDifference = Number(rightOngoing) - Number(leftOngoing);
    if (ongoingDifference) return ongoingDifference;
    const timestampDifference = leftOngoing && rightOngoing
      ? sessionStartTimestamp(left) - sessionStartTimestamp(right)
      : terminalTaskTimestamp(right) - terminalTaskTimestamp(left);
    if (timestampDifference) return timestampDifference;
    return sessionIdentifier(left).localeCompare(sessionIdentifier(right), 'en-US', { numeric: true, sensitivity: 'base' });
  });
}

function sessionStartTimestamp(session = {}) {
  for (const value of [session.startedAtIso, session.startedAt, session.createdAt]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Date.parse(String(value || ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.MAX_SAFE_INTEGER;
}

function sessionListTimestampValue(session = {}) {
  if (String(session.status || '').toLowerCase() === 'inactive' && session.inactiveAt) return session.inactiveAt;
  return terminalTaskTimestampValue(session);
}

function semanticProgressFor(session = {}) {
  if (Array.isArray(session.events)) return buildTaskSemanticProgress(session);
  if (session.semanticProgress && typeof session.semanticProgress === 'object') return session.semanticProgress;
  return buildTaskSemanticProgress(session);
}

function semanticFileCounts(session = {}, semantic = semanticProgressFor(session)) {
  const classified = classifyTaskChangedFiles(session.changedFiles || []);
  const product = Number.isFinite(Number(semantic?.productChangedFileCount))
    ? Math.max(0, Number(semantic.productChangedFileCount))
    : classified.productChangedFileCount;
  const support = Number.isFinite(Number(semantic?.supportArtifactCount))
    ? Math.max(0, Number(semantic.supportArtifactCount))
    : classified.supportArtifactCount;
  return { product, support };
}

function taskMilestonesSection(semantic = {}) {
  const milestones = Array.isArray(semantic.milestones) ? semantic.milestones : [];
  if (!milestones.length) return '';
  return `<section class="task-detail-section">
    <div class="task-detail-heading"><h3>Progress</h3><span>${milestones.length}</span></div>
    <ol class="task-milestone-list">${milestones.map(item => `
      <li><span class="task-milestone-state">${item.status === 'failed' ? 'Issue' : 'Done'}</span><span><strong>${esc(item.label || 'Task progress')}</strong>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</span></li>`).join('')}</ol>
  </section>`;
}

function sessionChangedFileCount(session = {}) {
  return Math.max(0, Number(session.changedFileCount || 0), orderChangedFiles(session.changedFiles || []).length);
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
