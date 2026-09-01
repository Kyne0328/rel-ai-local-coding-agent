import { toast } from '../../components/toast.js';
import { panel, toggleControl, toggleRow } from './shared.js';
import { esc as escapeHtml } from '../../utils.js';

const LAUNCH_TOGGLE_LABELS = Object.freeze({ enabled: 'Launch at sign-in on', disabled: 'Launch at sign-in off' });
const KEEP_AWAKE_TOGGLE_LABELS = Object.freeze({ enabled: 'Keep computer awake on', disabled: 'Keep computer awake off' });

export function desktopStartupPanel(lifecycle) {
  const startup = panel('Startup');
  startup.el.classList.add('desktop-startup-panel');
  startup.body.setAttribute('aria-live', 'polite');
  if (!lifecycle) {
    startup.body.innerHTML = '<p class="muted">Application controls are available only inside the installed desktop app.</p>'; return startup;
  }

  const launchAtLogin = lifecycle.launchAtLogin || {};
  const toggle = toggleControl(launchAtLogin.enabled === true, enabled => setLaunchAtLogin(startup.body, toggle, enabled), LAUNCH_TOGGLE_LABELS);
  if (!launchAtLogin.supported) {
    const input = toggle.querySelector('input');
    if (input) input.disabled = true;
    toggle.setAttribute('aria-disabled', 'true');
  }
  startup.body.appendChild(toggleRow(
    'Launch Rel.AI at sign-in',
    toggle,
    launchAtLogin.supported
      ? 'Starts Rel.AI in the background after you sign in to Windows so it is ready when you need it.'
      : launchAtLogin.reason || 'This build cannot register itself for Windows sign-in.'
  ));

  const keepAwakeToggle = toggleControl(lifecycle.keepAwake === true, enabled => setKeepAwake(startup.body, keepAwakeToggle, enabled), KEEP_AWAKE_TOGGLE_LABELS);
  startup.body.appendChild(toggleRow(
    'Keep computer awake',
    keepAwakeToggle,
    'Prevents this computer from automatically sleeping or hibernating while Rel.AI is running. The display can still turn off normally.'
  ));

  if (lifecycle.updated) {
    startup.body.appendChild(notice(
      'ok',
      'Update completed',
      `Rel.AI started successfully after updating from v${lifecycle.previousVersion || 'an earlier version'} to v${lifecycle.currentVersion || 'the current version'}.`
    ));
  }
  if (lifecycle.recoveredAfterUncleanShutdown) {
    startup.body.appendChild(notice(
      'warn',
      'Rel.AI recovered after closing unexpectedly',
      'Rel.AI did not close normally last time, but your settings were kept and the app started normally. Open Troubleshooting only if this keeps happening.'
    ));
  }
  return startup;
}

async function setLaunchAtLogin(container, toggle, enabled) {
  if (typeof window.relaiDesktop?.setLaunchAtLogin !== 'function') return;
  container.setAttribute('aria-busy', 'true');
  try {
    const result = await window.relaiDesktop.setLaunchAtLogin(enabled);
    if (result?.ok === false) {
      const actual = typeof result.status?.launchAtLogin?.enabled === 'boolean'
        ? result.status.launchAtLogin.enabled
        : !enabled;
      syncToggle(toggle, actual, LAUNCH_TOGGLE_LABELS);
      toast(result.error || 'Launch at sign-in could not be changed.', { variant: 'error' });
      return;
    }
    const actual = result?.status?.launchAtLogin?.enabled === true;
    syncToggle(toggle, actual, LAUNCH_TOGGLE_LABELS);
  } catch (error) {
    syncToggle(toggle, !enabled, LAUNCH_TOGGLE_LABELS);
    toast(messageOf(error), { variant: 'error' });
  } finally {
    container.removeAttribute('aria-busy');
  }
}

async function setKeepAwake(container, toggle, enabled) {
  if (typeof window.relaiDesktop?.setKeepAwake !== 'function') return;
  container.setAttribute('aria-busy', 'true');
  try {
    const result = await window.relaiDesktop.setKeepAwake(enabled);
    const actual = result?.status?.keepAwake === true;
    if (result?.ok === false) {
      syncToggle(toggle, actual, KEEP_AWAKE_TOGGLE_LABELS);
      toast(result.error || 'Keep-awake setting could not be changed.', { variant: 'error' });
      return;
    }
    syncToggle(toggle, actual, KEEP_AWAKE_TOGGLE_LABELS);
  } catch (error) {
    syncToggle(toggle, !enabled, KEEP_AWAKE_TOGGLE_LABELS);
    toast(messageOf(error), { variant: 'error' });
  } finally {
    container.removeAttribute('aria-busy');
  }
}

function syncToggle(toggle, enabled, labels) {
  const input = toggle?.querySelector('input');
  const label = toggle?.querySelector('.toggle-label');
  if (input) {
    input.checked = enabled;
    input.setAttribute('aria-checked', String(enabled));
  }
  if (label) label.textContent = enabled ? labels.enabled : labels.disabled;
}

function notice(tone, title, text) {
  const element = document.createElement('div');
  element.className = `connection-notice ${tone} desktop-lifecycle-notice`;
  element.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>`;
  return element;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Desktop application setting failed.');
}

