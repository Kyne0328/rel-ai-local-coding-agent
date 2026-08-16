import { header, panel, field } from './shared.js';
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
  body.appendChild(field('Theme', themeSwitch(uiPreferences.theme), 'Theme applies to the dashboard. Setup and recovery windows follow your system appearance.'));
}

function themeSwitch(value) {
  const options = [
    ['system', 'Follow system appearance', '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M8 20h8M12 16v4"/>'],
    ['dark', 'Dark theme', '<path d="M20 15.2A8 8 0 0 1 8.8 4 8 8 0 1 0 20 15.2Z"/>'],
    ['light', 'Light theme', '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>']
  ];
  const group = document.createElement('div');
  group.className = 'theme-switch';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Theme');

  for (const [optionValue, label, icon] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-switch-option';
    button.dataset.themeOption = optionValue;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(optionValue === value));
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    group.appendChild(button);
  }
  group.onclick = event => {
    const button = event.target.closest?.('[data-theme-option]');
    if (!button || !group.contains(button)) return;
    setThemePreference(button.dataset.themeOption);
    group.querySelectorAll('[data-theme-option]').forEach(option => {
      option.setAttribute('aria-pressed', String(option === button));
    });
  };
  return group;
}
