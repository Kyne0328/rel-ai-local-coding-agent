import { postJson, requestDashboardRefresh } from '../../api.js';
import { runButtonAction } from '../../action-state.js';
import { confirmAction } from '../../components/confirm-dialog.js';
import { toast } from '../../components/toast.js';
import { formatBytes, panel } from './shared.js';
import { esc } from '../../utils.js';
import { iconActionHtml } from '../../components/icons.js';

export function desktopLocalDataPanel() {
  const section = panel('Local data & storage');
  section.el.classList.add('desktop-local-data-panel');
  section.body.innerHTML = '<div class="settings-loading">Calculating local data use…</div>';
  const bridge = window.relaiDesktop;
  if (!bridge?.getLocalDataUsage) {
    section.body.innerHTML = '<p class="settings-help">Local data controls are available only inside the installed Rel.AI desktop app.</p>';
    return section;
  }
  void load(section.body);
  return section;
}

async function load(body) {
  try {
    const usage = await window.relaiDesktop.getLocalDataUsage();
    if (usage?.ok === false) throw new Error(usage.error || 'Local data use could not be calculated.');
    render(body, usage || {});
  } catch (error) {
    body.innerHTML = `<p class="settings-help">${esc(messageOf(error))}</p>`;
  }
}

function render(body, usage) {
  const categories = usage.categories || {};
  const active = Math.max(0, Number(usage.activeTaskCount || 0));
  body.innerHTML = `
    <div class="local-data-summary">
      <div><span>Managed history and caches</span><strong>${formatBytes(usage.totalBytes, { zero: true })}${usage.approximate ? ' approx.' : ''}</strong></div>
      <small>Memory and connection settings are managed separately and are not removed by these controls.</small>
    </div>
    <div class="local-data-list">
      ${dataRow('Task & activity history', categories.history?.bytes)}
      ${dataRow('Saved app log', categories.logs?.bytes)}
      ${dataRow('Temporary command output', categories.temporary?.bytes)}
      ${dataRow('Repository indexes', categories.indexes?.bytes)}
    </div>
    <div class="local-data-actions">
      <button class="secondary" type="button" data-clear-temporary ${active > 0 ? 'disabled' : ''}>Clear temporary output</button>
      <button class="secondary danger" type="button" data-clear-history ${active > 0 ? 'disabled' : ''}>Clear task & activity history</button>
      <button class="secondary" type="button" data-open-data-folder>${iconActionHtml('folder', 'Data folder')}</button>
    </div>
    ${active > 0 ? `<p class="settings-help">Finish the ${active === 1 ? 'active task' : `${active} active tasks`} before clearing local task data.</p>` : ''}`;
  bindActions(body);
}

function dataRow(label, bytes) {
  return `<div class="local-data-row"><span>${esc(label)}</span><strong>${formatBytes(bytes, { zero: true })}</strong></div>`;
}

function bindActions(body) {
  const temporary = body.querySelector('[data-clear-temporary]');
  if (temporary) temporary.onclick = async () => {
    const confirmed = await confirmAction({
      title: 'Clear temporary output',
      message: 'Clear saved temporary command output?',
      detail: 'This removes retained command-output files. Project files, task history, and memory are not changed.',
      confirmLabel: 'Clear temporary output',
      danger: true
    });
    if (!confirmed) return;
    const result = await runButtonAction(temporary, {
      idleText: 'Clear temporary output', loadingText: 'Clearing…', successText: 'Cleared', errorText: 'Clear failed'
    }, () => window.relaiDesktop.clearTemporaryLocalData());
    if (!result?.ok) {
      toast(result?.error || 'Temporary command output could not be cleared.', { variant: 'error' });
      return;
    }
    toast('Temporary command output cleared.', { variant: 'success' });
    await load(body);
  };

  const history = body.querySelector('[data-clear-history]');
  if (history) history.onclick = async () => {
    const confirmed = await confirmAction({
      title: 'Clear task history',
      message: 'Clear saved task and activity history?',
      detail: 'This history cannot be restored. Project files, connection settings, and memory are not changed.',
      confirmLabel: 'Clear history',
      danger: true
    });
    if (!confirmed) return;
    const result = await runButtonAction(history, {
      idleText: 'Clear task & activity history', loadingText: 'Clearing…', successText: 'Cleared', errorText: 'Clear failed'
    }, () => postJson('/api/diagnostics/reset', { target: 'history', confirm: true }));
    if (!result?.ok) {
      toast(result?.error || 'Task and activity history could not be cleared.', { variant: 'error' });
      return;
    }
    toast(result.message || 'Task and activity history cleared.', { variant: 'success' });
    requestDashboardRefresh();
    await load(body);
  };

  const folder = body.querySelector('[data-open-data-folder]');
  if (folder) folder.onclick = async () => {
    const result = await runButtonAction(folder, {
      idleText: 'Data folder', loadingText: 'Opening…', successText: 'Folder opened', errorText: 'Open failed'
    }, () => window.relaiDesktop.openLocalDataFolder());
    if (!result?.ok) toast(result?.error || 'The Rel.AI data folder could not be opened.', { variant: 'error' });
  };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Local data action failed.');
}
