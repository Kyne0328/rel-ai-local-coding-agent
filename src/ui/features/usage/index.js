import { closeModal, openModal } from '../../components/modal.js';

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
  container.innerHTML = `
    <section class="usage-page" data-usage-page>
      <div class="feature-toolbar usage-toolbar">
        <div>
          <h2>Usage</h2>
          <p>Exact Rel.AI-observed MCP activity for the selected UTC month. Repository contents, prompts, and tool result bodies are not part of these rollups.</p>
        </div>
        <div class="usage-toolbar-controls">
          <label class="usage-month-control"><span>Month</span><input type="month" data-usage-month value="${month}" max="${month}" /></label>
          <button type="button" class="secondary" data-usage-refresh>Refresh</button>
        </div>
      </div>
      <div class="usage-content" data-usage-content aria-live="polite"></div>
    </section>`;

  const root = container.querySelector('[data-usage-page]');
  const monthInput = root.querySelector('[data-usage-month]');
  const refreshButton = root.querySelector('[data-usage-refresh]');
  const content = root.querySelector('[data-usage-content]');

  const refresh = () => loadUsage({ root, monthInput, refreshButton, content, generation });
  monthInput.addEventListener('change', refresh);
  refreshButton.addEventListener('click', refresh);
  await refresh();
}

async function loadUsage({ root, monthInput, refreshButton, content, generation }) {
  const month = normalizeMonth(monthInput.value);
  if (!month) {
    renderUnavailable(content, 'Choose a valid month in YYYY-MM format.', () => monthInput.focus());
    return;
  }
  monthInput.value = month;
  refreshButton.disabled = true;
  refreshButton.textContent = 'Loading…';
  content.setAttribute('aria-busy', 'true');
  content.innerHTML = '<div class="usage-loading">Loading exact Rel.AI usage…</div>';

  try {
    const desktop = window.relaiDesktop;
    if (!desktop?.getGatewayUsage) throw new Error('Rel.AI Cloud usage is available in the installed desktop app.');
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
    renderUsage(content, model);
  } catch (error) {
    if (generation !== mountedGeneration || !root.isConnected) return;
    const availability = cloudUsageAvailabilityFromError(error);
    if (availability) {
      renderCloudUsageBlocked(content, availability);
      showCloudUsageModal(availability);
      return;
    }
    renderUnavailable(content, messageOf(error), () => loadUsage({ root, monthInput, refreshButton, content, generation }));
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

function renderUsage(content, model) {
  content.innerHTML = `
    <section class="usage-overview" aria-label="${escapeHtml(model.month)} usage totals">
      <div class="usage-month-summary"><div><span class="field-caption">UTC month</span><strong>${escapeHtml(monthLabel(model.month))}</strong></div><p>Counts and byte totals are recorded by the Rel.AI gateway from authenticated MCP traffic. They do not represent ChatGPT model-token usage or billing.</p></div>
      <div class="usage-metrics">${EXACT_METRICS.map(([key, label, format]) => metricHtml(label, format(model.totals[key]))).join('')}</div>
    </section>
    ${breakdownSection('Tools', 'Exact completed tool-call outcomes observed by Rel.AI.', model.tools, 'tool')}
    ${breakdownSection('Devices', 'Usage attributed to paired Rel.AI devices.', model.devices, 'device')}
    ${breakdownSection('Workspaces', 'Usage attributed only to configured workspace aliases, never local absolute paths.', model.workspaces, 'workspace')}`;
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

function metricHtml(label, value) {
  return `<article class="usage-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
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
      toolCalls: exactNumber(row.toolCalls, `${key}.toolCalls`),
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
