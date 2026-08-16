import { fetchJson, postJson, requestDashboardRefresh } from '../../api.js';
import { copyText } from '../../clipboard.js';
import { runButtonAction } from '../../action-state.js';
import { toast } from '../../components/toast.js';
import { createFilterBar } from '../../components/filter-bar.js';
import { filterSelectField, openFilterDrawer } from '../../components/filter-drawer.js';
import { openModal, closeModal } from '../../components/modal.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { esc, timeAgo } from '../../utils.js';
import { getWorkspaceFilter } from '../../router.js';
import { get as getStore } from '../../store.js';
import { restartConnection } from './connection-recovery.js';
import { clientCapabilityViews } from '../../task-identity.js';

const LIVE_TAIL_REFRESH_DELAY_MS = 160;
let currentReport = null;
let currentContainer = null;
let liveTailRefreshTimer = 0;
let liveTailLoading = false;
let liveTailEnabled = false;
const filters = { search: '', scope: 'all', severity: 'all', source: 'all' };
let availableSources = [];

export function mountDiagnostics(container) {
  stopLiveTail();
  currentContainer = container;
  filters.search = '';
  filters.scope = 'all';
  filters.severity = 'all';
  filters.source = 'all';
  container.innerHTML = `
    <div class="diagnostic-page">
      <div class="section-head diagnostic-page-head">
        <div><h2>Troubleshooting</h2><p>Find problems, view app logs with sensitive values removed, and export support information.</p></div>
        <div class="section-head-actions diagnostic-page-actions">
          <button class="secondary" type="button" data-copy-report disabled>Copy report</button>
          <button class="secondary" type="button" data-export-report disabled>Export support info</button>
          <button class="secondary" type="button" data-open-diagnostics-folder>Open support folder</button>
        </div>
      </div>
      <div id="diagnosticFilterHost"></div>
      <div class="sr-only" data-diagnostic-live-status role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="diagnosticSummary" class="diagnostic-summary"><div class="empty">Loading troubleshooting info…</div></div>
    </div>`;
  bindHeaderActions(container);
  renderDiagnosticFilterBar(container);
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
      toast(report?.error || 'Troubleshooting info could not be refreshed.', { variant: 'error' });
      return;
    }
    currentReport = null;
    root.innerHTML = unavailableHtml(report);
    setReportActionsEnabled(container, false);
    return;
  }
  currentReport = report;
  updateSourceOptions(report);
  renderCurrentReport(container);
  setReportActionsEnabled(container, true);
}

function renderCurrentReport(container) {
  const root = container.querySelector('#diagnosticSummary');
  if (!root || !currentReport) return;
  const logScrollState = captureLogScrollState(root);
  const view = filteredDiagnosticView(currentReport);
  syncDiagnosticRegions(root, renderReport(currentReport, view));
  restoreLogScrollState(root, logScrollState);
  bindMaintenance(root, container);
  bindFindingActions(root, container);
  const summary = container.querySelector('#diagnosticFilterHost .filter-summary');
  if (summary) summary.textContent = filterSummary(view);
  const clear = container.querySelector('#diagnosticFilterHost .filter-clear-button');
  if (clear) clear.hidden = !hasDiagnosticFilters();
}

function syncDiagnosticRegions(root, markup) {
  const detached = document.createElement('div');
  detached.innerHTML = markup;
  const desired = [...detached.children];
  for (let index = 0; index < desired.length; index += 1) {
    const nextRegion = desired[index];
    const currentRegion = root.children[index] || null;
    if (currentRegion?.dataset.diagnosticRegion === nextRegion.dataset.diagnosticRegion) {
      if (currentRegion.isEqualNode(nextRegion)) continue;
      const state = captureDiagnosticInteraction(currentRegion);
      copyDiagnosticDisclosureState(currentRegion, nextRegion);
      currentRegion.replaceWith(nextRegion);
      restoreDiagnosticFocus(nextRegion, state);
      continue;
    }
    if (currentRegion) currentRegion.replaceWith(nextRegion);
    else root.appendChild(nextRegion);
  }
  while (root.children.length > desired.length) root.lastElementChild?.remove();
}

function copyDiagnosticDisclosureState(currentRegion, nextRegion) {
  for (const currentDetail of currentRegion.querySelectorAll('details[data-diagnostic-detail]')) {
    const key = currentDetail.dataset.diagnosticDetail;
    const nextDetail = [...nextRegion.querySelectorAll('details[data-diagnostic-detail]')]
      .find(node => node.dataset.diagnosticDetail === key);
    if (nextDetail) nextDetail.open = currentDetail.open;
  }
}

function captureDiagnosticInteraction(region) {
  const active = document.activeElement;
  if (!active || !region.contains(active)) return null;
  if (active.matches('[data-reset-target]')) return { kind: 'reset', value: active.dataset.resetTarget || '' };
  if (active.matches('[data-reset-all]')) return { kind: 'reset-all' };
  if (active.matches('[data-diagnostic-action]')) return { kind: 'action', value: active.dataset.diagnosticAction || '' };
  const detail = active.closest?.('details[data-diagnostic-detail]');
  if (detail && active.matches('summary')) return { kind: 'detail', value: detail.dataset.diagnosticDetail || '' };
  return null;
}

function restoreDiagnosticFocus(region, state) {
  if (!state) return;
  let target = null;
  if (state.kind === 'reset') target = [...region.querySelectorAll('[data-reset-target]')].find(node => node.dataset.resetTarget === state.value);
  else if (state.kind === 'reset-all') target = region.querySelector('[data-reset-all]');
  else if (state.kind === 'action') target = [...region.querySelectorAll('[data-diagnostic-action]')].find(node => node.dataset.diagnosticAction === state.value);
  else if (state.kind === 'detail') {
    const detail = [...region.querySelectorAll('details[data-diagnostic-detail]')].find(node => node.dataset.diagnosticDetail === state.value);
    target = detail?.querySelector('summary') || null;
  }
  target?.focus({ preventScroll: true });
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
      idleText: 'Export support info', loadingText: 'Exporting…', successText: 'Support info exported', errorText: 'Export failed'
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
  if (!canOpenFolder) folderButton.title = 'The support folder is available in the installed desktop app.';
  folderButton.onclick = async () => {
    if (!canOpenFolder) return;
    const result = await runButtonAction(folderButton, {
      idleText: 'Open support folder', loadingText: 'Opening folder…', successText: 'Folder opened', errorText: 'Open failed'
    }, () => window.relaiDesktop.openDiagnosticsFolder());
    toast(result?.ok ? 'Support folder opened.' : result?.error || 'Could not open the support folder.', { variant: result?.ok ? 'success' : 'error' });
  };
}

function renderDiagnosticFilterBar(container) {
  const host = container.querySelector('#diagnosticFilterHost');
  if (!host) return;
  const action = document.createElement('button');
  action.type = 'button';
  action.className = `secondary diagnostic-live-tail${liveTailEnabled ? ' active' : ''}`;
  action.dataset.liveTail = '';
  action.textContent = liveTailEnabled ? 'Live updates on' : 'Live updates off';
  action.setAttribute('aria-pressed', String(liveTailEnabled));
  action.addEventListener('click', () => {
    if (liveTailEnabled) stopLiveTail();
    else startLiveTail(container);
    renderDiagnosticFilterBar(container);
  });

  let searchTimer;
  const view = currentReport ? filteredDiagnosticView(currentReport) : null;
  host.replaceChildren(createFilterBar({
    search: {
      label: 'Search troubleshooting',
      placeholder: 'Search code, source, message, or project',
      value: filters.search,
      onInput: value => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          filters.search = value.trim().toLowerCase();
          renderCurrentReport(container);
        }, 120);
      }
    },
    filters: activeDiagnosticFilters(container),
    onOpenFilters: () => openDiagnosticFilters(container),
    onClearAll: () => {
      filters.search = '';
      filters.scope = 'all';
      filters.severity = 'all';
      filters.source = 'all';
      renderDiagnosticFilterBar(container);
      renderCurrentReport(container);
    },
    summary: view ? filterSummary(view) : 'Loading diagnostics…',
    action
  }));
}

function activeDiagnosticFilters(container) {
  const active = [];
  const add = (key, label, value, display) => {
    if (!value) return;
    active.push({
      label,
      value: display || value,
      onRemove: () => {
        filters[key] = 'all';
        if (key === 'scope' && filters.scope === 'findings') filters.source = 'all';
        renderDiagnosticFilterBar(container);
        renderCurrentReport(container);
      }
    });
  };
  if (filters.scope !== 'all') add('scope', 'Scope', filters.scope, scopeLabel(filters.scope));
  if (filters.severity !== 'all') add('severity', 'Severity', filters.severity, severityLabel(filters.severity));
  if (filters.source !== 'all') add('source', 'Source', filters.source);
  return active;
}

function openDiagnosticFilters(container) {
  openFilterDrawer({
    title: 'Diagnostic filters',
    value: { scope: filters.scope, severity: filters.severity, source: filters.source },
    resetValue: { scope: 'all', severity: 'all', source: 'all' },
    renderFields(fields, draft) {
      const sourceField = filterSelectField({
        label: 'Source',
        value: draft.source,
        options: [{ value: 'all', label: 'All sources' }, ...availableSources.map(source => ({ value: source, label: source }))],
        disabled: draft.scope === 'findings',
        help: draft.scope === 'findings' ? 'Source applies to service and failed activity logs.' : '',
        onChange: value => { draft.source = value; }
      });
      const scopeField = filterSelectField({
        label: 'Scope',
        value: draft.scope,
        options: [
          { value: 'all', label: 'Everything' },
          { value: 'findings', label: 'Findings' },
          { value: 'service', label: 'App log' },
          { value: 'failed', label: 'Failed activity' }
        ],
        onChange: value => {
          draft.scope = value;
          const select = sourceField.querySelector('select');
          const disabled = value === 'findings';
          select.disabled = disabled;
          if (disabled) {
            draft.source = 'all';
            select.value = 'all';
          }
          const help = sourceField.querySelector('small');
          if (help) help.textContent = disabled ? 'Source applies to service and failed activity logs.' : '';
        }
      });
      fields.append(
        scopeField,
        filterSelectField({
          label: 'Severity',
          value: draft.severity,
          options: [
            { value: 'all', label: 'All severities' },
            { value: 'error', label: 'Blocking' },
            { value: 'warning', label: 'Warnings' },
            { value: 'info', label: 'Recommendations' }
          ],
          onChange: value => { draft.severity = value; }
        }),
        sourceField
      );
    },
    onApply(draft) {
      filters.scope = draft.scope || 'all';
      filters.severity = draft.severity || 'all';
      filters.source = filters.scope === 'findings' ? 'all' : draft.source || 'all';
      renderDiagnosticFilterBar(container);
      renderCurrentReport(container);
    }
  });
}

function hasDiagnosticFilters() {
  return Boolean(filters.search || filters.scope !== 'all' || filters.severity !== 'all' || filters.source !== 'all');
}

function scopeLabel(value) {
  return { findings: 'Findings', service: 'App log', failed: 'Failed activity' }[value] || 'Everything';
}

function severityLabel(value) {
  return { error: 'Blocking', warning: 'Warnings', info: 'Recommendations' }[value] || value;
}

function startLiveTail(container) {
  stopLiveTail();
  liveTailEnabled = true;
  currentContainer = container;
  window.addEventListener('relai:diagnostics-live', handleLiveTailEvent);
}

function stopLiveTail() {
  liveTailEnabled = false;
  window.removeEventListener('relai:diagnostics-live', handleLiveTailEvent);
  if (liveTailRefreshTimer) window.clearTimeout(liveTailRefreshTimer);
  liveTailRefreshTimer = 0;
  liveTailLoading = false;
}

function handleLiveTailEvent(event) {
  if (!liveTailEnabled) return;
  if (!currentContainer || !document.contains(currentContainer) || !location.hash.startsWith('#diagnostics')) {
    stopLiveTail();
    return;
  }
  const detail = event.detail || {};
  const change = detail.type === 'diagnostics.updated' ? detail.data?.change : null;
  if (change?.type === 'append' && change.entry && currentReport?.logs?.runtime) {
    applyRuntimeLogDelta(change);
    return;
  }
  scheduleLiveTailRefresh();
}

function scheduleLiveTailRefresh() {
  if (document.visibilityState === 'hidden' || liveTailRefreshTimer) return;
  liveTailRefreshTimer = window.setTimeout(() => {
    liveTailRefreshTimer = 0;
    void refreshLiveTail();
  }, LIVE_TAIL_REFRESH_DELAY_MS);
}

async function refreshLiveTail() {
  if (liveTailLoading || document.visibilityState === 'hidden') return;
  liveTailLoading = true;
  try {
    await loadDiagnostics(currentContainer, { silent: true });
  } finally {
    liveTailLoading = false;
  }
}

function applyRuntimeLogDelta(change) {
  const runtime = currentReport.logs.runtime;
  const currentRevision = finiteRevision(runtime.revision);
  const incomingRevision = finiteRevision(change.revision);
  if (incomingRevision && incomingRevision <= currentRevision) return;
  if (incomingRevision && incomingRevision > currentRevision + 1) {
    scheduleLiveTailRefresh();
    return;
  }
  const entries = Array.isArray(runtime.entries) ? runtime.entries : [];
  runtime.entries = [...entries, change.entry].slice(-100);
  runtime.count = Math.max(Number(change.count || 0), Number(runtime.count || 0) + 1, runtime.entries.length);
  runtime.revision = incomingRevision || currentRevision;
  updateSourceOptions(currentReport);
  renderDiagnosticLogs(currentContainer);
  if (['warning', 'error'].includes(change.entry.level)) announceDiagnosticUpdate(change.entry);
}

function finiteRevision(value) {
  const revision = Number(value);
  return Number.isFinite(revision) ? Math.max(0, revision) : 0;
}

function renderDiagnosticLogs(container) {
  const root = container?.querySelector('#diagnosticSummary');
  const currentLogs = root?.querySelector('[data-diagnostic-region="logs"]');
  if (!root || !currentLogs || !currentReport) return;
  const scrollState = captureLogScrollState(currentLogs);
  const view = filteredDiagnosticView(currentReport);
  const detached = document.createElement('div');
  detached.innerHTML = logsHtml(currentReport.logs || {}, view);
  const nextLogs = detached.firstElementChild;
  if (!nextLogs) return;
  currentLogs.replaceWith(nextLogs);
  restoreLogScrollState(nextLogs, scrollState);
  const summary = container.querySelector('#diagnosticFilterHost .filter-summary');
  if (summary) summary.textContent = filterSummary(view);
}

function announceDiagnosticUpdate(entry) {
  const status = currentContainer?.querySelector('[data-diagnostic-live-status]');
  if (!status) return;
  const level = entry.level === 'error' ? 'error' : 'warning';
  status.textContent = `New app log ${level} from ${entry.source || 'Rel.AI'}.`;
}

function updateLiveTailButton(container) {
  const button = container.querySelector('[data-live-tail]');
  if (!button) return;
  button.textContent = liveTailEnabled ? 'Live updates on' : 'Live updates off';
  button.setAttribute('aria-pressed', String(liveTailEnabled));
  button.classList.toggle('active', liveTailEnabled);
}

function updateSourceOptions(report) {
  const sources = new Set();
  for (const entry of report.logs?.runtime?.entries || []) sources.add(String(entry.source || 'desktop'));
  for (const entry of report.logs?.failedActivity || []) sources.add(String(entry.tool || 'activity'));
  availableSources = [...sources].filter(Boolean).sort((left, right) => left.localeCompare(right));
  if (!availableSources.includes(filters.source)) filters.source = 'all';
}

function setReportActionsEnabled(container, enabled) {
  container.querySelector('[data-copy-report]').disabled = !enabled || !currentReport?.reportText;
  container.querySelector('[data-export-report]').disabled = !enabled || !currentReport;
}

function bindMaintenance(root, container) {
  for (const button of root.querySelectorAll('[data-reset-target]')) {
    button.onclick = () => resetDiagnosticData(button, container);
  }
  const resetAll = root.querySelector('[data-reset-all]');
  if (resetAll) resetAll.onclick = () => openFullResetDialog(container);
}

async function resetDiagnosticData(button, container) {
  const target = button.dataset.resetTarget;
  const history = target === 'history';
  const confirmed = await confirmAction({
    title: history ? 'Clear history' : 'Clear app log',
    message: history ? 'Clear task and activity history?' : 'Clear the saved app log?',
    detail: 'This troubleshooting data cannot be restored. Project and connection settings will not change.',
    confirmLabel: history ? 'Clear history' : 'Clear app log',
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
      <strong>Clear all troubleshooting data?</strong>
      <span>This removes saved Tasks and Activity history plus the saved app log. Project settings, project files, connection settings, and tunnel keys are not changed.</span>
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
  const showFindings = filters.scope === 'all' || filters.scope === 'findings';
  const showService = filters.scope === 'all' || filters.scope === 'service';
  const showFailed = filters.scope === 'all' || filters.scope === 'failed';
  const findings = showFindings ? (report.findings || []).filter(matchesFinding) : [];
  const runtime = showService ? (report.logs?.runtime?.entries || []).filter(entry => matchesLog(entry, 'runtime')) : [];
  const failed = showFailed ? (report.logs?.failedActivity || []).filter(entry => matchesLog(entry, 'failed')) : [];
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
  return matchesSearch([source, entry.code, entry.errorCode, entry.message, entry.error, entry.workspace, entry.taskId, entry.eventId]);
}

function matchesSearch(values) {
  if (!filters.search) return true;
  return values.some(value => String(value || '').toLowerCase().includes(filters.search));
}

function renderReport(report, view) {
  const body = view.findings.length
    ? `<div class="diagnostic-list" data-diagnostic-region="findings">${view.findings.map(findingCard).join('')}</div>`
    : view.totalFindings === 0
      ? '<div class="diagnostic-clear" data-diagnostic-region="findings"><strong>Current health looks good</strong><span>No current connection, project, or configuration problems were found. Recent failures can still appear in the logs below.</span></div>'
      : '<div class="diagnostic-log-empty" data-diagnostic-region="findings"><strong>No findings match the current filters.</strong></div>';
  return summaryCards(countFindings(view.findings))
    + body
    + clientCapabilityHtml()
    + logsHtml(report.logs || {}, view)
    + maintenanceHtml(report.maintenance || {});
}

function clientCapabilityHtml() {
  const capability = clientCapabilityViews({ mcpConnection: getStore().mcpConnection || {} })[0];
  const supported = capability.capabilityState === 'supported'
    ? 'true'
    : capability.capabilityState === 'not_advertised'
      ? 'false'
      : 'unknown';
  return `<details class="card connector-details diagnostic-client-capability" data-diagnostic-region="client-capability" data-diagnostic-detail="client-capability">
    <summary class="connector-details-summary"><span><strong>Client capability details</strong><small>Technical MCP information for troubleshooting</small></span><span aria-hidden="true">›</span></summary>
    <div class="card-body connection-status-body">
      <div class="connection-status-copy">
        <strong>${esc(capability.capabilityLabel)}</strong>
        <p>${esc(capability.description)}</p>
        <p>${esc(capability.executionLabel)}</p>
      </div>
      <div class="connection-field"><span class="field-caption">Observed MCP Tasks capability</span><code class="connector-endpoint">nativeTasksSupported: ${supported}</code></div>
    </div>
  </details>`;
}

function summaryCards(summary) {
  return `<div class="diagnostic-metrics" data-diagnostic-region="metrics">
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
  const canRestart = finding.action?.kind === 'restart_connection' && typeof window.relaiDesktop?.restartService === 'function';
  const action = canRestart
    ? `<button class="secondary compact-button" type="button" data-restart-connection data-diagnostic-action="${esc(finding.code)}">${esc(finding.action.label || 'Restart connection')}</button> <a class="buttonlike secondary compact-button" href="${esc(finding.action.href || '#connection')}">Review connection settings</a>`
    : finding.action?.href
      ? `<a class="buttonlike secondary compact-button" data-diagnostic-action="${esc(finding.code)}" href="${esc(finding.action.href)}">${esc(finding.action.label || 'Open')}</a>`
      : '';
  return `<article class="diagnostic-finding ${esc(finding.severity)}">
    <div class="diagnostic-severity">${esc(findingSeverityLabel(finding.severity))}</div>
    <div class="diagnostic-copy">
      <h3>${esc(finding.title)}</h3>
      <p><strong>Impact:</strong> ${esc(finding.impact)}</p>
      <p><strong>Recommended action:</strong> ${esc(finding.recommendation)}</p>
      ${findingContext(finding.context)}
      ${action}
      <details data-diagnostic-detail="${esc(finding.code)}"><summary>Technical details</summary><p><strong>Code:</strong> <code>${esc(finding.code)}</code></p><pre>${esc(JSON.stringify(finding.details || {}, null, 2))}</pre></details>
    </div>
  </article>`;
}

function findingSeverityLabel(severity) {
  if (severity === 'error') return 'Blocking';
  if (severity === 'warning') return 'Warning';
  return 'Recommendation';
}

function bindFindingActions(root, container) {
  for (const button of root.querySelectorAll('[data-restart-connection]')) {
    button.onclick = async () => {
      const result = await runButtonAction(button, {
        idleText: 'Restart connection', loadingText: 'Restarting connection…', successText: 'Restarted', errorText: 'Review settings'
      }, restartConnection);
      if (!result?.ok) {
        toast(result?.error || 'The connection could not be restarted.', { variant: 'error' });
        return;
      }
      toast('Connection restarted. Rel.AI is checking the Secure MCP Tunnel.', { variant: 'success' });
      await loadDiagnostics(container, { silent: true });
    };
  }
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
  const runtimeEmpty = runtime.available ? 'No app messages match the current filters.' : 'App logs are available in the desktop app.';
  return `<div class="diagnostic-log-grid" data-diagnostic-region="logs">
    ${logPanel('App log', view.runtime, runtimeEmpty, runtime.available, runtime.persistent ? 'Saved locally with sensitive values removed' : '')}
    ${logPanel('Failed activity', view.failed, 'No failed activity matches the current filters.', true, '')}
  </div>`;
}

function logPanel(title, entries, emptyText, available, subtitle) {
  const rows = available && entries.length
    ? entries.map(logRow).join('')
    : `<div class="diagnostic-log-empty">${esc(emptyText)}</div>`;
  return `<section class="card diagnostic-log-card">
    <div class="card-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><span class="section-action">${available ? `${entries.length} shown` : 'Unavailable'}</span></div>
    <div class="card-body diagnostic-log-list" role="log" aria-label="${esc(title)}">${rows}</div>
  </section>`;
}

function logRow(entry) {
  const message = entry.message || entry.error || 'Recorded diagnostic event';
  const source = entry.source || entry.tool || 'activity';
  const level = entry.level || (entry.error ? 'error' : 'info');
  const context = [
    entry.code || entry.errorCode ? `Code: ${entry.code || entry.errorCode}` : '',
    entry.workspace ? `Project: ${entry.workspace}` : '',
    entry.taskId ? `Task: ${entry.taskId}` : '',
    entry.eventId ? `Event: ${entry.eventId}` : '',
    entry.tool && entry.source ? `Tool: ${entry.tool}` : '',
    entry.operation ? `Operation: ${entry.operation}` : ''
  ].filter(Boolean).join(' · ');
  return `<div class="diagnostic-log-row ${esc(level)}">
    <time>${esc(timeAgo(entry.ts))}</time>
    <code>${esc(source)}</code>
    <span>${esc(message)}</span>
    ${context ? `<small>${esc(context)}</small>` : ''}
  </div>`;
}

function maintenanceHtml(maintenance) {
  return `<section class="card diagnostic-maintenance" data-diagnostic-region="maintenance">
    <div class="card-head"><div><h3>Saved troubleshooting data</h3><p>Clear troubleshooting data you no longer need. Project files and connection keys are never removed here.</p></div></div>
    <div class="card-body diagnostic-maintenance-list">
      ${maintenanceRow('Task and activity history', 'Removes saved Tasks and Activity entries. Running actions are protected.', 'history', maintenance.history, 'Clear history')}
      ${maintenanceRow('Saved app log', 'Clears the saved app log and the copy currently held in memory.', 'runtime_logs', maintenance.runtimeLogs, 'Clear app log')}
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
    <div><strong>All troubleshooting data</strong><span>${esc(state.reason || 'Clears task history, activity history, and the saved app log after typed confirmation.')}</span></div>
    <button class="danger" type="button" data-reset-all ${disabled ? 'disabled' : ''}>Clear all data</button>
  </div>`;
}

function filterSummary(view) {
  return `${view.findings.length} of ${view.totalFindings} findings · ${view.shownLogs} of ${view.totalLogs} log entries shown`;
}

function captureLogScrollState(container) {
  return [...container.querySelectorAll('.diagnostic-log-list')].map(element => ({
    top: element.scrollTop,
    follow: element.scrollHeight - element.scrollTop - element.clientHeight <= 24
  }));
}

function restoreLogScrollState(container, state) {
  const logs = [...container.querySelectorAll('.diagnostic-log-list')];
  for (let index = 0; index < logs.length; index += 1) {
    const element = logs[index];
    const previous = state[index];
    if (!previous || previous.follow) element.scrollTop = element.scrollHeight;
    else element.scrollTop = Math.min(previous.top, element.scrollHeight);
  }
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
  const title = report?.title || 'Troubleshooting info unavailable';
  const message = report?.error || 'Rel.AI could not load troubleshooting information.';
  const recovery = report?.recovery?.message || 'Refresh the dashboard or restart the Rel.AI connection.';
  const href = report?.recovery?.href || '#connection';
  return `<div class="diagnostic-clear diagnostic-unavailable">
    <strong>${esc(title)}</strong><span>${esc(message)}</span><small>${esc(recovery)}</small>
    <a class="buttonlike secondary" href="${esc(href)}">${esc(report?.recovery?.actionLabel || 'Open Connection')}</a>
  </div>`;
}
