import { postJson, requestDashboardRefresh } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { EmptyState } from '../../components/empty-state.js';
import { pillHtml } from '../../components/pill.js';
import { nativeTaskCollection, processOutputView, processStateView } from '../../task-identity.js';
import { esc, formatDuration, timeAgo } from '../../utils.js';
import { iconActionHtml } from '../../components/icons.js';

export function mountProcesses(container, data = {}) {
  const nativeTasks = nativeTaskCollection(data).tasks;
  const processes = orderProcesses(data.managedProcesses || [], nativeTasks);
  const running = processes.filter(item => processStateView(item, nativeTasks).active).length;
  const finished = Math.max(0, processes.length - running);
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'section processes-page runtime-observability-page';
  root.innerHTML = `
    <div class="feature-toolbar processes-toolbar">
      <p>Long-running commands appear here until they finish or you stop them.</p>
      <span class="feature-count">${running} running${finished ? ` · ${finished} finished` : ''}</span>
    </div>
    <section class="card processes-card">
      <div class="card-head">
        <h3>Running commands</h3>
        <a class="section-action" href="#activity">${iconActionHtml('chevronRight', 'Activity', { position: 'end' })}</a>
      </div>
      <div class="card-body" data-process-list></div>
    </section>`;
  const list = root.querySelector('[data-process-list]');
  if (!processes.length) {
    list.appendChild(EmptyState({
      icon: '›_',
      title: 'No running commands',
      description: 'Servers, watchers, debuggers, and other long-running commands will appear here.'
    }));
  } else {
    for (const process of processes) list.appendChild(processRow(process, nativeTasks));
  }
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
  if (currentList && nextList) {
    syncProcessClockText(currentList, nextList);
    if (!currentList.isEqualNode(nextList)) reconcileProcessList(currentList, nextList);
  }
  return true;
}

function reconcileProcessList(currentList, nextList) {
  const currentRows = new Map(
    [...currentList.children]
      .filter(node => node.matches?.('.process-row'))
      .map(node => [node.dataset.processId || '', node])
  );
  const desired = [...nextList.children];
  for (let index = 0; index < desired.length; index += 1) {
    const nextNode = desired[index];
    let currentNode = currentList.children[index] || null;
    if (nextNode.matches?.('.process-row')) {
      const matchingRow = currentRows.get(nextNode.dataset.processId || '');
      if (matchingRow) {
        if (matchingRow !== currentNode) currentList.insertBefore(matchingRow, currentNode);
        currentNode = matchingRow;
        syncProcessClockText(currentNode, nextNode);
        if (!currentNode.isEqualNode(nextNode)) {
          const focusState = captureProcessFocus(currentNode);
          copyProcessDisclosureState(currentNode, nextNode);
          currentNode.replaceWith(nextNode);
          restoreProcessFocus(nextNode, focusState);
        }
        continue;
      }
    }
    if (currentNode?.isEqualNode(nextNode)) continue;
    if (currentNode) currentNode.replaceWith(nextNode);
    else currentList.appendChild(nextNode);
  }
  while (currentList.children.length > desired.length) currentList.lastElementChild?.remove();
}

function syncProcessClockText(currentList, nextList) {
  const selector = '[data-clock-elapsed-start], [data-clock-relative]';
  const currentClocks = [...currentList.querySelectorAll(selector)];
  const nextClocks = [...nextList.querySelectorAll(selector)];
  for (let index = 0; index < Math.min(currentClocks.length, nextClocks.length); index += 1) {
    const currentClock = currentClocks[index];
    const nextClock = nextClocks[index];
    if (processClockIdentity(currentClock) === processClockIdentity(nextClock)) nextClock.textContent = currentClock.textContent;
  }
}

function copyProcessDisclosureState(currentRow, nextRow) {
  const currentOutput = currentRow.querySelector('.process-output');
  const nextOutput = nextRow.querySelector('.process-output');
  if (currentOutput && nextOutput) nextOutput.open = currentOutput.open;
}

function captureProcessFocus(row) {
  const active = document.activeElement;
  if (!active || !row.contains(active)) return null;
  if (active.matches('[data-stop-process]')) return { kind: 'stop' };
  if (active.matches('.process-output > summary')) return { kind: 'summary' };
  if (active.matches('.process-output pre')) return { kind: 'output', value: active.getAttribute('aria-label') || '' };
  return null;
}

function restoreProcessFocus(row, state) {
  if (!state) return;
  let target = null;
  if (state.kind === 'stop') target = row.querySelector('[data-stop-process]');
  else if (state.kind === 'summary') target = row.querySelector('.process-output > summary');
  else if (state.kind === 'output') target = [...row.querySelectorAll('.process-output pre')].find(node => node.getAttribute('aria-label') === state.value);
  target?.focus({ preventScroll: true });
}

function processClockIdentity(node) {
  return [
    node.getAttribute('data-clock-elapsed-start') || '',
    node.getAttribute('data-clock-elapsed-end') || '',
    node.getAttribute('data-clock-relative') || ''
  ].join('|');
}

function processRow(process, nativeTasks) {
  const article = document.createElement('article');
  const state = processStateView(process, nativeTasks);
  const elapsed = durationFor(process, state.active);
  const processId = String(process.processId || 'unknown');
  const output = processOutputView(process);
  const label = process.label || process.commandSummary || 'Command';
  const project = process.workspaceId || process.workspace || 'Unknown project';
  article.className = `process-row${state.active ? ' active' : ''}${state.terminal ? ' terminal' : ''}`;
  article.dataset.processId = processId;
  article.setAttribute('aria-label', `${label}: ${state.label}`);
  article.innerHTML = `
    <div class="process-row-head">
      <div class="process-identity">
        <div class="process-title-line"><strong>${esc(label)}</strong>${pillHtml(state.label, state.pillClass)}</div>
        <div class="process-meta">
          <span>${esc(project)}</span>
          ${process.startedAt ? `<span>Started <span data-clock-relative="${esc(process.startedAt)}">${esc(timeAgo(process.startedAt) || 'now')}</span></span>` : ''}
          ${state.terminal && process.exitCode != null ? `<span>Exit code ${esc(process.exitCode)}</span>` : ''}
        </div>
      </div>
      <div class="process-actions">
        <span class="process-elapsed" ${state.active && process.startedAt ? `data-clock-elapsed-start="${esc(process.startedAt)}"` : ''}>${state.active ? 'Running for ' : ''}${esc(elapsed)}</span>
        ${state.canStop ? `<button class="secondary danger" type="button" data-stop-process aria-label="Stop ${esc(label)}">Stop</button>` : ''}
        ${state.status === 'stopping' ? '<span class="process-stop-state" role="status">Stopping…</span>' : ''}
      </div>
    </div>
    <div class="process-command-summary"><span>Command</span><code>${esc(process.commandSummary || 'Unavailable')}</code></div>
    ${process.error || ['failed', 'orphaned', 'unknown'].includes(state.status) ? `<div class="connection-notice ${state.status === 'failed' ? 'bad' : 'warn'} process-recovery"><strong>${esc(process.error || state.label)}</strong><div>${esc(state.recovery)}</div></div>` : ''}
    <details class="process-output">
      <summary>Recent output</summary>
      ${output.hasOutput ? `${outputBlock('stdout', output.stdout)}${outputBlock('stderr', output.stderr)}` : `<div class="process-output-empty" role="status">${esc(output.message)}</div>`}
    </details>`;
  const stop = article.querySelector('[data-stop-process]');
  if (stop) {
    stop.addEventListener('click', async () => {
      const result = await runButtonAction(stop, {
        idleText: 'Stop', loadingText: 'Stopping…', successText: 'Stopped', errorText: 'Try again'
      }, () => postJson('/api/processes/stop', { processId: process.processId, graceMs: 3000 }, { timeout: 10000 }));
      if (result?.ok !== false) requestDashboardRefresh();
    });
  }
  return article;
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
  if (Number.isFinite(start)) return active ? formatDuration(Date.now() - start, { live: true }) : `${formatDuration(end - start)}${process.endedAt ? ` · ${timeAgo(process.endedAt)}` : ''}`;
  return process.endedAt ? timeAgo(process.endedAt) : 'Unavailable';
}

function orderProcesses(items = [], nativeTasks = []) {
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
