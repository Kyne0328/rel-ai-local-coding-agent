import { closeDrawer, openDrawer } from '../components/drawer.js';
import { pillHtml } from '../components/pill.js';
import { esc, metricHtml, timeAgo } from '../utils.js';
import { getWorkspaceFilter, routeHref } from '../router.js';
import { activityEventId } from '../activity-event.js';

export function mountTasks(container, data = {}) {
  const workspace = getWorkspaceFilter();
  const sessions = (Array.isArray(data.tasks) ? data.tasks : [])
    .filter(session => !workspace || session.workspace === workspace);
  const working = sessions.filter(session => session.status === 'working').length;
  const waiting = sessions.filter(session => session.status === 'waiting').length;
  const completed = sessions.filter(session => session.status === 'completed').length;

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Work sessions</h2>
        <p>Rel.AI reports exact tool-call start, progress, success, and failure. A waiting session has no active Rel.AI call; ChatGPT may still be reasoning, waiting for approval, or already finished.</p>
      </div>
      <span class="section-action">${sessions.length} session${sessions.length === 1 ? '' : 's'}${workspace ? ` in ${esc(workspace)}` : ''}</span>
    </div>
    <div class="overview-grid overview-grid-compact">
      ${metricHtml('Running now', working, 'tool calls currently executing', working ? 'blue' : 'good')}
      ${metricHtml('Waiting', waiting, 'no active Rel.AI call', waiting ? 'warn' : 'good')}
      ${metricHtml('Completed', completed, 'explicitly completed after validation', completed ? 'good' : 'blue')}
    </div>`;

  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Session history</h3><div class="card-head-actions"><a class="section-action" href="#activity">Open tool events</a><a class="section-action" href="#settings/dashboard">History controls</a></div></div>';
  const body = document.createElement('div');
  body.className = 'card-body task-list';
  body.innerHTML = sessions.length
    ? sessions.map(sessionRow).join('')
    : '<div class="empty">Sessions appear when ChatGPT or the local dashboard calls a Rel.AI tool.</div>';
  card.appendChild(body);
  root.appendChild(card);
  container.appendChild(root);

  for (const button of root.querySelectorAll('[data-task-id]')) {
    button.addEventListener('click', () => openSession(sessions.find(session => session.id === button.dataset.taskId)));
  }
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

  return `
    <button class="task-row" type="button" data-task-id="${esc(session.id)}">
      <span class="task-row-status">${statusPill(status)}</span>
      <span class="task-row-main">
        <strong>${esc(operation)}</strong>
        <span>${esc(workspace)} · ${activity} · ${session.changedFileCount || 0} file${session.changedFileCount === 1 ? '' : 's'} changed · ${validation}</span>
      </span>
      <span class="task-row-publish">${publishLabel(session)}</span>
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
  return 'Not published';
}

function openSession(session) {
  if (!session) return;
  const content = document.createElement('div');
  content.className = 'detail-stack';
  const changed = session.changedFiles?.length
    ? `<ul class="task-file-list">${session.changedFiles.map(file => `<li><code>${esc(file)}</code></li>`).join('')}</ul>`
    : '<div class="muted">No changed files recorded.</div>';
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
    <div class="connection-notice"><strong>What this state means</strong><div>${esc(endMeaning)}</div></div>
    ${session.summary ? `<section><h3>Completion summary</h3><div class="muted">${esc(session.summary)}</div></section>` : ''}
    ${operations}
    <section><h3>Changed files</h3>${changed}</section>
    <section><h3>Tool events</h3><div class="task-event-list">${(session.events || []).map(event => eventRow(event, session)).join('') || '<div class="muted">No persisted events.</div>'}</div></section>
    <a class="buttonlike secondary" href="${routeHref('activity', { workspace: session.workspace, task: session.id })}">Open in Activity log</a>`;
  for (const link of content.querySelectorAll('[data-task-event-link]')) {
    link.addEventListener('click', closeDrawer);
  }
  openDrawer({ title: `Session ${session.id.slice(0, 8)}`, content });
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
  return `<section><h3>Running operations</h3><div class="task-event-list">${operations.map(operation => `
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
  return `<a class="task-event task-event-link" data-task-event-link href="${esc(href)}" aria-label="Open ${esc(operation)} event in Activity log"><span>${esc(timeAgo(event.ts))}</span><code title="${esc(event.tool || '')}">${esc(operation)}</code>${pillHtml(event.ok === false ? 'error' : 'ok')}</a>`;
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
