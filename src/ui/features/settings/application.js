import { header } from './shared.js';
import { applicationUpdatesPanel } from './desktop-updates.js';
import { desktopStartupPanel } from './desktop-startup.js';

export function mountApplication(container) {
  container.innerHTML = '<div class="settings-loading">Loading application settings…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const desktop = window.relaiDesktop;
  const lifecycle = typeof desktop?.getLifecycleStatus === 'function'
    ? await desktop.getLifecycleStatus().catch(() => null)
    : null;

  container.innerHTML = '';
  container.appendChild(header('Application', 'Startup and updates.'));
  container.appendChild(desktopStartupPanel(lifecycle).el);
  container.appendChild(applicationUpdatesPanel().el);
}
