import { header, panel, field, selectControl } from './shared.js';
import { getUiPreferences, setDensityPreference, setThemePreference } from '../../preferences.js';
import { applicationUpdatesPanel } from './desktop-updates.js';
import { desktopStartupPanel } from './desktop-startup.js';
import { desktopNotificationsPanel } from './desktop-notifications.js';

export function mountGeneral(container) {
  container.innerHTML = '<div class="settings-loading">Loading general settings…</div>';
  return loadAndRender(container);
}

async function loadAndRender(container) {
  const desktop = window.relaiDesktop;
  const [lifecycle, notifications] = await Promise.all([
    typeof desktop?.getLifecycleStatus === 'function'
      ? desktop.getLifecycleStatus().catch(() => null)
      : Promise.resolve(null),
    typeof desktop?.getNotificationsEnabled === 'function'
      ? desktop.getNotificationsEnabled().catch(() => null)
      : Promise.resolve(null)
  ]);

  container.innerHTML = '';
  container.appendChild(header(
    'General',
    'Control appearance, desktop behavior, notifications, and application updates.'
  ));

  const appearance = panel('Appearance');
  renderAppearanceSettings(appearance.body);
  container.appendChild(appearance.el);
  container.appendChild(desktopNotificationsPanel(notifications?.enabled));
  container.appendChild(desktopStartupPanel(lifecycle).el);
  container.appendChild(applicationUpdatesPanel().el);
}

function renderAppearanceSettings(body) {
  const uiPreferences = getUiPreferences();
  body.appendChild(appearancePreview());
  body.appendChild(field('Theme', selectControl([
    { value: 'system', label: 'Follow system appearance' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' }
  ], uiPreferences.theme, value => setThemePreference(value)), 'Stored locally in this dashboard. System mode follows the operating system appearance.'));
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
