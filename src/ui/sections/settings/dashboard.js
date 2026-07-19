import { postJson, requestDashboardRefresh } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { toast } from '../../components/toast.js';
import {
  loadSettingsConfig,
  saveSettings,
  header,
  panel,
  field,
  formGrid,
  toggleControl,
  numberControl,
  saveRow
} from './shared.js';

let _original = null;
let _draft = null;

export function mountDashboard(container) {
  container.innerHTML = '<div class="settings-loading">Loading dashboard settings…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const config = await loadSettingsConfig(container);
  if (!config) return;
  _original = structuredClone(config.productUx || {});
  _draft = structuredClone(config.productUx || {});
  render(container);
}

function render(container) {
  container.innerHTML = '';
  container.appendChild(header('Dashboard', 'Tune live updates, simplify workspace cards, and manage stored session and tool-call history.'));

  const refresh = panel('Live updates');
  const refreshGrid = formGrid();
  refreshGrid.append(
    field('Fallback refresh interval (seconds)', numberControl(_draft.dashboardRefreshSeconds || 5, value => {
      _draft.dashboardRefreshSeconds = bounded(value, 1, 3600, 5);
      checkDirty();
    }, { min: 1, max: 3600 }), 'Used when the live event stream is disconnected. Manual refresh always remains available.'),
    field('Live event scan interval (seconds)', numberControl(_draft.liveLogPollSeconds || 3, value => {
      _draft.liveLogPollSeconds = bounded(value, 1, 300, 3);
      checkDirty();
    }, { min: 1, max: 300 }), 'How often the local service checks for changed task, audit, connection, or configuration state.')
  );
  refresh.body.appendChild(refreshGrid);
  container.appendChild(refresh.el);

  const workspaceDisplay = panel('Workspace cards');
  workspaceDisplay.body.appendChild(field(
    'Automatic validation plan',
    toggleControl(_draft.showAutomaticValidation !== false, value => {
      _draft.showAutomaticValidation = value;
      checkDirty();
    }, { enabled: 'Show validation plans', disabled: 'Hide validation plans' }),
    'Controls only the validation panel and summary metric in Workspaces. It does not disable validation tools or configured commands.'
  ));
  container.appendChild(workspaceDisplay.el);
  container.appendChild(historyPanel());
  container.appendChild(buildSaveRow(container));
}

function historyPanel() {
  const history = panel('Session and activity history');
  const copy = document.createElement('div');
  copy.className = 'settings-history-copy';
  copy.innerHTML = '<strong>Clear stored dashboard history</strong><span>Removes persisted Sessions and Activity entries, including the rotated audit file. Currently running tool calls are protected and cannot be cleared.</span>';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary danger';
  button.textContent = 'Clear session and activity history';
  button.onclick = () => clearHistory(button);
  history.body.append(copy, button);
  history.el.classList.add('settings-history-panel');
  return history.el;
}

async function clearHistory(button) {
  if (!window.confirm('Clear all stored session and activity history? This cannot be undone.')) return;
  const result = await runButtonAction(button, {
    idleText: 'Clear session and activity history',
    loadingText: 'Clearing history…',
    successText: 'History cleared',
    errorText: 'Clear failed'
  }, () => postJson('/api/history/reset', { confirm: true }));
  if (result?.ok) {
    toast(result.message || 'Session and activity history cleared.', { variant: 'success' });
    requestDashboardRefresh();
  } else {
    toast(result?.error || 'Could not clear history.', { variant: 'error' });
  }
}

function buildSaveRow(container) {
  const row = saveRow(() => save(container), () => loadAndRender(container));
  row.id = '__settings-save-row';
  row.hidden = true;
  return row;
}

function checkDirty() {
  const row = document.getElementById('__settings-save-row');
  if (row) row.hidden = JSON.stringify(_draft) === JSON.stringify(_original);
}

async function save(container) {
  const response = await saveSettings({ productUx: _draft });
  if (!response?.ok) return;
  requestDashboardRefresh();
  await loadAndRender(container);
}

function bounded(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.floor(number), min), max);
}
