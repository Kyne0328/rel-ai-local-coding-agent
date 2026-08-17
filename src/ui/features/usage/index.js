import { getRouteParams, getWorkspaceFilter, replaceRouteParams } from '../../router.js';
import { esc as escapeHtml } from '../../utils.js';
import { ANALYTICS_RANGES, analyticsBounds, normalizeUsageSnapshot, workspaceOptions } from './range-model.js';
import { loadAnalyticsData } from './data.js';
import { renderUsage } from './render.js';

let mountedGeneration = 0;
let liveControls = null;
let liveRefreshTimer = 0;

export async function mountUsage(container) {
  const generation = ++mountedGeneration;
  if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = 0;
  liveControls = null;
  const params = getRouteParams();
  const requestedRange = params.get('range');
  const range = ANALYTICS_RANGES.some(([key]) => key === requestedRange) ? requestedRange : '24h';
  const defaults = customDateDefaults();

  container.innerHTML = `
    <section class="usage-page" data-usage-page>
      <div class="feature-toolbar usage-toolbar">
        <div>
          <h2>Analytics</h2>
          <p>Analytics are stored on this computer. Prompts, file paths, command output, and action results are not stored.</p>
        </div>
        <div class="usage-toolbar-controls">
          <label class="usage-workspace-control">
            <span>Project</span>
            <select data-usage-workspace><option value="">All projects</option></select>
          </label>
          <div class="usage-range-control">
            <span>Range</span>
            <select data-usage-range hidden>${ANALYTICS_RANGES.map(([key, label]) => `<option value="${key}"${key === range ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
            <div class="usage-range-switch" role="group" aria-label="Analytics range">
              ${ANALYTICS_RANGES.map(([key, label]) => `<button type="button" data-usage-range-option="${key}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${key === range ? 'true' : 'false'}">${escapeHtml(rangeButtonLabel(key, label))}</button>`).join('')}
            </div>
          </div>
          <div class="usage-custom-range" data-usage-custom-range ${range === 'custom' ? '' : 'hidden'}>
            <label><span>From</span><input type="date" data-usage-start value="${escapeHtml(params.get('start') || defaults.start)}" /></label>
            <label><span>To</span><input type="date" data-usage-end value="${escapeHtml(params.get('end') || defaults.end)}" /></label>
          </div>
          <button type="button" class="secondary" data-usage-refresh>Refresh</button>
        </div>
      </div>
      <div class="sr-only" data-usage-status role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="usage-content" data-usage-content></div>
    </section>`;

  const root = container.querySelector('[data-usage-page]');
  const controls = {
    root,
    generation,
    workspaceSelect: root.querySelector('[data-usage-workspace]'),
    rangeSelect: root.querySelector('[data-usage-range]'),
    rangeButtons: [...root.querySelectorAll('[data-usage-range-option]')],
    customRange: root.querySelector('[data-usage-custom-range]'),
    startInput: root.querySelector('[data-usage-start]'),
    endInput: root.querySelector('[data-usage-end]'),
    refreshButton: root.querySelector('[data-usage-refresh]'),
    status: root.querySelector('[data-usage-status]'),
    content: root.querySelector('[data-usage-content]')
  };
  liveControls = controls;
  const refresh = () => loadUsage(controls);

  controls.workspaceSelect.addEventListener('change', () => {
    replaceRouteParams({ workspace: controls.workspaceSelect.value || null, device: null });
    refresh();
  });
  for (const button of controls.rangeButtons) {
    button.addEventListener('click', () => {
      const value = button.dataset.usageRangeOption || '24h';
      if (controls.rangeSelect.value === value) return;
      controls.rangeSelect.value = value;
      controls.rangeSelect.dispatchEvent(new Event('change'));
    });
  }
  controls.rangeSelect.addEventListener('change', () => {
    const custom = controls.rangeSelect.value === 'custom';
    controls.customRange.hidden = !custom;
    for (const button of controls.rangeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.usageRangeOption === controls.rangeSelect.value));
    }
    replaceRouteParams({
      range: controls.rangeSelect.value === '24h' ? null : controls.rangeSelect.value,
      start: custom ? controls.startInput.value : null,
      end: custom ? controls.endInput.value : null
    });
    refresh();
  });
  for (const input of [controls.startInput, controls.endInput]) {
    input.addEventListener('change', () => {
      if (controls.rangeSelect.value !== 'custom') return;
      replaceRouteParams({ start: controls.startInput.value, end: controls.endInput.value });
      refresh();
    });
  }
  controls.refreshButton.addEventListener('click', refresh);
  await refresh();
}

export function updateUsageLiveState(container) {
  const controls = liveControls;
  if (!controls || !container.contains(controls.root) || !active(controls.root, controls.generation)) return false;
  if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = window.setTimeout(() => {
    liveRefreshTimer = 0;
    void loadUsage(controls, { silent: true });
  }, 180);
  return true;
}

async function loadUsage(controls, options = {}) {
  const { root, generation, refreshButton, status, content } = controls;
  const silent = options.silent === true;
  if (controls.loading) {
    if (silent) controls.pendingLiveRefresh = true;
    return;
  }
  controls.loading = true;
  let bounds;
  try {
    bounds = analyticsBounds(controls.rangeSelect.value, {
      customStart: controls.startInput.value,
      customEnd: controls.endInput.value
    });
  } catch (error) {
    controls.loading = false;
    status.textContent = 'Analytics could not be loaded.';
    renderUnavailable(content, messageOf(error), () => controls.rangeSelect.focus());
    return;
  }

  if (!silent) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Loading…';
    status.textContent = 'Loading analytics…';
    content.setAttribute('aria-busy', 'true');
    content.innerHTML = '<div class="usage-loading">Loading analytics…</div>';
  }
  try {
    const workspace = getWorkspaceFilter();
    const { models, current, previous } = await loadAnalyticsData({
      desktop: window.relaiDesktop,
      bounds,
      workspace
    });
    if (!active(root, generation)) return;
    syncWorkspaceControl(controls.workspaceSelect, models, workspace);
    renderUsage(content, { bounds, current, previous });
    status.textContent = `Analytics updated for ${bounds.label}.`;
  } catch (error) {
    if (active(root, generation)) {
      if (!silent) renderUnavailable(content, messageOf(error), () => loadUsage(controls));
      status.textContent = silent ? 'Analytics could not be refreshed.' : 'Analytics could not be loaded.';
    }
  } finally {
    controls.loading = false;
    if (active(root, generation) && !silent) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh';
      content.removeAttribute('aria-busy');
    }
    if (controls.pendingLiveRefresh && active(root, generation)) {
      controls.pendingLiveRefresh = false;
      queueMicrotask(() => void loadUsage(controls, { silent: true }));
    }
  }
}

export function buildUsageModel(snapshot, requestedMonth = '') {
  return normalizeUsageSnapshot(snapshot, requestedMonth);
}

export function currentUsageMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function syncWorkspaceControl(select, models, workspace) {
  const options = workspaceOptions(models);
  select.innerHTML = [
    '<option value="">All projects</option>',
    ...options.map(option => `<option value="${escapeHtml(option.workspace)}">${escapeHtml(option.workspace)}</option>`)
  ].join('');
  select.value = [...select.options].some(option => option.value === workspace) ? workspace : '';
}

function renderUnavailable(content, message, retry) {
  content.innerHTML = `<section class="usage-unavailable empty-state"><strong>Analytics unavailable</strong><p>${escapeHtml(message || 'Analytics could not be loaded.')}</p><button type="button" class="secondary" data-usage-retry>Retry</button></section>`;
  content.querySelector('[data-usage-retry]')?.addEventListener('click', retry);
}

function rangeButtonLabel(key, label) {
  return ({ '1h': '1h', '24h': '24h', '7d': '7d', '30d': '30d', month: 'Month', custom: 'Custom' })[key] || label;
}

function customDateDefaults(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function active(root, generation) {
  return generation === mountedGeneration && root.isConnected;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Analytics unavailable.');
}
