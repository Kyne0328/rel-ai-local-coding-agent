import { requestDashboardRefresh } from '../../api.js';
import { panel, saveSettings, toggleControl } from '../settings/shared.js';

export function buildValidationPreferences(data = {}) {
  const productUx = data.config?.productUx || {};
  let current = productUx.showAutomaticValidation !== false;
  const preference = panel('Workspace validation display');
  preference.el.classList.add('workspace-validation-preferences');

  const row = document.createElement('div');
  row.className = 'workspace-validation-preference-row';
  const copy = document.createElement('div');
  copy.innerHTML = `
    <strong>Show automatic validation plans</strong>
    <p>Show detected validation commands and readiness near each workspace. This does not disable validation tools or configured commands.</p>`;
  const status = document.createElement('span');
  status.className = 'settings-help';
  status.setAttribute('aria-live', 'polite');

  const control = toggleControl(current, async value => {
    const input = control.querySelector('input');
    if (input) input.disabled = true;
    status.textContent = 'Saving…';
    const response = await saveSettings({ productUx: { showAutomaticValidation: value } });
    if (response?.ok) {
      current = value;
      status.textContent = 'Saved.';
      requestDashboardRefresh({ structural: true });
    } else {
      const checkbox = control.querySelector('input');
      if (checkbox) checkbox.checked = current;
      const label = control.querySelector('.toggle-label');
      if (label) label.textContent = current ? 'Show validation plans' : 'Hide validation plans';
      status.textContent = 'Could not save this preference.';
    }
    if (input) input.disabled = false;
  }, { enabled: 'Show validation plans', disabled: 'Hide validation plans' });

  row.append(copy, control);
  preference.body.append(row, status);
  return preference.el;
}
