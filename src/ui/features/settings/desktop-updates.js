import { fetchJson } from '../../api.js';
import { toast } from '../../components/toast.js';
import { pillHtml } from '../../components/pill.js';
import { panel } from './shared.js';
import { esc as escapeHtml } from '../../utils.js';
import { supportPolicyView } from './desktop-update-policy.js';

const RELEASES_URL = 'https://github.com/Kyne0328/rel-ai-local-coding-agent/releases';
let removeUpdateListener = null;

export function applicationUpdatesPanel() {
  const updates = panel('App updates');
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

  let installedReleaseNotes = null;
  const render = status => renderStatus(updates.body, status, installedReleaseNotes);
  if (typeof bridge.onUpdateStatus === 'function') {
    removeUpdateListener = bridge.onUpdateStatus(status => render(status));
  }
  void Promise.all([
    bridge.getUpdateStatus(),
    fetchJson('/api/release-notes').catch(() => null)
  ]).then(([status, notes]) => {
    installedReleaseNotes = notes?.ok === false ? null : notes;
    render(status);
  }).catch(error => renderFailure(updates.body, messageOf(error), installedReleaseNotes));
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

function renderStatus(container, status = {}, installedReleaseNotes = null) {
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
    ${releaseNotesHtml(status, installedReleaseNotes)}
    ${progressHtml(state, status.progress)}
    ${status.errorCode ? `<code class="application-update-code">Error code: ${escapeHtml(status.errorCode)}</code>` : ''}
    <div class="connection-actions application-update-actions">
      ${view.action ? `<button class="${view.action.className}" type="button" data-update-action="${view.action.id}">${escapeHtml(view.action.label)}</button>` : ''}
      ${view.secondary ? `<button class="secondary" type="button" data-update-action="${view.secondary.id}">${escapeHtml(view.secondary.label)}</button>` : ''}
      <a class="buttonlike secondary" href="${RELEASES_URL}" target="_blank" rel="noreferrer">GitHub Releases</a>
      ${state === 'error' ? '<a class="buttonlike secondary" href="#diagnostics">Troubleshoot</a>' : ''}
    </div>`;
  wireActions(container, installedReleaseNotes);
}

function updateView(state, status, currentVersion, availableVersion) {
  if (state === 'unsupported') {
    return {
      label: 'Manual update', tone: 'warn',
      description: status.supportReason || 'This build must be updated manually from GitHub Releases.'
    };
  }
  if (state === 'checking') return { label: 'Checking', tone: 'working', description: 'Checking for a newer version of Rel.AI.' };
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
      description: `Downloading ${availableVersion || 'the update'}. You can keep using Rel.AI while it downloads.`
    };
  }
  if (state === 'downloaded') {
    const opensDmg = status.installMode === 'open_dmg';
    return {
      label: 'Ready to install', tone: 'ok',
      description: opensDmg
        ? `${availableVersion || 'The update'} is verified and downloaded. Open the DMG, then replace Rel.AI MCP in Applications.`
        : `${availableVersion || 'The update'} is ready. Restart when Rel.AI is not working on a task.`,
      action: { id: 'install', label: opensDmg ? 'Open DMG' : 'Restart and install', className: 'primary' }
    };
  }
  if (state === 'installing') return { label: 'Installing', tone: 'working', description: 'Rel.AI is restarting to install the downloaded update.' };
  if (state === 'error') {
    return {
      label: 'Update failed', tone: 'bad',
      description: status.error || 'The update could not be completed. The installed version is still available.',
      action: { id: 'check', label: 'Try again', className: 'primary' }
    };
  }
  return {
    label: 'Updates enabled', tone: 'ok',
    description: status.installMode === 'open_dmg'
      ? 'Rel.AI checks once per day. Rel.AI asks before it downloads an update or opens the macOS installer.'
      : 'Rel.AI checks once per day. Rel.AI asks before it downloads an update or restarts.',
    action: { id: 'check', label: 'Check for updates', className: 'secondary' }
  };
}

function releaseNotesHtml(status = {}, installedReleaseNotes = null) {
  const available = Array.isArray(status.releaseNotes)
    ? status.releaseNotes.filter(entry => String(entry?.note || '').trim())
    : [];
  if (available.length) {
    const version = status.availableVersion ? `v${escapeHtml(status.availableVersion)}` : 'the update';
    const notes = available.map(entry => {
      const noteVersion = entry?.version && entry.version !== status.availableVersion
        ? `<strong>v${escapeHtml(entry.version)}</strong>`
        : '';
      return `<div class="application-update-release-note">${noteVersion}<p>${escapeHtml(normalizeReleaseNoteText(entry.note))}</p></div>`;
    }).join('');
    return `<details class="application-update-release-notes" open><summary>What's new in ${version}</summary><div class="application-update-release-notes-body">${notes}</div></details>`;
  }

  const releases = Array.isArray(installedReleaseNotes?.releases)
    ? installedReleaseNotes.releases.filter(entry => String(entry?.version || '').trim())
    : [];
  if (releases.length) {
    const body = releases.map(changelogReleaseHtml).join('');
    return `<details class="application-update-release-notes"><summary>What changed</summary><div class="application-update-release-notes-body">${body}</div></details>`;
  }

  const version = String(installedReleaseNotes?.version || '').trim();
  const headline = String(installedReleaseNotes?.headline || '').trim();
  const bullets = Array.isArray(installedReleaseNotes?.bullets)
    ? installedReleaseNotes.bullets.filter(Boolean).slice(0, 8)
    : [];
  if (!version || (!headline && !bullets.length)) return '';
  const body = [
    headline ? `<p class="application-update-release-headline">${escapeHtml(headline)}</p>` : '',
    bullets.length ? `<ul>${bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''
  ].join('');
  return `<details class="application-update-release-notes"><summary>What changed · v${escapeHtml(version)}</summary><div class="application-update-release-notes-body">${body}</div></details>`;
}

function normalizeReleaseNoteText(value) {
  let text = String(value || '');
  if (!text.trim()) return '';
  text = text
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '\n• ')
    .replace(/<\s*\/\s*li\s*>/gi, '\n')
    .replace(/<\s*\/?\s*(?:h[1-6]|p|div|ul|ol|section|article)(?:\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, decodeReleaseNoteEntity)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function decodeReleaseNoteEntity(match, entity) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const key = String(entity || '').toLowerCase();
  if (Object.hasOwn(named, key)) return named[key];
  const codePoint = key.startsWith('#x')
    ? Number.parseInt(key.slice(2), 16)
    : Number.parseInt(key.slice(1), 10);
  if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
  try { return String.fromCodePoint(codePoint); } catch { return match; }
}

function changelogReleaseHtml(release = {}) {
  const version = String(release.version || '').trim();
  if (!version) return '';
  const date = String(release.date || '').trim();
  const sections = Array.isArray(release.sections) ? release.sections : [];
  let content = sections.map(section => {
    const title = String(section?.title || '').trim();
    const bullets = Array.isArray(section?.bullets) ? section.bullets.filter(Boolean) : [];
    if (!title && !bullets.length) return '';
    return `<div class="application-update-release-note">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${bullets.length ? `<ul>${bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</div>`;
  }).join('');
  if (!content) {
    const headline = String(release.headline || '').trim();
    const bullets = Array.isArray(release.bullets) ? release.bullets.filter(Boolean) : [];
    content = `${headline ? `<p class="application-update-release-headline">${escapeHtml(headline)}</p>` : ''}${bullets.length ? `<ul>${bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}`;
  }
  if (!content) return '';
  return `<section class="application-update-release-note"><strong>v${escapeHtml(version)}${date ? ` · ${escapeHtml(date)}` : ''}</strong>${content}</section>`;
}

function supportPolicyHtml(policy) {
  if (!policy || String(policy.state || '') === 'current') return '';
  const view = supportPolicyView(policy);
  return `<div class="application-update-policy"><div class="application-update-summary"><div><span class="application-update-label">Version support</span><strong>${escapeHtml(policy.minimumSupportedVersion ? `v${policy.minimumSupportedVersion} or newer` : 'Check unavailable')}</strong></div>${pillHtml(view.label, view.tone)}</div><p class="muted application-update-copy">${escapeHtml(view.description)}</p></div>`;
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

function wireActions(container, installedReleaseNotes = null) {
  container.querySelectorAll('[data-update-action]').forEach(button => {
    button.addEventListener('click', () => runAction(container, button, button.dataset.updateAction, installedReleaseNotes));
  });
}

async function runAction(container, button, action, installedReleaseNotes = null) {
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
    if (result?.status) renderStatus(container, result.status, installedReleaseNotes);
    if (result?.ok === false) toast(result.error || 'The update action failed.', { variant: 'error' });
  } catch (error) {
    renderFailure(container, messageOf(error), installedReleaseNotes);
    toast(messageOf(error), { variant: 'error' });
  }
}

function renderManual(container, reason) {
  container.innerHTML = `
    <div class="application-update-summary"><div><span class="application-update-label">Update method</span><strong>Manual download</strong></div>${pillHtml('Desktop required', 'warn')}</div>
    <p class="muted application-update-copy">${escapeHtml(reason)}</p>
    <div class="connection-actions"><a class="buttonlike secondary" href="${RELEASES_URL}" target="_blank" rel="noreferrer">Open GitHub Releases</a></div>`;
}

function renderFailure(container, message, installedReleaseNotes = null) {
  renderStatus(container, { state: 'error', error: message, errorCode: 'update_failed' }, installedReleaseNotes);
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


export { releaseNotesHtml, supportPolicyView };
