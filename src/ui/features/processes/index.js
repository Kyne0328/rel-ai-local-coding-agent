import { postJson, requestDashboardRefresh } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { copyText } from '../../clipboard.js';
import { EmptyState } from '../../components/empty-state.js';
import { pillHtml } from '../../components/pill.js';
import { toast } from '../../components/toast.js';
import { nativeTaskCollection, processOutputView, processStateView } from '../../task-identity.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';

export function mountProcesses(container, data = {}) {
  const nativeTasks = nativeTaskCollection(data).tasks;
  const processes = orderProcesses(data.managedProcesses || [], nativeTasks);
  const running = processes.filter(item => processStateView(item, nativeTasks).active).length;
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section processes-page runtime-observability-page';
  root.innerHTML = `
    <div class="feature-toolbar processes-toolbar">
      <p>A managed process is one operating-system process. It can outlive the native task that started it and must be stopped with the process-specific control.</p>
      <span class="feature-count">${running} active · ${processes.length} retained</span>
    </div>
    <section class="card processes-card">
      <div class="card-head">
        <div><h3>Managed processes</h3><p>Process lifecycle, bounded output, exit state, and safe relationships to work sessions and native tasks.</p></div>
        <a class="section-action" href="#activity">Open tool events</a>
      </div>
      <div class="card-body" data-process-list></div>
    </section>`;
  const list = root.querySelector('[data-process-list]');
  if (!processes.length) {
    list.appendChild(EmptyState({
      icon: '›_',
      title: 'No managed processes',
      description: 'Rel.AI records persistent servers, watchers, debuggers, and interactive commands here when they are started.'
    }));
  } else {
    for (const process of processes) list.appendChild(processRow(process, nativeTasks));
  }
  bindCopyActions(root);
  container.appendChild(root);
}

export function updateProcessesLiveState(container, data = {}) {
  const current = container.querySelector('.processes-page');
  if (!current) return false;
  const detached = document.createElement('div');
  mountProcesses(detached, data);
  const next = detached.querySelector('.processes-page');
  const currentCount = current.querySelector('.feature-count');
  const nextCount = next?.querySelector('.feature-count');
  if (currentCount && nextCount && currentCount.textContent !== nextCount.textContent) currentCount.textContent = nextCount.textContent;
  const currentList = current.querySelector('[data-process-list]');
  const nextList = next?.querySelector('[data-process-list]');
  if (currentList && nextList && !currentList.isEqualNode(nextList)) currentList.replaceWith(nextList);
  return true;
}

function processRow(process, nativeTasks) {
  const article = document.createElement('article');
  const state = processStateView(process, nativeTasks);
  const elapsed = durationFor(process, state.active);
  const processId = String(process.processId || 'unknown');
  const workSessionId = String(process.workSessionId || process.logicalTaskId || '');
  const nativeTaskId = String(process.originatingTaskId || process.nativeTaskId || '');
  const totalLogBytes = Number(process.stdoutBytes || 0) + Number(process.stderrBytes || 0);
  const output = processOutputView(process);
  article.className = `process-row${state.active ? ' active' : ''}${state.terminal ? ' terminal' : ''}`;
  article.dataset.processId = processId;
  article.setAttribute('aria-label', `Managed process ${processId}: ${state.label}`);
  article.innerHTML = `
    <div class="process-row-head">
      <div class="process-identity">
        <div class="process-title-line"><strong>${esc(process.label || process.commandSummary || 'Managed process')}</strong>${pillHtml(state.label, state.pillClass)}</div>
        ${identifierHtml('Process ID', processId)}
      </div>
      <div class="process-actions">
        <span class="process-elapsed" ${state.active && process.startedAt ? `data-clock-elapsed-start="${esc(process.startedAt)}"` : ''}>Runtime ${esc(elapsed)}</span>
        ${state.canStop ? `<button class="secondary danger" type="button" data-stop-process aria-label="Stop process ${esc(processId)}">Stop process</button>` : ''}
        ${state.status === 'stopping' ? '<span class="process-stop-state" role="status">Waiting for confirmed exit</span>' : ''}
      </div>
    </div>
    ${relationshipHtml(workSessionId, nativeTaskId, processId)}
    <div class="process-detail-grid">
      <div><span>Process status</span><strong>${esc(state.label)}</strong></div>
      <div><span>Workspace</span><strong>${esc(process.workspaceId || process.workspace || 'Unavailable')}</strong></div>
      <div><span>Started</span><strong>${process.startedAt ? `<span data-clock-relative="${esc(process.startedAt)}">${esc(timeAgo(process.startedAt) || 'now')}</span>` : 'Unavailable'}</strong></div>
      <div><span>Exit code</span><strong>${esc(process.exitCode ?? '—')}</strong></div>
      <div><span>Signal</span><strong>${esc(process.signal || '—')}</strong></div>
      <div><span>PID</span><strong>${esc(process.pid ?? '—')}</strong></div>
      <div><span>Working directory</span><strong>${esc(process.cwd || '.')}</strong></div>
      <div><span>Output observed</span><strong>${esc(totalLogBytes)} total bytes</strong></div>
    </div>
    <div class="process-command-summary"><span>Command summary</span><code>${esc(process.commandSummary || 'Unavailable')}</code></div>
    ${state.independent ? '<div class="connection-notice process-independent" role="status"><strong>Startup task completed; process still running.</strong><div>This is expected for a persistent process. Use Stop process here rather than cancelling the completed native task.</div></div>' : ''}
    ${process.error || ['failed', 'orphaned', 'unknown'].includes(state.status) ? `<div class="connection-notice ${state.status === 'failed' ? 'bad' : 'warn'} process-recovery"><strong>${esc(process.error || state.label)}</strong><div>${esc(state.recovery)}</div></div>` : ''}
    <details class="process-output"${state.active && output.hasOutput ? ' open' : ''}>
      <summary>Bounded recent output</summary>
      ${output.hasOutput ? `${outputBlock('stdout', output.stdout)}${outputBlock('stderr', output.stderr)}` : `<div class="process-output-empty" role="status">${esc(output.message)}</div>`}
    </details>`;
  const stop = article.querySelector('[data-stop-process]');
  if (stop) {
    stop.addEventListener('click', async () => {
      const result = await runButtonAction(stop, {
        idleText: 'Stop process', loadingText: 'Stopping process…', successText: 'Process stopped', errorText: 'Retry stop'
      }, () => postJson('/api/processes/stop', { processId: process.processId, graceMs: 3000 }, { timeout: 10000 }));
      if (result?.ok !== false) requestDashboardRefresh();
    });
  }
  return article;
}

function relationshipHtml(workSessionId, nativeTaskId, processId) {
  const items = [
    ['Work session ID', workSessionId],
    ['Native task ID', nativeTaskId],
    ['Process ID', processId]
  ].filter(([, value]) => value);
  return `<div class="runtime-relationship process-relationship" aria-label="Process lifecycle relationship">${items.map(([label, value], index) => `${index ? '<span aria-hidden="true">→</span>' : ''}<span><small>${esc(label)}</small><code>${esc(value)}</code></span>`).join('')}</div>`;
}

function identifierHtml(label, value) {
  return `<span class="runtime-identifier"><span>${esc(label)}</span><code>${esc(value)}</code><button class="runtime-copy-id" type="button" data-copy-value="${esc(value)}" aria-label="Copy ${esc(label)} ${esc(value)}">Copy</button></span>`;
}

function bindCopyActions(root) {
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-copy-value]');
    if (!button) return;
    const value = button.dataset.copyValue || '';
    void copyText(value)
      .then(() => toast('Identifier copied.', { variant: 'success' }))
      .catch(error => toast(error instanceof Error ? error.message : String(error), { variant: 'error' }));
  });
}

function outputBlock(stream, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<div class="process-output-block"><span>${stream}</span><pre tabindex="0" aria-label="Recent ${stream} output">${esc(text)}</pre></div>`;
}

function durationFor(process, active) {
  const start = Date.parse(process.startedAt || '');
  const parsedEnd = Date.parse(process.endedAt || '');
  const end = Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
  if (Number.isFinite(start)) return active ? formatDuration(Date.now() - start) : `${formatDuration(end - start)}${process.endedAt ? ` · ${timeAgo(process.endedAt)}` : ''}`;
  return process.endedAt ? timeAgo(process.endedAt) : 'unavailable';
}

export function orderProcesses(items = [], nativeTasks = []) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const activeDifference = Number(processStateView(right, nativeTasks).active) - Number(processStateView(left, nativeTasks).active);
    if (activeDifference) return activeDifference;
    return timestamp(right) - timestamp(left) || String(left?.processId || '').localeCompare(String(right?.processId || ''));
  });
}

function timestamp(item) {
  const value = Date.parse(item?.endedAt || item?.startedAt || '');
  return Number.isFinite(value) ? value : 0;
}
