import { postJson, requestDashboardRefresh } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { EmptyState } from '../../components/empty-state.js';
import { pillHtml } from '../../components/pill.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';

const ACTIVE = new Set(['starting', 'running', 'stopping']);

export function mountProcesses(container, data = {}) {
  const processes = orderProcesses(data.managedProcesses || []);
  const running = processes.filter(item => ACTIVE.has(item.status)).length;
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section processes-page';
  root.innerHTML = `
    <div class="feature-toolbar processes-toolbar">
      <p>Persistent development servers, watchers, debuggers, and interactive commands started through Rel.AI.</p>
      <span class="feature-count">${running} active · ${processes.length} retained</span>
    </div>
    <section class="card processes-card">
      <div class="card-head">
        <div><h3>Managed processes</h3><p>Output is stored locally with independent stdout and stderr cursors.</p></div>
        <a class="section-action" href="#activity">Open tool events</a>
      </div>
      <div class="card-body" data-process-list></div>
    </section>`;
  const list = root.querySelector('[data-process-list]');
  if (!processes.length) {
    list.appendChild(EmptyState({
      icon: '›_',
      title: 'No managed processes',
      description: 'ChatGPT can start a persistent process with relai_process_start when a development server or watcher is needed.'
    }));
  } else {
    for (const process of processes) list.appendChild(processRow(process));
  }
  container.appendChild(root);
}

function processRow(process) {
  const article = document.createElement('article');
  const active = ACTIVE.has(process.status);
  const elapsed = durationFor(process);
  article.className = `process-row${active ? ' active' : ''}`;
  article.dataset.processId = process.processId || '';
  article.innerHTML = `
    <div class="process-row-head">
      <div class="process-identity">
        <div class="process-title-line"><strong>${esc(process.label || process.commandSummary || 'Managed process')}</strong>${pillHtml(process.status || 'unknown')}</div>
        <code>${esc(process.processId || '')}</code>
      </div>
      <div class="process-actions">
        <span class="process-elapsed" ${active && process.startedAt ? `data-clock-elapsed-start="${esc(process.startedAt)}"` : ''}>${esc(elapsed)}</span>
        ${active ? '<button class="secondary danger" type="button" data-stop-process>Stop</button>' : ''}
      </div>
    </div>
    <div class="process-meta">
      <span>${esc(process.workspace || 'workspace')}</span>
      <span>${esc(process.cwd || '.')}</span>
      <span>PID ${esc(process.pid ?? '—')}</span>
      <span>${Number(process.stdoutBytes || 0) + Number(process.stderrBytes || 0)} log bytes</span>
    </div>
    <details class="process-output"${active ? ' open' : ''}>
      <summary>Recent output</summary>
      ${outputBlock('stdout', process.stdoutTail)}
      ${outputBlock('stderr', process.stderrTail)}
    </details>`;
  const stop = article.querySelector('[data-stop-process]');
  if (stop) {
    stop.addEventListener('click', async () => {
      const result = await runButtonAction(stop, {
        idleText: 'Stop', loadingText: 'Stopping…', successText: 'Stopped', errorText: 'Retry'
      }, () => postJson('/api/processes/stop', { processId: process.processId, graceMs: 3000 }, { timeout: 10000 }));
      if (result?.ok !== false) requestDashboardRefresh();
    });
  }
  return article;
}

function outputBlock(stream, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<div class="process-output-block"><span>${stream}</span><pre>${esc(text)}</pre></div>`;
}

function durationFor(process) {
  const start = Date.parse(process.startedAt || '');
  const end = Date.parse(process.endedAt || '') || Date.now();
  if (Number.isFinite(start)) return ACTIVE.has(process.status) ? formatDuration(end - start) : `${formatDuration(end - start)} · ${timeAgo(process.endedAt)}`;
  return process.endedAt ? timeAgo(process.endedAt) : 'just started';
}

export function orderProcesses(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const activeDifference = Number(ACTIVE.has(right?.status)) - Number(ACTIVE.has(left?.status));
    if (activeDifference) return activeDifference;
    return timestamp(right) - timestamp(left) || String(left?.processId || '').localeCompare(String(right?.processId || ''));
  });
}

function timestamp(item) {
  const value = Date.parse(item?.endedAt || item?.startedAt || '');
  return Number.isFinite(value) ? value : 0;
}
