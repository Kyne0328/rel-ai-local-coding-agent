import { header, panel, field, selectControl } from './shared.js';
import { getUiPreferences, setDensityPreference, setThemePreference } from '../../preferences.js';
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
  container.appendChild(header(
    'Preferences',
    'Control appearance, interface density, and desktop notifications.'
  ));

  const appearance = panel('Appearance');
  renderAppearanceSettings(appearance.body);
  container.appendChild(appearance.el);
  container.appendChild(desktopNotificationsPanel(notifications?.preferences).el);
}

function renderAppearanceSettings(body) {
  const uiPreferences = getUiPreferences();
  body.appendChild(appearancePreview());
  body.appendChild(field('Theme', selectControl([
    { value: 'system', label: 'Follow system appearance' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ], uiPreferences.theme, value => setThemePreference(value)), 'Applies only to this dashboard. System mode follows the operating system; setup and recovery windows always follow the operating system appearance.'));
  body.appendChild(field('Interface density', selectControl([
    { value: 'comfortable', label: 'Comfortable' },
    { value: 'compact', label: 'Compact' }
  ], uiPreferences.density, value => setDensityPreference(value)), 'Compact mode reduces spacing without hiding information.'));
}

function appearancePreview() {
  const preview = document.createElement('div');
  preview.className = 'appearance-preview';
  preview.innerHTML = `
    <div class="appearance-swatch"><strong>Primary surface</strong><span>Cards, navigation, and dialogs</span></div>
    <div class="appearance-swatch"><strong>Information density</strong><span>Spacing changes without reducing content</span></div>`;
  return preview;
}
