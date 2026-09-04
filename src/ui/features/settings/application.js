import { toast } from '../../components/toast.js';
import { header, panel } from './shared.js';
import { applicationUpdatesPanel } from './desktop-updates.js';
import { desktopLocalDataPanel } from './desktop-local-data.js';
import { desktopStartupPanel } from './desktop-startup.js';

export function mountApplication(container) {
  container.innerHTML = '<div class="settings-loading">Loading app settings…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const desktop = window.relaiDesktop;
  const lifecycle = typeof desktop?.getLifecycleStatus === 'function'
    ? await desktop.getLifecycleStatus().catch(() => null)
    : null;

  container.innerHTML = '';
  container.appendChild(header('App', 'Startup, background behavior, updates, and local storage.'));
  container.appendChild(desktopStartupPanel(lifecycle).el);
  container.appendChild(applicationUpdatesPanel(lifecycle).el);
  container.appendChild(desktopLocalDataPanel().el);

  if (typeof desktop?.quitApp === 'function') {
    const controls = panel('Application controls');
    controls.body.appendChild(quitRow());
    container.appendChild(controls.el);
  }
}

function quitRow() {
  const row = document.createElement('div');
  row.className = 'setting-row';
  const copy = document.createElement('div');
  copy.className = 'setting-row-copy';
  copy.innerHTML = '<strong>Quit Rel.AI MCP</strong><span>Stop the local connection and close Rel.AI completely.</span>';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = 'Quit Rel.AI MCP';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Quitting…';
    try {
      await window.relaiDesktop.quitApp();
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Quit Rel.AI MCP';
      toast(error instanceof Error ? error.message : String(error || 'Rel.AI could not quit.'), { variant: 'error' });
    }
  });
  row.append(copy, button);
  return row;
}
