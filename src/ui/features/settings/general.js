import { header, panel, field } from './shared.js';
import { getUiPreferences, setThemePreference } from '../../preferences.js';
import { desktopNotificationsPanel } from './desktop-notifications.js';

export function mountPreferences(container) {
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
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Theme');

  for (const [optionValue, label, icon] of options) {
    const selected = optionValue === value;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-switch-option';
    button.dataset.themeOption = optionValue;
    button.title = label;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-checked', String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    group.appendChild(button);
  }

  const select = button => {
    if (!button || !group.contains(button)) return;
    setThemePreference(button.dataset.themeOption);
    group.querySelectorAll('[data-theme-option]').forEach(option => {
      const selected = option === button;
      option.setAttribute('aria-checked', String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
  };
  group.addEventListener('click', event => {
    select(event.target.closest?.('[data-theme-option]'));
  });
  group.addEventListener('keydown', event => {
    const buttons = [...group.querySelectorAll('[data-theme-option]')];
    const current = event.target.closest?.('[data-theme-option]');
    const index = buttons.indexOf(current);
    if (index < 0) return;
    let nextIndex = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const next = buttons[nextIndex];
    next.focus();
    select(next);
  });
  return group;
}
