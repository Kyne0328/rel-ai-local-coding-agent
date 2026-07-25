import { toast } from '../../components/toast.js';
import { panel, field, toggleControl } from './shared.js';

export function desktopNotificationsPanel(initialState = null) {
  const preferences = panel('Desktop notifications');
  const bridge = window.relaiDesktop;
  if (!bridge?.setNotificationsEnabled || initialState == null) {
    preferences.body.innerHTML = '<p class="muted">Desktop notification controls are available only inside the installed Rel.AI desktop app.</p>';
    return preferences;
  }

  let enabled = initialState === true;
  let pending = false;
  const control = toggleControl(enabled, value => { void update(value); }, {
    enabled: 'Notifications on',
    disabled: 'Notifications off'
  });
  preferences.body.appendChild(field(
    'Task and connection notifications',
    control,
    'Show desktop alerts for connection changes, failed operations, and explicitly completed Rel.AI sessions.'
  ));

  async function update(next) {
    if (pending) {
      sync(enabled);
      return;
    }
    pending = true;
    setDisabled(true);
    try {
      const result = await bridge.setNotificationsEnabled(next === true);
      if (result?.ok === false) throw new Error(result.error || 'Desktop notification preference could not be changed.');
      enabled = result?.enabled !== false;
      sync(enabled);
      toast(enabled ? 'Desktop notifications enabled.' : 'Desktop notifications disabled.', { variant: 'success' });
    } catch (error) {
      sync(enabled);
      toast(messageOf(error), { variant: 'error' });
    } finally {
      pending = false;
      setDisabled(false);
    }
  }

  function sync(value) {
    const input = control.querySelector('input');
    const label = control.querySelector('span');
    if (input) {
      input.checked = value;
      input.setAttribute('aria-checked', String(value));
    }
    if (label) label.textContent = value ? 'Notifications on' : 'Notifications off';
  }

  function setDisabled(value) {
    const input = control.querySelector('input');
    if (input) input.disabled = value;
    control.setAttribute('aria-busy', String(value));
  }

  return preferences;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Desktop notification preference failed.');
}
