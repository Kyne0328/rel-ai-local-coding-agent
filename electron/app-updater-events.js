'use strict';

const { cleanText, isoNow, progressPayload } = require('./app-updater-state');
const { compareVersions, isStableVersion } = require('./update-version');

function bindUpdaterEvents({ autoUpdater, handlers, status, emit, handleError, store, now, log }) {
  const bind = (eventName, handler) => {
    autoUpdater.on(eventName, handler);
    handlers.push([eventName, handler]);
  };

  bind('checking-for-update', () => emit({ state: 'checking', error: '', errorCode: '', integrityVerified: false }));
  bind('update-available', info => {
    const availableVersion = String(info?.version || '').trim();
    store.writeLastCheck(now());
    if (!isStableVersion(availableVersion)) return handleError(new Error('Update metadata contains an invalid stable version.'));
    if (!isStableVersion(status().currentVersion)) {
      return handleError(new Error('The installed application version is invalid, so the update cannot be trusted.'));
    }
    if (compareVersions(availableVersion, status().currentVersion) <= 0) {
      return handleError(new Error(`Update metadata version ${availableVersion} is not newer than installed version ${status().currentVersion}.`));
    }
    log(`Application update ${availableVersion} was found.`);
    emit({
      state: 'available', availableVersion,
      releaseDate: cleanText(info?.releaseDate, 80),
      checkedAt: isoNow(now), downloadedAt: '', progress: null,
      integrityVerified: false, error: '', errorCode: ''
    });
  });
  bind('update-not-available', () => {
    store.writeLastCheck(now());
    log('Rel.AI MCP is up to date.');
    emit({
      state: 'up_to_date', availableVersion: '', releaseDate: '',
      checkedAt: isoNow(now), downloadedAt: '', progress: null,
      integrityVerified: false, error: '', errorCode: ''
    });
  });
  bind('download-progress', progress => emit({ state: 'downloading', progress: progressPayload(progress) }));
  bind('update-downloaded', info => {
    const downloadedVersion = String(info?.version || '').trim();
    if (!isStableVersion(downloadedVersion) || downloadedVersion !== status().availableVersion) {
      return handleError(new Error(`Downloaded update version ${downloadedVersion || 'unknown'} does not match expected version ${status().availableVersion || 'unknown'}.`));
    }
    log(`Application update ${downloadedVersion} passed release-metadata integrity verification and is ready to install.`);
    emit({
      state: 'downloaded', availableVersion: downloadedVersion,
      releaseDate: cleanText(info?.releaseDate, 80) || status().releaseDate,
      downloadedAt: isoNow(now),
      progress: progressPayload({ percent: 100, total: status().progress?.total, transferred: status().progress?.total }),
      integrityVerified: true, error: '', errorCode: ''
    });
  });
  bind('update-cancelled', () => emit({
    state: status().availableVersion ? 'available' : 'idle',
    progress: null,
    integrityVerified: false
  }));
  bind('error', handleError);
}

module.exports = { bindUpdaterEvents };
