import { closeModal, openModal } from './components/modal.js';
import { toast } from './components/toast.js';

function shouldShowUpdateModal(status, preferences, shownVersions) {
  const version = cleanVersion(status?.availableVersion);
  if (status?.state !== 'available' || !version) return false;
  if (preferences?.enabled !== true || preferences?.applicationUpdates !== true) return false;
  if (cleanVersion(preferences?.ignoredUpdateVersion) === version) return false;
  return !shownVersions?.has?.(version);
}

function initUpdateAvailableModal(options = {}) {
  const bridge = options.bridge || window.relaiDesktop;
  if (!bridge?.getUpdateStatus || !bridge?.getNotificationPreferences || !bridge?.setNotificationPreferences) {
    return () => {};
  }

  const shownVersions = new Set();
  let preferences = null;
  let latestStatus = null;
  let removeUpdateListener = null;

  function consider(status) {
    latestStatus = status || latestStatus;
    if (!shouldShowUpdateModal(latestStatus, preferences, shownVersions)) return;
    const version = cleanVersion(latestStatus.availableVersion);
    shownVersions.add(version);
    showUpdateModal(version, latestStatus);
  }

  function receivePreferences(next) {
    preferences = next?.preferences || next || preferences;
    consider(latestStatus);
  }

  if (typeof bridge.onUpdateStatus === 'function') {
    removeUpdateListener = bridge.onUpdateStatus(status => consider(status));
  }
  const onPreferenceChange = event => receivePreferences(event.detail);
  document.addEventListener('relai:notification-preferences-change', onPreferenceChange);

  void Promise.all([
    bridge.getNotificationPreferences(),
    bridge.getUpdateStatus()
  ]).then(([preferenceResult, status]) => {
    preferences = preferenceResult?.preferences || preferenceResult;
    latestStatus = status;
    consider(status);
  }).catch(() => {});

  function showUpdateModal(version, status) {
    const content = document.createElement('div');
    const description = document.createElement('p');
    description.textContent = `Rel.AI MCP ${version} is available. Downloading keeps the current app running and does not restart it.`;
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = status?.releaseDate
      ? `Release date: ${status.releaseDate}`
      : 'You can download now, postpone until the next launch, or ignore only this version.';

    const actions = document.createElement('div');
    actions.className = 'connection-actions';
    const download = actionButton(`Download v${version}`, 'primary');
    const later = actionButton('Later', 'secondary');
    const ignore = actionButton('Ignore this version', 'secondary');
    actions.append(download, later, ignore);
    content.append(description, detail, actions);

    download.addEventListener('click', async () => {
      download.disabled = true;
      download.setAttribute('aria-busy', 'true');
      try {
        const result = await bridge.downloadUpdate();
        if (result?.ok === false) throw new Error(result.error || 'The update could not be downloaded.');
        closeModal();
      } catch (error) {
        toast(messageOf(error), { variant: 'error' });
        download.disabled = false;
        download.removeAttribute('aria-busy');
      }
    });
    later.addEventListener('click', closeModal);
    ignore.addEventListener('click', async () => {
      ignore.disabled = true;
      ignore.setAttribute('aria-busy', 'true');
      try {
        const result = await bridge.setNotificationPreferences({ ignoredUpdateVersion: version });
        if (result?.ok === false) throw new Error(result.error || 'The update could not be ignored.');
        preferences = result?.preferences || { ...preferences, ignoredUpdateVersion: version };
        document.dispatchEvent(new CustomEvent('relai:notification-preferences-change', { detail: preferences }));
        closeModal();
      } catch (error) {
        toast(messageOf(error), { variant: 'error' });
        ignore.disabled = false;
        ignore.removeAttribute('aria-busy');
      }
    });

    openModal({
      title: `Update available: v${version}`,
      content
    });
  }

  return () => {
    removeUpdateListener?.();
    document.removeEventListener('relai:notification-preferences-change', onPreferenceChange);
  };
}

function actionButton(label, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').slice(0, 80);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Application update action failed.');
}

export { initUpdateAvailableModal, shouldShowUpdateModal };
