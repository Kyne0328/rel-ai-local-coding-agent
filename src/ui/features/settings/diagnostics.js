import { fetchJson, postJson, requestDashboardRefresh } from '../../api.js';
import { copyText } from '../../clipboard.js';
import { runButtonAction } from '../../action-state.js';
import { toast } from '../../components/toast.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { esc, timeAgo } from '../../utils.js';
import { getWorkspaceFilter } from '../../router.js';

const LIVE_TAIL_INTERVAL_MS = 2000;
let currentReport = null;
let currentContainer = null;
let liveTailTimer = 0;
let liveTailLoading = false;
let liveTailEnabled = false;
const filters = { search: '', severity: 'all', source: 'all' };

export function mountDiagnostics(container) {
  stopLiveTail();
  currentContainer = container;
  filters.search = '';
  filters.severity = 'all';
  filters.source = 'all';
  container.innerHTML = `
    <div class="section-head diagnostic-page-head">
      <div><h2>Diagnostics</h2><p>Filter current findings, follow sanitized service logs, export state, and manage local diagnostic data.</p></div>
      <div class="section-head-actions diagnostic-page-actions">
        <button class="secondary" type="button" data-copy-report disabled>Copy report</button>
        <button class="secondary" type="button" data-export-report disabled>Export state</button>
        <button class="secondary" type="button" data-open-diagnostics-folder>Open diagnostics folder</button>
      </div>
    </div>
    <div class="diagnostic-toolbar" aria-label="Diagnostic filters">
      <label class="diagnostic-search-control">
        <span>Search diagnostics</span>
        <input type="search" data-diagnostic-search placeholder="Error code, source, message, or workspace" autocomplete="off">
      </label>
      <label>
        <span>Severity</span>
        <select data-diagnostic-severity>
          <option value="all">All severities</option>
          <option value="error">Blocking</option>
          <option value="warning">Warnings</option>
          <option value="info">Recommendations</option>
        </select>
      </label>
      <label>
        <span>Source</span>
        <select data-diagnostic-source><option value="all">All sources</option></select>
      </label>
      <button class="secondary diagnostic-live-tail" type="button" data-live-tail aria-pressed="false">Live tail off</button>
      <span class="diagnostic-filter-summary" data-diagnostic-filter-summary aria-live="polite"></span>
    </div>
    <div id="diagnosticSummary" class="diagnostic-summary"><div class="empty">Loading diagnostics…</div></div>`;
  bindHeaderActions(container);
  bindFilters(container);
  bindLiveTail(container);
  return loadDiagnostics(container);
}

async function loadDiagnostics(container, options = {}) {
  if (!container?.querySelector('#diagnosticSummary')) return;
  const root = container.querySelector('#diagnosticSummary');
  const workspace = getWorkspaceFilter();
  const url = '/api/diagnostics' + (workspace ? `?workspace=${encodeURIComponent(workspace)}` : '');
  const report = await fetchJson(url, { cache: 'no-store' });
  if (!report?.ok) {
    if (options.silent) {
      stopLiveTail();
      updateLiveTailButton(container);
      toast(report?.error || 'Live diagnostics could not be refreshed.', { variant: 'error' });
      return;
    }
    currentReport = null;
    root.innerHTML = unavailableHtml(report);
    setReportActionsEnabled(container, false);
    return;
  }
  currentReport = report;
  updateSourceOptions(container, report);
  renderCurrentReport(container);
  setReportActionsEnabled(container, true);
  scrollLogTails(container);
}

function renderCurrentReport(container) {
  const root = container.querySelector('#diagnosticSummary');
  if (!root || !currentReport) return;
  const view = filteredDiagnosticView(currentReport);
  root.innerHTML = renderReport(currentReport, view);
  bindMaintenance(root, container);
  const summary = container.querySelector('[data-diagnostic-filter-summary]');
  if (summary) summary.textContent = filterSummary(view);
}

function bindHeaderActions(container) {
  const copyButton = container.querySelector('[data-copy-report]');
  copyButton.onclick = async () => {
    const result = await runButtonAction(copyButton, {
      idleText: 'Copy report', loadingText: 'Copying report…', successText: 'Report copied', errorText: 'Copy failed'
    }, async () => {
      if (!currentReport?.reportText) return { ok: false, error: 'No diagnostic report is available.' };
      await copyText(currentReport.reportText);
      return { ok: true };
    });
    toast(result?.ok ? 'Sanitized diagnostic report copied.' : result?.error || 'Could not copy the report.', { variant: result?.ok ? 'success' : 'error' });
  };

  const exportButton = container.querySelector('[data-export-report]');
  exportButton.onclick = async () => {
    const result = await runButtonAction(exportButton, {
      idleText: 'Export state', loadingText: 'Exporting state…', successText: 'State exported', errorText: 'Export failed'
    }, async () => {
      if (!currentReport) return { ok: false, error: 'No diagnostic state is available.' };
      if (typeof window.relaiDesktop?.exportDiagnosticState === 'function') {
        return window.relaiDesktop.exportDiagnosticState(currentReport);
      }
      return downloadDiagnosticState(currentReport);
    });
    if (result?.ok) toast(`Sanitized diagnostic state exported${result.filename ? ` as ${result.filename}` : ''}.`, { variant: 'success' });
    else toast(result?.error || 'Could not export diagnostic state.', { variant: 'error' });
  };

  const folderButton = container.querySelector('[data-open-diagnostics-folder]');
  const canOpenFolder = typeof window.relaiDesktop?.openDiagnosticsFolder === 'function';
  folderButton.disabled = !canOpenFolder;
  if (!canOpenFolder) folderButton.title = 'The diagnostics folder is available in the installed desktop app.';
  folderButton.onclick = async () => {
    if (!canOpenFolder) return;
    const result = await runButtonAction(folderButton, {
      idleText: 'Open diagnostics folder', loadingText: 'Opening folder…', successText: 'Folder opened', errorText: 'Open failed'
    }, () => window.relaiDesktop.openDiagnosticsFolder());
    toast(result?.ok ? 'Diagnostics folder opened.' : result?.error || 'Could not open the diagnostics folder.', { variant: result?.ok ? 'success' : 'error' });
  };
}

function bindFilters(container) {
  const search = container.querySelector('[data-diagnostic-search]');
  const severity = container.querySelector('[data-diagnostic-severity]');
  const source = container.querySelector('[data-diagnostic-source]');
  search.addEventListener('input', () => {
    filters.search = search.value.trim().toLowerCase();
    renderCurrentReport(container);
  });
  severity.addEventListener('change', () => {
    filters.severity = severity.value;
    renderCurrentReport(container);
  });
  source.addEventListener('change', () => {
    filters.source = source.value;
    renderCurrentReport(container);
  });
}

function bindLiveTail(container) {
  const button = container.querySelector('[data-live-tail]');
  button.onclick = () => {
    if (liveTailEnabled) stopLiveTail();
    else startLiveTail(container);
    updateLiveTailButton(container);
  };
}

function startLiveTail(container) {
  stopLiveTail();
  liveTailEnabled = true;
  currentContainer = container;
  void refreshLiveTail();
  liveTailTimer = window.setInterval(refreshLiveTail, LIVE_TAIL_INTERVAL_MS);
}

function stopLiveTail() {
  liveTailEnabled = false;
  if (liveTailTimer) window.clearInterval(liveTailTimer);
  liveTailTimer = 0;
  liveTailLoading = false;
}

async function refreshLiveTail() {
  if (liveTailLoading) return;
  if (!currentContainer || !document.contains(currentContainer) || !location.hash.startsWith('#settings/diagnostics')) {
    stopLiveTail();
    return;
  }
  liveTailLoading = true;
  try {
    await loadDiagnostics(currentContainer, { silent: true });
  } finally {
    liveTailLoading = false;
  }
}

function updateLiveTailButton(container) {
  const button = container.querySelector('[data-live-tail]');
  if (!button) return;
  button.textContent = liveTailEnabled ? 'Live tail on' : 'Live tail off';
  button.setAttribute('aria-pressed', String(liveTailEnabled));
  button.classList.toggle('active', liveTailEnabled);
}

function updateSourceOptions(container, report) {
  const select = container.querySelector('[data-diagnostic-source]');
  if (!select) return;
  const sources = new Set();
  for (const entry of report.logs?.runtime?.entries || []) sources.add(String(entry.source || 'desktop'));
  for (const entry of report.logs?.failedActivity || []) sources.add(String(entry.tool || 'activity'));
  const available = [...sources].filter(Boolean).sort((left, right) => left.localeCompare(right));
  select.replaceChildren(optionElement('all', 'All sources'), ...available.map(source => optionElement(source, source)));
  if (!available.includes(filters.source)) filters.source = 'all';
  select.value = filters.source;
}

function optionElement(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function setReportActionsEnabled(container, enabled) {
  container.querySelector('[data-copy-report]').disabled = !enabled || !currentReport?.reportText;
  container.querySelector('[data-export-report]').disabled = !enabled || !currentReport;
}

function bindMaintenance(root, container) {
  for (const button of root.querySelectorAll('[data-reset-target]')) {
    button.onclick = () => resetDiagnosticData(button, container);
  }
  root.querySelector('[data-reset-all]')?.addEventListener('click', () => openFullResetDialog(container));
}

async function resetDiagnosticData(button, container) {
  const target = button.dataset.resetTarget;
  const history = target === 'history';
  const confirmed = await confirmAction({
    title: history ? 'Clear history' : 'Clear service log',
    message: history ? 'Clear session and activity history?' : 'Clear the persistent service log?',
    detail: 'This diagnostic data cannot be restored. Workspace and connection configuration will not change.',
    confirmLabel: history ? 'Clear history' : 'Clear service log',
    danger: true
  });
  if (!confirmed) return;
  const result = await runButtonAction(button, {
    idleText: button.textContent,
    loadingText: 'Clearing…',
    successText: 'Cleared',
    errorText: 'Clear failed'
  }, () => postJson('/api/diagnostics/reset', { target, confirm: true }));
  if (!result?.ok) {
    toast(result?.error || 'Could not clear diagnostic data.', { variant: 'error' });
    return;
  }
  toast(result.message || 'Diagnostic data cleared.', { variant: 'success' });
  requestDashboardRefresh();
  await loadDiagnostics(container);
}

function openFullResetDialog(container) {
  const state = currentReport?.maintenance?.all || {};
  if (state.available === false || state.blocked === true) {
    toast(state.reason || 'Full diagnostic reset is currently unavailable.', { variant: 'warn' });
    return;
  }
  const form = document.createElement('form');
  form.className = 'diagnostic-reset-form';
  form.innerHTML = `
    <div class="diagnostic-reset-warning">
      <strong>Clear all diagnostic data?</strong>
      <span>This removes stored Sessions and Activity history plus the persistent sanitized service log. Workspace configuration, repositories, connection settings, and approval tokens are not changed.</span>
    </div>
    <label for="diagnosticResetConfirmation">Type RESET to continue</label>
    <input id="diagnosticResetConfirmation" name="confirmation" autocomplete="off" spellcheck="false" placeholder="RESET">
    <div class="ws-form-actions">
      <button type="button" class="secondary" data-cancel>Cancel</button>
      <button type="submit" class="danger" disabled>Clear all diagnostic data</button>
    </div>`;
  const input = form.querySelector('input[name="confirmation"]');
  const submit = form.querySelector('button[type="submit"]');
  input.addEventListener('input', () => { submit.disabled = input.value.trim() !== 'RESET'; });
  form.querySelector('[data-cancel]').onclick = closeModal;
  form.onsubmit = async event => {
    event.preventDefault();
    const result = await runButtonAction(submit, {
      idleText: 'Clear all diagnostic data', loadingText: 'Clearing all data…', successText: 'All data cleared', errorText: 'Reset failed'
    }, () => postJson('/api/diagnostics/reset', { target: 'all', confirm: true, confirmation: input.value.trim() }));
    if (!result?.ok) {
      toast(result?.error || 'Could not clear all diagnostic data.', { variant: 'error' });
      return;
    }
    closeModal();
    toast(result.message || 'All diagnostic data cleared.', { variant: 'success' });
    requestDashboardRefresh();
    await loadDiagnostics(container);
  };
  openModal({ title: 'Full diagnostic reset', content: form });
  setTimeout(() => input.focus(), 0);
}

function filteredDiagnosticView(report) {
  const findings = (report.findings || []).filter(matchesFinding);
  const runtime = (report.logs?.runtime?.entries || []).filter(entry => matchesLog(entry, 'runtime'));
  const failed = (report.logs?.failedActivity || []).filter(entry => matchesLog(entry, 'failed'));
  return {
    findings,
    runtime,
    failed,
    totalFindings: (report.findings || []).length,
    totalLogs: (report.logs?.runtime?.entries || []).length + (report.logs?.failedActivity || []).length,
    shownLogs: runtime.length + failed.length
  };
}

function matchesFinding(finding) {
  if (filters.severity !== 'all' && finding.severity !== filters.severity) return false;
  return matchesSearch([finding.code, finding.title, finding.impact, finding.recommendation, JSON.stringify(finding.context || [])]);
}

function matchesLog(entry, kind) {
  const level = kind === 'failed' ? 'error' : entry.level || (entry.error ? 'error' : 'info');
  const source = String(kind === 'failed' ? entry.tool || 'activity' : entry.source || 'desktop');
  if (filters.severity !== 'all' && level !== filters.severity) return false;
  if (filters.source !== 'all' && source !== filters.source) return false;
  return matchesSearch([source, entry.code, entry.errorCode, entry.message, entry.error, entry.workspace]);
}

function matchesSearch(values) {
  if (!filters.search) return true;
  return values.some(value => String(value || '').toLowerCase().includes(filters.search));
}

function renderReport(report, view) {
  const body = view.findings.length
    ? `<div class="diagnostic-list">${view.findings.map(findingCard).join('')}</div>`
    : view.totalFindings === 0
      ? '<div class="diagnostic-clear"><strong>All clear</strong><span>No blocking errors or warnings were found.</span></div>'
      : '<div class="diagnostic-log-empty"><strong>No findings match the current filters.</strong></div>';
  return summaryCards(countFindings(view.findings))
    + body
    + logsHtml(report.logs || {}, view)
    + maintenanceHtml(report.maintenance || {});
}

function summaryCards(summary) {
  return `<div class="diagnostic-metrics">
    ${metric('Blocking', summary.blocking, 'error')}
    ${metric('Warnings', summary.warnings, 'warning')}
    ${metric('Recommendations', summary.recommendations, 'info')}
  </div>`;
}

function countFindings(findings) {
  const summary = { blocking: 0, warnings: 0, recommendations: 0 };
  for (const finding of findings) {
    if (finding.severity === 'error') summary.blocking += 1;
    else if (finding.severity === 'warning') summary.warnings += 1;
    else summary.recommendations += 1;
  }
  return summary;
}

function metric(label, count, severity) {
  return `<div class="diagnostic-metric ${severity}"><span>${esc(label)}</span><strong>${Number(count || 0)}</strong></div>`;
}

function findingCard(finding) {
  const action = finding.action?.href
    ? `<a class="buttonlike secondary compact-button" href="${esc(finding.action.href)}">${esc(finding.action.label || 'Open')}</a>`
    : '';
  return `<article class="diagnostic-finding ${esc(finding.severity)}">
    <div class="diagnostic-severity">${esc(finding.severity)}</div>
    <div class="diagnostic-copy">
      <div class="diagnostic-code">${esc(finding.code)}</div>
      <h3>${esc(finding.title)}</h3>
      <p><strong>Impact:</strong> ${esc(finding.impact)}</p>
      <p><strong>Recommended action:</strong> ${esc(finding.recommendation)}</p>
      ${findingContext(finding.context)}
      ${action}
      <details><summary>Technical details</summary><pre>${esc(JSON.stringify(finding.details || {}, null, 2))}</pre></details>
    </div>
  </article>`;
}

function findingContext(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  return `<div class="diagnostic-context">${entries.map(entry => `
    <div class="diagnostic-context-row">
      <code>${esc(entry.tool || 'configuration change')}</code>
      <span>${esc(timeAgo(entry.ts))}</span>
      <small>${esc(entry.path || entry.reason || 'No additional context recorded.')}</small>
    </div>`).join('')}</div>`;
}

function logsHtml(logs, view) {
  const runtime = logs.runtime || { available: false, entries: [] };
  const runtimeEmpty = runtime.available ? 'No service messages match the current filters.' : 'Service logs are available in the desktop app.';
  return `<div class="diagnostic-log-grid">
    ${logPanel('Service log', view.runtime, runtimeEmpty, runtime.available, runtime.persistent ? 'Persistent sanitized log' : '')}
    ${logPanel('Failed activity', view.failed, 'No failed activity matches the current filters.', true, '')}
  </div>`;
}

function logPanel(title, entries, emptyText, available, subtitle) {
  const rows = available && entries.length
    ? entries.map(logRow).join('')
    : `<div class="diagnostic-log-empty">${esc(emptyText)}</div>`;
  return `<section class="card diagnostic-log-card">
    <div class="card-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><span class="section-action">${available ? `${entries.length} shown` : 'Unavailable'}</span></div>
    <div class="card-body diagnostic-log-list" role="log" aria-live="polite">${rows}</div>
  </section>`;
}

function logRow(entry) {
  const message = entry.message || entry.error || 'Recorded diagnostic event';
  const source = entry.source || entry.tool || 'activity';
  const level = entry.level || (entry.error ? 'error' : 'info');
  return `<div class="diagnostic-log-row ${esc(level)}">
    <time>${esc(timeAgo(entry.ts))}</time>
    <code>${esc(source)}</code>
    <span>${esc(message)}</span>
    ${entry.code || entry.errorCode ? `<small>${esc(entry.code || entry.errorCode)}</small>` : ''}
  </div>`;
}

function maintenanceHtml(maintenance) {
  return `<section class="card diagnostic-maintenance">
    <div class="card-head"><div><h3>Local diagnostic data</h3><p>Clear only the data no longer needed for troubleshooting. Repository files and connection credentials are never removed here.</p></div></div>
    <div class="card-body diagnostic-maintenance-list">
      ${maintenanceRow('Session and activity history', 'Removes stored Sessions and Activity entries. Active tool calls are protected.', 'history', maintenance.history, 'Clear history')}
      ${maintenanceRow('Persistent service log', 'Clears the in-memory and on-disk sanitized service log.', 'runtime_logs', maintenance.runtimeLogs, 'Clear service log')}
      ${fullResetRow(maintenance.all)}
    </div>
  </section>`;
}

function maintenanceRow(title, description, target, state = {}, buttonLabel) {
  const disabled = state.available === false || state.blocked === true;
  return `<div class="diagnostic-maintenance-row">
    <div><strong>${esc(title)}</strong><span>${esc(state.reason || description)}</span></div>
    <button class="secondary danger" type="button" data-reset-target="${target}" ${disabled ? 'disabled' : ''}>${esc(buttonLabel)}</button>
  </div>`;
}

function fullResetRow(state = {}) {
  const disabled = state.available === false || state.blocked === true;
  return `<div class="diagnostic-maintenance-row diagnostic-full-reset-row">
    <div><strong>All diagnostic data</strong><span>${esc(state.reason || 'Clears session history, activity history, and the persistent service log after typed confirmation.')}</span></div>
    <button class="danger" type="button" data-reset-all ${disabled ? 'disabled' : ''}>Clear all data</button>
  </div>`;
}

function filterSummary(view) {
  return `${view.findings.length} of ${view.totalFindings} findings · ${view.shownLogs} of ${view.totalLogs} log entries shown`;
}

function scrollLogTails(container) {
  for (const element of container.querySelectorAll('.diagnostic-log-list')) element.scrollTop = element.scrollHeight;
}

function downloadDiagnosticState(report) {
  const exportedAt = new Date().toISOString();
  const payload = { schemaVersion: 1, exportedAt, report };
  const filename = `relai-diagnostic-state-${exportedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-')}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, filename };
}

function unavailableHtml(report) {
  const title = report?.title || 'Diagnostics unavailable';
  const message = report?.error || 'The local service did not return a diagnostic report.';
  const recovery = report?.recovery?.message || 'Refresh the dashboard or restart the local service.';
  const href = report?.recovery?.href || '#settings/connection';
  return `<div class="diagnostic-clear diagnostic-unavailable">
    <strong>${esc(title)}</strong><span>${esc(message)}</span><small>${esc(recovery)}</small>
    <a class="buttonlike secondary" href="${esc(href)}">${esc(report?.recovery?.actionLabel || 'Open Connection')}</a>
  </div>`;
}
