import { toast } from '../../components/toast.js';
import { pillHtml } from '../../components/pill.js';
import { panel } from './shared.js';
import { esc as escapeHtml } from '../../utils.js';

const RELEASES_URL = 'https://github.com/Kyne0328/rel-ai-mcp/releases';
let removeUpdateListener = null;

export function applicationUpdatesPanel() {
  const updates = panel('Application updates');
  updates.el.classList.add('application-update-panel');
  updates.body.setAttribute('aria-live', 'polite');
  updates.body.innerHTML = '<div class="settings-loading">Loading update status…</div>';

  removeUpdateListener?.();
  removeUpdateListener = null;
  const bridge = window.relaiDesktop;
  if (!hasUpdateBridge(bridge)) {
    renderManual(updates.body, 'Automatic updates are managed by the installed Windows app.');
    return updates;
  }

  if (typeof bridge.onUpdateStatus === 'function') {
    removeUpdateListener = bridge.onUpdateStatus(status => renderStatus(updates.body, status));
  }
  void bridge.getUpdateStatus()
    .then(status => renderStatus(updates.body, status))
    .catch(error => renderFailure(updates.body, messageOf(error)));
  return updates;
}

function hasUpdateBridge(bridge) {
  return Boolean(
    bridge?.getUpdateStatus
    && bridge?.checkForUpdates
    && bridge?.downloadUpdate
    && bridge?.installUpdate
  );
}

function renderStatus(container, status = {}) {
  const state = String(status.state || 'idle');
  const currentVersion = status.currentVersion ? `v${escapeHtml(status.currentVersion)}` : 'Unknown version';
  const availableVersion = status.availableVersion ? `v${escapeHtml(status.availableVersion)}` : '';
  const view = updateView(state, status, currentVersion, availableVersion);
  container.innerHTML = `
    <div class="application-update-summary">
      <div>
        <span class="application-update-label">Installed version</span>
        <strong>${currentVersion}</strong>
      </div>
      ${pillHtml(view.label, view.tone)}
    </div>
    <p class="muted application-update-copy">${escapeHtml(view.description)}</p>
    ${supportPolicyHtml(status.supportPolicy)}
    ${progressHtml(state, status.progress)}
    ${status.errorCode ? `<code class="application-update-code">${escapeHtml(status.errorCode)}</code>` : ''}
    <div class="connection-actions application-update-actions">
      ${view.action ? `<button class="${view.action.className}" type="button" data-update-action="${view.action.id}">${escapeHtml(view.action.label)}</button>` : ''}
      ${view.secondary ? `<button class="secondary" type="button" data-update-action="${view.secondary.id}">${escapeHtml(view.secondary.label)}</button>` : ''}
      <a class="buttonlike secondary" href="${RELEASES_URL}" target="_blank" rel="noreferrer">GitHub Releases</a>
      ${state === 'error' ? '<a class="buttonlike secondary" href="#diagnostics">Open Diagnostics</a>' : ''}
    </div>`;
  wireActions(container);
}

function updateView(state, status, currentVersion, availableVersion) {
  if (state === 'unsupported') {
    return {
      label: 'Manual update', tone: 'warn',
      description: status.supportReason || 'This build must be updated manually from GitHub Releases.'
    };
  }
  if (state === 'checking') return { label: 'Checking', tone: 'working', description: 'Checking GitHub Releases for a newer installed-app version.' };
  if (state === 'up_to_date') {
    return {
      label: 'Up to date', tone: 'ok',
      description: `${currentVersion} is the latest available version. Rel.AI checks again once per day.`,
      action: { id: 'check', label: 'Check again', className: 'secondary' }
    };
  }
  if (state === 'available') {
    return {
      label: 'Update available', tone: 'warn',
      description: `${availableVersion || 'A newer version'} is available. Downloading does not restart Rel.AI.`,
      action: { id: 'download', label: `Download ${availableVersion || 'update'}`, className: 'primary' },
      secondary: { id: 'check', label: 'Check again' }
    };
  }
  if (state === 'downloading') {
    return {
      label: 'Downloading', tone: 'working',
      description: `Downloading ${availableVersion || 'the update'}. Rel.AI remains available while the installer is prepared.`
    };
  }
  if (state === 'downloaded') {
    return {
      label: 'Ready to install', tone: 'ok',
      description: `${availableVersion || 'The update'} is downloaded and its SHA-512 release metadata was verified. Restart only when no Rel.AI tool call is active.`,
      action: { id: 'install', label: 'Restart and install', className: 'primary' }
    };
  }
  if (state === 'installing') return { label: 'Installing', tone: 'working', description: 'Rel.AI is restarting to install the downloaded update.' };
  if (state === 'error') {
    return {
      label: 'Update failed', tone: 'bad',
      description: status.error || 'The update could not be completed. The current installed version remains available.',
      action: { id: 'check', label: 'Try again', className: 'primary' }
    };
  }
  return {
    label: 'Updates enabled', tone: 'ok',
    description: 'Rel.AI checks once per day. Downloads and restarts always require your approval.',
    action: { id: 'check', label: 'Check for updates', className: 'secondary' }
  };
}

function supportPolicyView(policy = {}) {
  const state = String(policy.state || 'unavailable');
  const minimumSupported = policy.minimumSupportedVersion ? `v${policy.minimumSupportedVersion}` : 'the supported release';
  const minimumRecommended = policy.minimumRecommendedVersion ? `v${policy.minimumRecommendedVersion}` : minimumSupported;
  if (state === 'current') return { label: 'Supported', tone: 'ok', description: `This installation meets the remote support baseline of ${minimumSupported}.` };
  if (state === 'recommended') return { label: 'Update recommended', tone: 'warn', description: `The remote support policy recommends ${minimumRecommended} or newer.` };
  if (state === 'deprecated') {
    const deadline = formatPolicyDate(policy.enforceAfter);
    return { label: 'Support ending', tone: 'warn', description: deadline
      ? `This version is below the remote support baseline of ${minimumSupported}. Update before ${deadline}.`
      : `This version is below the remote support baseline of ${minimumSupported}. Enforcement is not active yet.` };
  }
  if (state === 'required') return { label: 'Update required', tone: 'bad', description: `The remote support policy requires ${minimumSupported} or newer. MCP work is paused until the app is updated.` };
  if (state === 'emergency_blocked') return { label: 'Critical update', tone: 'bad', description: 'This exact application version is remotely blocked for an urgent update. MCP work is paused until the app is updated.' };
  return { label: 'Policy unavailable', tone: 'warn', description: 'The remote support policy is unavailable or expired. Rel.AI fails open and does not block MCP work.' };
}

function supportPolicyHtml(policy) {
  if (!policy || String(policy.state || '') === 'current') return '';
  const view = supportPolicyView(policy);
  return `<div class="application-update-policy"><div class="application-update-summary"><div><span class="application-update-label">Update requirement</span><strong>${escapeHtml(policy.minimumSupportedVersion ? `v${policy.minimumSupportedVersion} or newer` : 'Remote requirement')}</strong></div>${pillHtml(view.label, view.tone)}</div><p class="muted application-update-copy">${escapeHtml(view.description)}</p></div>`;
}

function formatPolicyDate(value) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function progressHtml(state, progress) {
  if (state !== 'downloading') return '';
  const percent = Math.max(0, Math.min(100, Number(progress?.percent || 0)));
  const transferred = formatBytes(progress?.transferred);
  const total = formatBytes(progress?.total);
  const speed = formatBytes(progress?.bytesPerSecond);
  return `
    <div class="application-update-progress">
      <progress max="100" value="${percent}" aria-label="Update download progress">${percent}%</progress>
      <span>${percent.toFixed(1)}%${total ? ` · ${transferred} of ${total}` : ''}${speed ? ` · ${speed}/s` : ''}</span>
    </div>`;
}

function wireActions(container) {
  container.querySelectorAll('[data-update-action]').forEach(button => {
    button.addEventListener('click', () => runAction(container, button, button.dataset.updateAction));
  });
}

async function runAction(container, button, action) {
  const method = {
    check: 'checkForUpdates',
    download: 'downloadUpdate',
    install: 'installUpdate'
  }[action];
  if (!method || typeof window.relaiDesktop?.[method] !== 'function') return;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    const result = await window.relaiDesktop[method]();
    if (result?.status) renderStatus(container, result.status);
    if (result?.ok === false) toast(result.error || 'The update action failed.', { variant: 'error' });
  } catch (error) {
    renderFailure(container, messageOf(error));
    toast(messageOf(error), { variant: 'error' });
  }
}

function renderManual(container, reason) {
  container.innerHTML = `
    <div class="application-update-summary"><div><span class="application-update-label">Update method</span><strong>Manual download</strong></div>${pillHtml('Desktop required', 'warn')}</div>
    <p class="muted application-update-copy">${escapeHtml(reason)}</p>
    <div class="connection-actions"><a class="buttonlike secondary" href="${RELEASES_URL}" target="_blank" rel="noreferrer">Open GitHub Releases</a></div>`;
}

function renderFailure(container, message) {
  renderStatus(container, { state: 'error', error: message, errorCode: 'update_failed' });
}

function formatBytes(value) {
  let bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024;
    unit += 1;
  }
  return `${bytes >= 10 || unit === 0 ? bytes.toFixed(0) : bytes.toFixed(1)} ${units[unit]}`;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Application update failed.');
}


export { supportPolicyView };
