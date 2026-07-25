import { toast } from '../../components/toast.js';
import { panel, field, toggleControl } from './shared.js';

export function desktopStartupPanel(lifecycle) {
  const startup = panel('Startup and recovery');
  startup.el.classList.add('desktop-startup-panel');
  startup.body.setAttribute('aria-live', 'polite');
  if (!lifecycle) {
    startup.body.innerHTML = '<p class="muted">Startup controls are available only inside the installed desktop app.</p>'; return startup;
  }

  const launchAtLogin = lifecycle.launchAtLogin || {};
  const toggle = toggleControl(launchAtLogin.enabled === true, enabled => setLaunchAtLogin(startup.body, toggle, enabled), {
    enabled: 'Launch at sign-in on',
    disabled: 'Launch at sign-in off'
  });
  if (!launchAtLogin.supported) {
    const input = toggle.querySelector('input');
    if (input) input.disabled = true;
    toggle.setAttribute('aria-disabled', 'true');
  }
  startup.body.appendChild(field(
    'Launch Rel.AI at sign-in',
    toggle,
    launchAtLogin.supported
      ? 'Starts the installed app in the background so the tray and local service are ready after Windows sign-in.'
      : launchAtLogin.reason || 'This build cannot register itself for Windows sign-in.'
  ));

  const facts = document.createElement('div');
  facts.className = 'desktop-lifecycle-facts';
  facts.innerHTML = `
    <div><span>Current version</span><strong>v${escapeHtml(lifecycle.currentVersion || 'unknown')}</strong></div>
    <div><span>Launch count</span><strong>${Math.max(0, Number(lifecycle.launchCount || 0))}</strong></div>
    <div><span>Last clean exit</span><strong>${escapeHtml(formatTime(lifecycle.lastCleanExitAt))}</strong></div>`;
  startup.body.appendChild(facts);

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
      'Recovered after an interrupted exit',
      'The previous desktop process did not record a clean shutdown. Rel.AI preserved its configuration and started normally; review Diagnostics only if the interruption repeats.'
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
      syncToggle(toggle, actual);
      toast(result.error || 'Launch at sign-in could not be changed.', { variant: 'error' });
      return;
    }
    const actual = result?.status?.launchAtLogin?.enabled === true;
    syncToggle(toggle, actual);
    toast(actual ? 'Rel.AI will launch at Windows sign-in.' : 'Rel.AI will not launch at Windows sign-in.', { variant: 'success' });
  } catch (error) {
    syncToggle(toggle, !enabled);
    toast(messageOf(error), { variant: 'error' });
  } finally {
    container.removeAttribute('aria-busy');
  }
}

function syncToggle(toggle, enabled) {
  const input = toggle?.querySelector('input');
  const label = toggle?.querySelector('.toggle-label');
  if (input) {
    input.checked = enabled;
    input.setAttribute('aria-checked', String(enabled));
  }
  if (label) label.textContent = enabled ? 'Launch at sign-in on' : 'Launch at sign-in off';
}

function notice(tone, title, text) {
  const element = document.createElement('div');
  element.className = `connection-notice ${tone} desktop-lifecycle-notice`;
  element.innerHTML = `<strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>`;
  return element;
}

function formatTime(value) {
  if (!value) return 'Not recorded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded yet';
  return date.toLocaleString();
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Desktop startup setting failed.');
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
