import { toast } from '../../components/toast.js';
import { panel, field, toggleControl } from './shared.js';

const DEFAULTS = {
  enabled: true,
  taskCompleted: true,
  errors: true,
  connectionStatus: true,
  applicationUpdates: true,
  ignoredUpdateVersion: ''
};
const CATEGORY_FIELDS = [
  {
    key: 'taskCompleted',
    label: 'Task completed',
    help: 'Show a desktop alert after Rel.AI explicitly completes a work session.'
  },
  {
    key: 'errors',
    label: 'Errors and failed operations',
    help: 'Show failed workspace actions, service and tunnel failures, and application update errors.'
  },
  {
    key: 'connectionStatus',
    label: 'Connection and service status',
    help: 'Show alerts when the ChatGPT connection becomes ready, stops, or needs authorization.'
  },
  {
    key: 'applicationUpdates',
    label: 'Application updates',
    help: 'Show update desktop alerts and the update-available modal.'
  }
];

export function desktopNotificationsPanel(initialState = null) {
  const section = panel('Desktop notifications');
  const bridge = window.relaiDesktop;
  if (!bridge?.setNotificationPreferences || initialState == null) {
    section.body.innerHTML = '<p class="muted">Desktop notification controls are available only inside the installed Rel.AI desktop app.</p>';
    return section;
  }

  let preferences = normalizePreferences(initialState);
  let pending = false;
  render();

  function render() {
    section.body.innerHTML = '';
    const master = toggleControl(preferences.enabled, value => {
      void update({ enabled: value }, value ? 'Desktop notifications enabled.' : 'Desktop notifications disabled.');
    }, { enabled: 'Notifications on', disabled: 'Notifications off' });
    setControlState(master, { disabled: pending, busy: pending });
    section.body.appendChild(field(
      'Desktop notifications',
      master,
      'Master control for all categories below, including the update-available modal. Category choices are preserved while this is off.'
    ));

    for (const item of CATEGORY_FIELDS) {
      const control = toggleControl(preferences[item.key], value => {
        void update({ [item.key]: value }, `${item.label} notifications ${value ? 'enabled' : 'disabled'}.`);
      }, { enabled: 'On', disabled: 'Off' });
      setControlState(control, { disabled: pending || !preferences.enabled, busy: pending });
      section.body.appendChild(field(item.label, control, item.help));
    }

    if (preferences.ignoredUpdateVersion) {
      section.body.appendChild(ignoredVersionField(preferences.ignoredUpdateVersion));
    }
  }

  function ignoredVersionField(version) {
    const control = document.createElement('div');
    control.className = 'connection-actions';
    const value = document.createElement('code');
    value.textContent = `v${version}`;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'secondary';
    reset.textContent = `Notify me about v${version} again`;
    reset.disabled = pending;
    reset.addEventListener('click', () => {
      void update({ ignoredUpdateVersion: '' }, `Update v${version} is no longer ignored.`);
    });
    control.append(value, reset);
    return field(
      'Ignored update version',
      control,
      'Only this exact version is ignored. Newer versions can still notify you.'
    );
  }

  async function update(patch, successMessage) {
    if (pending) return;
    const previous = preferences;
    pending = true;
    render();
    try {
      const result = await bridge.setNotificationPreferences(patch);
      if (result?.ok === false) throw new Error(result.error || 'Desktop notification preferences could not be changed.');
      preferences = normalizePreferences(result?.preferences || { ...preferences, ...patch });
      document.dispatchEvent(new CustomEvent('relai:notification-preferences-change', { detail: preferences }));
      toast(successMessage, { variant: 'success' });
    } catch (error) {
      preferences = previous;
      toast(messageOf(error), { variant: 'error' });
    } finally {
      pending = false;
      render();
    }
  }

  return section;
}

function setControlState(control, { disabled, busy }) {
  const input = control.querySelector('input');
  if (input) input.disabled = disabled;
  control.setAttribute('aria-disabled', String(disabled));
  control.setAttribute('aria-busy', String(busy));
}

function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    enabled: booleanValue(source.enabled, DEFAULTS.enabled),
    taskCompleted: booleanValue(source.taskCompleted, DEFAULTS.taskCompleted),
    errors: booleanValue(source.errors, DEFAULTS.errors),
    connectionStatus: booleanValue(source.connectionStatus, DEFAULTS.connectionStatus),
    applicationUpdates: booleanValue(source.applicationUpdates, DEFAULTS.applicationUpdates),
    ignoredUpdateVersion: String(source.ignoredUpdateVersion || '').trim().replace(/^v/i, '').slice(0, 80)
  };
}

function booleanValue(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Desktop notification preference failed.');
}
