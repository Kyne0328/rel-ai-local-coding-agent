import { header, panel, field, selectControl } from './shared.js';
import { getUiPreferences, setThemePreference } from '../../preferences.js';
import { desktopNotificationsPanel } from './desktop-notifications.js';

export function mountGeneral(container) {
  container.innerHTML = '<div class="settings-loading">Loading preferences…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const desktop = window.relaiDesktop;
  const notifications = typeof desktop?.getNotificationPreferences === 'function'
    ? await desktop.getNotificationPreferences().catch(() => null)
    : null;

  container.innerHTML = '';
  container.appendChild(header('Preferences', 'Change appearance and desktop notifications.'));

  const appearance = panel('Appearance');
  renderAppearanceSettings(appearance.body);
  container.appendChild(appearance.el);
  container.appendChild(desktopNotificationsPanel(notifications?.preferences).el);
}

function renderAppearanceSettings(body) {
  const uiPreferences = getUiPreferences();
  body.appendChild(field('Theme', selectControl([
    { value: 'system', label: 'Follow system appearance' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ], uiPreferences.theme, value => setThemePreference(value)), 'Theme applies to the dashboard. Setup and recovery windows follow your system appearance.'));
}
