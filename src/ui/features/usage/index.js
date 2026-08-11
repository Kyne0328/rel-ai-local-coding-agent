import { closeModal, openModal } from '../../components/modal.js';
import { getWorkspaceFilter, routeHref, setWorkspaceFilter } from '../../router.js';

const EXACT_METRICS = Object.freeze([
  ['requests', 'MCP requests', formatInteger],
  ['toolCalls', 'Tool calls', formatInteger],
  ['successes', 'Successful', formatInteger],
  ['failures', 'Failed', formatInteger],
  ['requestBytes', 'Data sent', formatBytes],
  ['resultBytes', 'Data returned', formatBytes],
  ['executionMs', 'Execution time', formatDuration],
  ['activeDays', 'Active days', formatInteger]
]);

let mountedGeneration = 0;

export async function mountUsage(container) {
  const generation = ++mountedGeneration;
  const month = currentUsageMonth();
  const workspace = getWorkspaceFilter();
  container.innerHTML = `
    <section class="usage-page" data-usage-page>
      <div class="feature-toolbar usage-toolbar">
        <div>
          <h2>Analytics</h2>
          <p>Exact Rel.AI-observed MCP activity for the selected UTC month. Filter to a workspace without exposing repository contents, prompts, paths, or tool result bodies.</p>
        </div>
        <div class="usage-toolbar-controls">
          <label class="usage-workspace-control"><span>Workspace</span><select data-usage-workspace><option value="${escapeHtml(workspace)}">${escapeHtml(workspace || 'All workspaces')}</option></select></label>
          <label class="usage-month-control"><span>Month</span><input type="month" data-usage-month value="${month}" max="${month}" /></label>
          <button type="button" class="secondary" data-usage-refresh>Refresh</button>
        </div>
      </div>
      <div class="usage-content" data-usage-content aria-live="polite"></div>
    </section>`;

  const root = container.querySelector('[data-usage-page]');
  const workspaceSelect = root.querySelector('[data-usage-workspace]');
  const monthInput = root.querySelector('[data-usage-month]');
  const refreshButton = root.querySelector('[data-usage-refresh]');
  const content = root.querySelector('[data-usage-content]');

  const refresh = () => loadUsage({ root, workspaceSelect, monthInput, refreshButton, content, generation });
  workspaceSelect.addEventListener('change', () => setWorkspaceFilter(workspaceSelect.value));
  monthInput.addEventListener('change', refresh);
  refreshButton.addEventListener('click', refresh);
  await refresh();
}

async function loadUsage({ root, workspaceSelect, monthInput, refreshButton, content, generation }) {
  const month = normalizeMonth(monthInput.value);
  if (!month) {
    renderUnavailable(content, 'Choose a valid month in YYYY-MM format.', () => monthInput.focus());
    return;
  }
  monthInput.value = month;
  refreshButton.disabled = true;
  refreshButton.textContent = 'Loading…';
  content.setAttribute('aria-busy', 'true');
  content.innerHTML = '<div class="usage-loading">Loading exact Rel.AI analytics…</div>';

  try {
    const desktop = window.relaiDesktop;
    if (!desktop?.getGatewayUsage) throw new Error('Rel.AI Cloud analytics are available in the installed desktop app.');
    const status = await desktop.getGatewayStatus?.();
    if (status?.connectionMode === 'direct') {
      if (generation !== mountedGeneration || !root.isConnected) return;
      renderDirectUsage(content);
      showDirectUsageModal();
      return;
    }
    const availability = cloudUsageAvailability(status);
    if (availability) {
      if (generation !== mountedGeneration || !root.isConnected) return;
      renderCloudUsageBlocked(content, availability);
      showCloudUsageModal(availability);
      return;
    }
    const usage = await desktop.getGatewayUsage(month);
    if (generation !== mountedGeneration || !root.isConnected) return;
    if (usage?.ok === false && usage?.errorCode === 'GATEWAY_NOT_CONNECTED') {
      const unavailable = { kind: 'offline', message: usage.error || 'Rel.AI Cloud is not connected.' };
      renderCloudUsageBlocked(content, unavailable);
      showCloudUsageModal(unavailable);
      return;
    }
    const model = buildUsageModel(usage, month);
    const selectedWorkspace = getWorkspaceFilter();
    syncWorkspaceControl(workspaceSelect, model, selectedWorkspace);
    renderUsage(content, model, selectedWorkspace);
  } catch (error) {
    if (generation !== mountedGeneration || !root.isConnected) return;
    const availability = cloudUsageAvailabilityFromError(error);
    if (availability) {
      renderCloudUsageBlocked(content, availability);
      showCloudUsageModal(availability);
      return;
    }
    renderUnavailable(content, messageOf(error), () => loadUsage({ root, workspaceSelect, monthInput, refreshButton, content, generation }));
  } finally {
    if (generation === mountedGeneration && root.isConnected) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh';
      content.removeAttribute('aria-busy');
    }
  }
}

export function buildUsageModel(snapshot, requestedMonth = '') {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.ok === false) {
    throw new Error(String(snapshot?.error || 'Usage unavailable.'));
  }
  const month = normalizeMonth(snapshot.month || requestedMonth);
  if (!month) throw new Error('Usage unavailable for the selected month.');
  const totals = requireTotals(snapshot.totals);
  return {
    month,
    totals,
    tools: normalizeBreakdown(snapshot.tools, 'tool'),
    devices: normalizeBreakdown(snapshot.devices, 'device'),
    workspaces: normalizeBreakdown(snapshot.workspaces, 'workspace')
  };
}

export function currentUsageMonth(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function renderUsage(content, model, requestedWorkspace = '') {
  const scope = analyticsScope(model, requestedWorkspace);
  const scopeCopy = scope.kind === 'workspace'
    ? `Showing exact tool activity attributed to ${scope.label}. Request and byte totals remain principal-wide and are intentionally omitted from workspace cards.`
    : 'Counts and byte totals are recorded by the Rel.AI gateway from authenticated MCP traffic. They do not represent ChatGPT model-token usage or billing.';
  content.innerHTML = `
    <section class="usage-overview" aria-label="${escapeHtml(scope.label)} analytics for ${escapeHtml(model.month)}">
      <div class="usage-month-summary">
        <div><span class="field-caption">${scope.kind === 'workspace' ? 'Workspace analytics' : 'UTC month'}</span><strong>${escapeHtml(scope.kind === 'workspace' ? scope.label : monthLabel(model.month))}</strong><small>${escapeHtml(monthLabel(model.month))}</small></div>
        <p>${escapeHtml(scopeCopy)}</p>
      </div>
      <div class="usage-metrics">${analyticsMetrics(scope).map(metric => metricHtml(...metric)).join('')}</div>
      ${transportFacts(scope, model.totals)}
    </section>
    <div class="usage-visual-grid">
      ${outcomesSection(scope)}
      ${scope.kind === 'workspace'
        ? workspaceComparisonSection(model.workspaces, scope.label)
        : activityBarsSection('Tool usage', 'Exact tool calls observed during this UTC month.', model.tools, 'tool')}
    </div>
    ${scope.kind === 'workspace'
      ? activityBarsSection('Workspace comparison', 'Compare this workspace with other Rel.AI-observed workspace aliases for the same month.', model.workspaces, 'workspace', scope.label)
      : activityBarsSection('Workspace activity', 'Activity is attributed to workspace aliases only; local absolute paths are never included.', model.workspaces, 'workspace')}
    ${breakdownSection('Devices', 'Usage attributed to paired Rel.AI devices.', model.devices, 'device')}`;
}

function renderDirectUsage(content) {
  content.innerHTML = '<section class="usage-loading">Rel.AI Cloud usage is available when this desktop uses the Cloud connection.</section>';
}

function showDirectUsageModal() {
  const content = document.createElement('div');
  content.className = 'detail-stack';
  content.innerHTML = `
    <p>Rel.AI Cloud usage is unavailable while Direct connection mode is active.</p>
    <div class="section-head-actions">
      <a class="buttonlike primary" href="#connection" data-usage-open-connection>Open Connection</a>
      <button type="button" class="secondary" data-usage-modal-close>Close</button>
    </div>`;
  const modal = openModal({ title: 'Usage unavailable', content });
  content.querySelector('[data-usage-modal-close]')?.addEventListener('click', modal.close);
  content.querySelector('[data-usage-open-connection]')?.addEventListener('click', closeModal);
}

function cloudUsageAvailability(status) {
  if (!status || status.connectionMode === 'direct') return null;
  const gateway = status.gateway && typeof status.gateway === 'object' ? status.gateway : {};
  const state = String(gateway.state || 'offline');
  if (state === 'pairing_required' || gateway.principalPaired !== true) {
    return { kind: 'pairing_required', message: 'Pair this desktop with Rel.AI Cloud before viewing Cloud usage.' };
  }
  if (state !== 'connected') {
    return { kind: state || 'offline', message: 'Rel.AI Cloud must be connected before usage can be loaded.' };
  }
  return null;
}

function cloudUsageAvailabilityFromError(error) {
  const message = messageOf(error);
  return /gateway is not connected|rel\.ai cloud is not connected/i.test(message)
    ? { kind: 'offline', message: 'Rel.AI Cloud must be connected before usage can be loaded.' }
    : null;
}

function renderCloudUsageBlocked(content, availability) {
  const pairing = availability.kind === 'pairing_required';
  content.innerHTML = `<section class="usage-loading">${pairing ? 'Pair Rel.AI with ChatGPT to view Cloud usage.' : 'Rel.AI Cloud usage will be available when the Cloud connection is online.'}</section>`;
}

function showCloudUsageModal(availability) {
  const pairing = availability.kind === 'pairing_required';
  const content = document.createElement('div');
  content.className = 'detail-stack';
  content.innerHTML = `
    <p>${escapeHtml(availability.message)}</p>
    <div class="section-head-actions">
      <a class="buttonlike primary" href="#connection" data-usage-open-connection>${pairing ? 'Open Connection' : 'Review Connection'}</a>
      <button type="button" class="secondary" data-usage-modal-close>Close</button>
    </div>`;
  const modal = openModal({ title: pairing ? 'Pairing required' : 'Cloud connection unavailable', content });
  content.querySelector('[data-usage-modal-close]')?.addEventListener('click', modal.close);
  content.querySelector('[data-usage-open-connection]')?.addEventListener('click', closeModal);
}
function renderUnavailable(content, message, retry) {
  content.innerHTML = `
    <section class="usage-unavailable empty-state" data-usage-unavailable>
      <strong>Usage unavailable</strong>
      <p>${escapeHtml(message || 'Rel.AI Cloud usage could not be loaded.')}</p>
      <button type="button" class="secondary" data-usage-retry>Retry</button>
    </section>`;
  content.querySelector('[data-usage-retry]')?.addEventListener('click', retry);
}

function syncWorkspaceControl(select, model, selectedWorkspace) {
  if (!select) return;
  const aliases = [...new Set(model.workspaces.map(row => row.workspace).filter(Boolean))];
  if (selectedWorkspace && !aliases.includes(selectedWorkspace)) aliases.unshift(selectedWorkspace);
  select.innerHTML = `<option value="">All workspaces</option>${aliases.map(alias => `<option value="${escapeHtml(alias)}">${escapeHtml(alias)}</option>`).join('')}`;
  select.value = selectedWorkspace || '';
}

function analyticsScope(model, requestedWorkspace) {
  const alias = String(requestedWorkspace || '').trim();
  if (!alias) return { kind: 'all', label: 'All workspaces', ...model.totals };
  const row = model.workspaces.find(item => item.workspace === alias) || {
    workspace: alias,
    toolCalls: 0,
    successes: 0,
    failures: 0,
    executionMs: 0
  };
  return { kind: 'workspace', label: alias, ...row };
}

function analyticsMetrics(scope) {
  const completed = scope.successes + scope.failures;
  const successRate = completed ? (scope.successes / completed) * 100 : 0;
  const averageDuration = scope.toolCalls ? scope.executionMs / scope.toolCalls : 0;
  if (scope.kind === 'workspace') {
    return [
      ['Tool calls', formatInteger(scope.toolCalls), 'Exact invocations'],
      ['Successful', formatInteger(scope.successes), 'Completed successfully'],
      ['Failed', formatInteger(scope.failures), scope.failures ? 'Needs attention' : 'No recorded failures', scope.failures ? 'bad' : 'good'],
      ['Success rate', formatPercent(successRate), completed ? `${formatInteger(completed)} completed outcomes` : 'No completed outcomes'],
      ['Execution time', formatDuration(scope.executionMs), 'Gateway-observed tool duration'],
      ['Avg tool time', formatDuration(averageDuration), scope.toolCalls ? 'Per observed tool call' : 'No tool calls']
    ];
  }
  return [
    ['MCP requests', formatInteger(scope.requests), 'Authenticated requests'],
    ['Tool calls', formatInteger(scope.toolCalls), 'Exact invocations'],
    ['Success rate', formatPercent(successRate), completed ? `${formatInteger(completed)} completed outcomes` : 'No completed outcomes'],
    ['Failed', formatInteger(scope.failures), scope.failures ? 'Needs attention' : 'No recorded failures', scope.failures ? 'bad' : 'good'],
    ['Execution time', formatDuration(scope.executionMs), 'Gateway-observed tool duration'],
    ['Active days', formatInteger(scope.activeDays), 'UTC days with MCP traffic']
  ];
}

function metricHtml(label, value, detail = '', tone = '') {
  return `<article class="usage-metric ${escapeHtml(tone)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}<i aria-hidden="true"></i></article>`;
}

function transportFacts(scope, totals) {
  if (scope.kind === 'workspace') {
    const share = totals.toolCalls ? (scope.toolCalls / totals.toolCalls) * 100 : 0;
    return `<div class="usage-fact-strip">
      ${factHtml('Workspace share', formatPercent(share), 'of all observed tool calls')}
      ${factHtml('Completed outcomes', formatInteger(scope.successes + scope.failures), 'successes + failures')}
      ${factHtml('Scope', 'Workspace alias', 'no local path data')}
    </div>`;
  }
  return `<div class="usage-fact-strip">
    ${factHtml('Data sent', formatBytes(totals.requestBytes), 'authenticated MCP payload bytes')}
    ${factHtml('Data returned', formatBytes(totals.resultBytes), 'gateway response bytes')}
    ${factHtml('Avg tool time', formatDuration(totals.toolCalls ? totals.executionMs / totals.toolCalls : 0), 'per observed tool call')}
  </div>`;
}

function factHtml(label, value, detail) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`;
}

function outcomesSection(scope) {
  const completed = scope.successes + scope.failures;
  const successRate = completed ? (scope.successes / completed) * 100 : 0;
  return `<section class="card usage-visual-card">
    <div class="card-head"><div><h3>Outcomes</h3><p>Exact terminal outcomes for observed tool calls.</p></div><strong class="usage-visual-value">${formatPercent(successRate)}</strong></div>
    <div class="card-body usage-outcomes">
      <progress class="usage-outcome-progress" max="${Math.max(1, completed)}" value="${scope.successes}">${formatPercent(successRate)}</progress>
      <div class="usage-outcome-legend">
        ${outcomeLegend('Successful', scope.successes, 'good')}
        ${outcomeLegend('Failed', scope.failures, 'bad')}
      </div>
    </div>
  </section>`;
}

function outcomeLegend(label, value, tone) {
  return `<div class="${tone}"><span><i aria-hidden="true"></i>${escapeHtml(label)}</span><strong>${formatInteger(value)}</strong></div>`;
}

function workspaceComparisonSection(rows, selectedWorkspace) {
  const current = rows.find(row => row.workspace === selectedWorkspace) || { toolCalls: 0 };
  const total = rows.reduce((sum, row) => sum + row.toolCalls, 0);
  const rank = rows.length ? [...rows].sort((a, b) => b.toolCalls - a.toolCalls).findIndex(row => row.workspace === selectedWorkspace) + 1 : 0;
  return `<section class="card usage-visual-card">
    <div class="card-head"><div><h3>Workspace position</h3><p>Relative to other workspace aliases in this monthly rollup.</p></div></div>
    <div class="card-body usage-workspace-summary">
      ${factHtml('Tool-call share', formatPercent(total ? current.toolCalls / total * 100 : 0), 'of attributed workspace calls')}
      ${factHtml('Activity rank', rank ? `#${rank}` : '—', `${formatInteger(rows.length)} observed workspace${rows.length === 1 ? '' : 's'}`)}
    </div>
  </section>`;
}

function activityBarsSection(title, description, rows, key, selected = '') {
  const visible = [...rows].sort((a, b) => b.toolCalls - a.toolCalls).slice(0, 10);
  const max = Math.max(1, ...visible.map(row => row.toolCalls));
  const body = visible.length
    ? `<div class="usage-bar-list">${visible.map(row => activityBarRow(row, key, max, selected)).join('')}</div>`
    : '<div class="usage-breakdown-empty">No recorded activity for this month.</div>';
  return `<section class="card usage-breakdown usage-bar-card"><div class="card-head"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></div><div class="card-body">${body}</div></section>`;
}

function activityBarRow(row, key, max, selected) {
  const label = key === 'workspace' ? (row.workspace || 'Unattributed') : (row.tool || 'Unknown tool');
  const content = `<span class="usage-bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span><progress max="${max}" value="${row.toolCalls}">${formatInteger(row.toolCalls)}</progress><strong>${formatInteger(row.toolCalls)}</strong>`;
  if (key !== 'workspace' || !row.workspace) return `<div class="usage-bar-row">${content}</div>`;
  const active = row.workspace === selected ? ' active' : '';
  return `<a class="usage-bar-row usage-bar-link${active}" href="${routeHref('usage', { workspace: row.workspace })}">${content}</a>`;
}

function breakdownSection(title, description, rows, key) {
  const body = rows.length
    ? `<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th scope="col">${escapeHtml(title.slice(0, -1))}</th><th scope="col">Tool calls</th><th scope="col">Successful</th><th scope="col">Failed</th><th scope="col">Execution time</th></tr></thead><tbody>${rows.map(row => breakdownRow(row, key)).join('')}</tbody></table></div>`
    : '<div class="usage-breakdown-empty">No recorded activity for this month.</div>';
  return `<section class="card usage-breakdown"><div class="card-head"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></div><div class="card-body">${body}</div></section>`;
}

function breakdownRow(row, key) {
  const label = key === 'device'
    ? (row.displayName || shortId(row.deviceId) || 'Unknown device')
    : key === 'workspace'
      ? (row.workspace || 'Unattributed')
      : (row.tool || 'Unknown tool');
  return `<tr><th scope="row">${escapeHtml(label)}</th><td>${formatInteger(row.toolCalls)}</td><td>${formatInteger(row.successes)}</td><td>${formatInteger(row.failures)}</td><td>${formatDuration(row.executionMs)}</td></tr>`;
}

function requireTotals(value) {
  if (!value || typeof value !== 'object') throw new Error('Usage unavailable: monthly totals were not returned by the gateway.');
  return Object.fromEntries(EXACT_METRICS.map(([key]) => [key, exactNumber(value[key], key)]));
}

function normalizeBreakdown(value, key) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const row = item && typeof item === 'object' ? item : {};
    return {
      ...(key === 'tool' ? { tool: String(row.tool || '') } : {}),
      ...(key === 'device' ? { deviceId: String(row.deviceId || ''), displayName: String(row.displayName || '') } : {}),
      ...(key === 'workspace' ? { workspace: String(row.workspace || '') } : {}),
      toolCalls: exactNumber(row.toolCalls ?? row.calls, `${key}.toolCalls`),
      successes: exactNumber(row.successes, `${key}.successes`),
      failures: exactNumber(row.failures, `${key}.failures`),
      executionMs: exactNumber(row.executionMs, `${key}.executionMs`)
    };
  });
}

function exactNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Usage unavailable: invalid ${field} value.`);
  return number;
}

function normalizeMonth(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return '';
  return text;
}

function monthLabel(value) {
  const [year, month] = value.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  } catch {
    return value;
  }
}

function formatInteger(value) {
  return Math.floor(Number(value) || 0).toLocaleString();
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return `${number.toFixed(number >= 10 ? 1 : 2)}%`;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${Math.floor(bytes).toLocaleString()} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount >= 100 ? amount.toFixed(0) : amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unit]}`;
}

function formatDuration(value) {
  const ms = Number(value) || 0;
  if (ms < 1000) return `${Math.floor(ms).toLocaleString()} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)} min`;
  return `${(minutes / 60).toFixed(2)} h`;
}

function shortId(value) {
  const text = String(value || '');
  return text.length > 12 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Usage unavailable.');
}