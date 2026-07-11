import { openDrawer } from '../components/drawer.js';
import { pillHtml } from '../components/pill.js';
import { esc, timeAgo } from '../utils.js';
import { getWorkspaceFilter, routeHref } from '../router.js';

export function mountTasks(container, data = {}) {
  const workspace = getWorkspaceFilter();
  const tasks = (Array.isArray(data.tasks) ? data.tasks : [])
    .filter(task => !workspace || task.workspace === workspace);
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section';
  const running = tasks.filter(task => task.status === 'working' || task.status === 'settling').length;
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Tasks</h2><p>Each row groups related ChatGPT tool calls. A task remains open for 60 seconds after its latest call so normal approval and reasoning gaps do not split it.</p></div>
      <span class="section-action">${running ? `${running} running · ` : ''}${tasks.length} total${workspace ? ` in ${esc(workspace)}` : ''}</span>
    </div>`;

  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = '<div class="card-head"><h3>Task history</h3><a class="section-action" href="#activity">Open tool-event log</a></div>';
  const body = document.createElement('div');
  body.className = 'card-body task-list';
  body.innerHTML = tasks.length ? tasks.map(taskRow).join('') : '<div class="empty">Task history will appear after ChatGPT uses a Rel.AI connector tool.</div>';
  card.appendChild(body);
  root.appendChild(card);
  container.appendChild(root);

  for (const button of root.querySelectorAll('[data-task-id]')) {
    button.addEventListener('click', () => openTask(tasks.find(task => task.id === button.dataset.taskId)));
  }
}

function taskRow(task) {
  const active = task.status === 'working' || task.status === 'settling';
  const status = active ? task.status : task.status === 'attention' ? 'error' : 'ok';
  const workspace = task.workspace || 'workspace';
  const validation = task.validation === 'passed' ? 'validation passed' : task.validation === 'failed' ? 'validation failed' : 'validation not run';
  return `
    <button class="task-row" type="button" data-task-id="${esc(task.id)}">
      <span class="task-row-status">${pillHtml(status)}</span>
      <span class="task-row-main">
        <strong>${esc(workspace)}</strong>
        <span>${task.calls} tool call${task.calls === 1 ? '' : 's'}${active ? ` · ${task.activeCalls || 0} active` : ''} · ${task.changedFileCount || 0} file${task.changedFileCount === 1 ? '' : 's'} changed · ${validation}</span>
      </span>
      <span class="task-row-publish">${publishLabel(task)}</span>
      <span class="task-row-time">${active ? formatDuration(task.durationMs) : esc(timeAgo(task.completedAt))}</span>
      <span aria-hidden="true">›</span>
    </button>`;
}

function publishLabel(task) {
  if (task.pushed) return 'Pushed';
  if (task.committed) return 'Committed';
  if (task.prDrafted) return 'PR drafted';
  return 'No publish';
}

function openTask(task) {
  if (!task) return;
  const content = document.createElement('div');
  content.className = 'detail-stack';
  const changed = task.changedFiles?.length
    ? `<ul class="task-file-list">${task.changedFiles.map(file => `<li><code>${esc(file)}</code></li>`).join('')}</ul>`
    : '<div class="muted">No changed files recorded.</div>';
  content.innerHTML = `
    <div class="task-detail-grid">
      ${detail('Workspace', task.workspace || '—')}
      ${detail('Status', task.status)}
      ${detail('Duration', formatDuration(task.durationMs))}
      ${detail('Grouped tool calls', task.calls)}
      ${detail('Currently active', task.activeCalls || 0)}
      ${detail('Failures', task.failures)}
      ${detail('Validation', task.validation)}
      ${detail('Commit', task.committed ? 'Created' : 'No')}
      ${detail('Push', task.pushed ? 'Published' : 'No')}
    </div>
    <section><h3>Changed files</h3>${changed}</section>
    <section><h3>Tool events</h3><div class="task-event-list">${(task.events || []).map(eventRow).join('') || '<div class="muted">No persisted events.</div>'}</div></section>
    <a class="buttonlike secondary" href="${routeHref('activity', { workspace: task.workspace, task: task.id })}">Open in Activity log</a>`;
  openDrawer({ title: `Task ${task.id.slice(0, 8)}`, content });
}

function detail(label, value) {
  return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function eventRow(event) {
  return `<div class="task-event"><span>${esc(timeAgo(event.ts))}</span><code>${esc(event.tool || 'event')}</code>${pillHtml(event.ok === false ? 'error' : 'ok')}</div>`;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
