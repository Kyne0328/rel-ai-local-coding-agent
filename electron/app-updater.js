

import { AUTO_CHECK_INTERVAL_MS, AUTO_CHECK_DELAY_MS, cleanText, createLogger, createUpdateStateStore, detectUpdateSupport, isoNow, normalizeStatus, progressPayload } from "./app-updater-state.js";
import { importResourceModule } from './resource-path.js';

const { runtimeMetadata } = await importResourceModule('src/runtimeCompatibility.js');
import { bindUpdaterEvents } from "./app-updater-events.js";
import { taskActivityBlockReason } from './tool-sleep-blocker.js';
import { createMacManualUpdater } from './macos-manual-updater.js';
import { compareVersions, isStableVersion, parseStableVersion } from "./update-version.js";

const UPDATE_RETRY_DELAYS_MS = Object.freeze([500, 1500]);
const TRANSIENT_UPDATE_ERROR_CODES = Object.freeze([
  'ERR_HTTP2_SERVER_REFUSED_STREAM',
  'ERR_CONNECTION_RESET',
  'ECONNRESET',
  'EPIPE',
  'ERR_TIMED_OUT',
  'ETIMEDOUT',
  'ERR_NETWORK_CHANGED'
]);

function createAppUpdater(options = {}) {
  const {
    app,
    autoUpdater,
    platform = process.platform,
    env = process.env,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    getTaskActivity = () => ({}),
    onStatusChange = () => {},
    onBeforeInstall = () => {},
    retryDelay = delay => new Promise(resolve => setTimer(resolve, delay)),
    onLog = () => {},
    errorCodes = {},
    currentCompatibility = null,
    arch = process.arch,
    fetchImpl = globalThis.fetch,
    openUpdateFile = null,
    manualMacUpdater = null
  } = options;
  if (!app || typeof app.getVersion !== 'function') throw new TypeError('Electron app is required.');
  if (!autoUpdater || typeof autoUpdater.on !== 'function') throw new TypeError('electron-updater autoUpdater is required.');

  const codes = {
    failed: errorCodes.UPDATE_FAILED || 'update_failed',
    unsupported: errorCodes.UPDATE_NOT_SUPPORTED || 'update_not_supported',
    busy: errorCodes.UPDATE_BUSY || 'update_busy',
    blocked: errorCodes.UPDATE_INSTALL_BLOCKED || 'update_install_blocked'
  };
  const support = detectUpdateSupport({ app, platform, env });
  const installedCompatibility = currentCompatibility || runtimeMetadata();
  const store = createUpdateStateStore({ app, onLog });
  const macUpdater = platform === 'darwin' && support.supported
    ? manualMacUpdater || createMacManualUpdater({ app, arch, fetchImpl, openPath: openUpdateFile, now, onLog: message => log(message) })
    : null;
  const handlers = [];
  let autoCheckTimer = null;
  let retryingOperation = '';
  let started = false;
  let status = normalizeStatus({
    state: support.supported ? 'idle' : 'unsupported',
    supported: support.supported,
    supportReason: support.reason,
    currentVersion: app.getVersion(),
    installMode: platform === 'darwin' ? 'open_dmg' : 'restart'
  });

  function start() {
    if (started) return snapshot();
    started = true;
    if (!support.supported) {
      emit({ state: 'unsupported' });
      return snapshot();
    }
    if (platform !== 'darwin') {
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowPrerelease = false;
      autoUpdater.logger = createLogger(onLog);
      bindUpdaterEvents({
        autoUpdater,
        handlers,
        status: snapshot,
        emit,
        handleError,
        handleEventError: handleUpdaterEventError,
        store,
        now,
        log,
        currentCompatibility: installedCompatibility
      });
    }
    void scheduleAutomaticCheck(true);
    emit({ state: 'idle' });
    return snapshot();
  }

  function stop() {
    if (autoCheckTimer) clearTimer(autoCheckTimer);
    autoCheckTimer = null;
    for (const [eventName, handler] of handlers.splice(0)) autoUpdater.removeListener?.(eventName, handler);
    started = false;
  }

  async function checkForUpdates() {
    if (!support.supported) return failure(codes.unsupported, support.reason, false);
    if (isBusy()) return failure(codes.busy, 'An update action is already in progress.', false);
    emit({ state: 'checking', error: '', errorCode: '', integrityVerified: false, availableCompatibility: null, updateSynchronization: null });
    log('Checking for application updates.');
    try {
      if (platform === 'darwin') {
        const info = await runWithRetries('Update check', () => macUpdater.checkForUpdates());
        applyMacCheckResult(info);
      } else {
        await runWithRetries('Update check', () => autoUpdater.checkForUpdates());
      }
      await store.writeLastCheck(now());
      void scheduleAutomaticCheck();
      return { ok: true, status: snapshot() };
    } catch (error) {
      await store.writeLastCheck(now());
      void scheduleAutomaticCheck();
      return handleError(error);
    }
  }

  async function downloadUpdate() {
    if (!support.supported) return failure(codes.unsupported, support.reason, false);
    if (status.state === 'downloaded') return { ok: true, status: snapshot() };
    if (status.state !== 'available') return failure(codes.busy, 'No downloadable update is currently available.', false);
    emit({ state: 'downloading', progress: progressPayload({ percent: 0 }), error: '', errorCode: '', integrityVerified: false });
    log(`Downloading Rel.AI MCP ${status.availableVersion || 'update'}.`);
    try {
      if (platform === 'darwin') {
        const info = await runWithRetries('Update download', () => macUpdater.downloadUpdate({
          version: status.availableVersion,
          onProgress: progress => emit({ state: 'downloading', progress: progressPayload(progress) })
        }));
        applyMacDownloadResult(info);
      } else {
        await runWithRetries('Update download', () => autoUpdater.downloadUpdate());
      }
      return { ok: true, status: snapshot() };
    } catch (error) {
      return handleError(error);
    }
  }

  function installUpdate() {
    if (!support.supported) return failure(codes.unsupported, support.reason, false);
    if (status.state !== 'downloaded' || status.integrityVerified !== true) {
      const guidance = platform === 'darwin'
        ? 'Download and verify the update before opening the macOS installer.'
        : 'Download and verify the update before restarting to install it.';
      return failure(codes.busy, guidance, false);
    }
    if (platform === 'darwin') return openMacUpdate();
    const taskBlock = taskActivityBlockReason(getTaskActivity(), 'restarting to install the update');
    if (taskBlock) return failure(codes.blocked, taskBlock, true);
    emit({ state: 'installing', error: '', errorCode: '' });
    log(`Restarting to install Rel.AI MCP ${status.availableVersion || 'update'}.`);
    let preparation;
    try {
      preparation = Promise.resolve(onBeforeInstall());
    } catch (error) {
      preparation = Promise.reject(error);
    }
    setTimer(() => {
      preparation.then(() => {
        autoUpdater.quitAndInstall(false, true);
      }).catch(handleError);
    }, 50);
    return { ok: true, installing: true, status: snapshot() };
  }

  async function openMacUpdate() {
    try {
      await macUpdater.openDownloaded(status.availableVersion);
      log(`Opened verified macOS update ${status.availableVersion || ''} for manual installation.`);
      return { ok: true, opened: true, status: snapshot() };
    } catch (error) {
      return handleError(error);
    }
  }

  function applyMacCheckResult(info = {}) {
    const availableVersion = String(info.version || '').trim();
    if (!isStableVersion(availableVersion)) throw new Error('Update metadata contains an invalid stable version.');
    if (!isStableVersion(status.currentVersion)) {
      throw new Error('The installed application version is invalid, so the update cannot be trusted.');
    }
    if (compareVersions(availableVersion, status.currentVersion) <= 0) {
      log('Rel.AI MCP is up to date.');
      emit({
        state: 'up_to_date', availableVersion: '', releaseDate: '', releaseNotes: [],
        availableCompatibility: null, updateSynchronization: null,
        checkedAt: isoNow(now), downloadedAt: '', progress: null,
        integrityVerified: false, error: '', errorCode: ''
      });
      return;
    }
    log(`Application update ${availableVersion} was found.`);
    emit({
      state: 'available', availableVersion,
      availableCompatibility: null, updateSynchronization: null,
      releaseDate: cleanText(info.releaseDate, 80), releaseNotes: info.releaseNotes,
      checkedAt: isoNow(now), downloadedAt: '', progress: null,
      integrityVerified: false, error: '', errorCode: ''
    });
  }

  function applyMacDownloadResult(info = {}) {
    const downloadedVersion = String(info.version || '').trim();
    if (!isStableVersion(downloadedVersion) || downloadedVersion !== status.availableVersion) {
      throw new Error(`Downloaded update version ${downloadedVersion || 'unknown'} does not match expected version ${status.availableVersion || 'unknown'}.`);
    }
    log(`Application update ${downloadedVersion} passed SHA-256 release verification and is ready to open.`);
    emit({
      state: 'downloaded', availableVersion: downloadedVersion,
      releaseDate: cleanText(info.releaseDate, 80) || status.releaseDate,
      releaseNotes: info.releaseNotes || status.releaseNotes,
      downloadedAt: isoNow(now),
      progress: progressPayload({ percent: 100, total: status.progress?.total, transferred: status.progress?.total }),
      integrityVerified: true, error: '', errorCode: ''
    });
  }

  async function scheduleAutomaticCheck(forceLaunchCheck = false) {
    if (!support.supported || !started) return;
    if (autoCheckTimer) clearTimer(autoCheckTimer);
    if (forceLaunchCheck) {
      autoCheckTimer = setTimer(() => {
        autoCheckTimer = null;
        void checkForUpdates();
      }, AUTO_CHECK_DELAY_MS);
      autoCheckTimer?.unref?.();
      return;
    }
    const lastCheck = await store.readLastCheck();
    if (!support.supported || !started) return;
    const elapsed = lastCheck > 0 ? Math.max(0, now() - lastCheck) : 0;
    const delay = lastCheck > 0 && elapsed < AUTO_CHECK_INTERVAL_MS
      ? AUTO_CHECK_INTERVAL_MS - elapsed
      : AUTO_CHECK_DELAY_MS;
    autoCheckTimer = setTimer(() => {
      autoCheckTimer = null;
      void checkForUpdates();
    }, delay);
    autoCheckTimer?.unref?.();
  }

  async function runWithRetries(label, action) {
    retryingOperation = label;
    try {
      for (let attempt = 0; attempt <= UPDATE_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          return await action();
        } catch (error) {
          if (!isTransientUpdateError(error) || attempt >= UPDATE_RETRY_DELAYS_MS.length) throw error;
          const delay = UPDATE_RETRY_DELAYS_MS[attempt];
          log(`${label} hit a transient network error. Retrying in ${delay} ms (${attempt + 2}/${UPDATE_RETRY_DELAYS_MS.length + 1}).`, { level: 'warning', code: 'update_retry' });
          await retryDelay(delay);
        }
      }
    } finally {
      retryingOperation = '';
    }
  }

  function handleUpdaterEventError(error) {
    // The awaited check/download owns failures while it is running. electron-updater can
    // emit the same error before rejecting, so handling both paths would duplicate status
    // changes, logs, and user notifications.
    if (retryingOperation) return;
    return handleError(error);
  }

  function handleError(error) {
    const technicalMessage = cleanText(error instanceof Error ? error.message : error, 600) || 'The application update failed.';
    const message = updateRecoveryMessage(error);
    log(technicalMessage, { level: 'error', code: codes.failed });
    emit({ state: 'error', errorCode: codes.failed, error: message, progress: null, integrityVerified: false });
    return failure(codes.failed, message, true);
  }

  function isBusy() {
    return ['checking', 'downloading', 'installing'].includes(status.state);
  }

  function failure(errorCode, error, retryable) {
    return { ok: false, errorCode, error, retryable, status: snapshot() };
  }

  function emit(patch) {
    status = normalizeStatus({ ...status, ...patch });
    onStatusChange(snapshot());
  }

  function snapshot() {
    return { ...status, progress: status.progress ? { ...status.progress } : null };
  }

  function log(message, options = {}) {
    onLog(cleanText(message, 1000), { source: 'updater', ...options });
  }

  return { start, stop, getStatus: snapshot, checkForUpdates, downloadUpdate, installUpdate };
}

function isTransientUpdateError(error) {
  const code = cleanText(error?.code, 120).toUpperCase();
  const message = cleanText(error instanceof Error ? error.message : error, 600).toUpperCase();
  return TRANSIENT_UPDATE_ERROR_CODES.some(candidate => code.includes(candidate) || message.includes(candidate));
}

function updateRecoveryMessage(error) {
  const technicalMessage = cleanText(error instanceof Error ? error.message : error, 600);
  if (isTransientUpdateError(error)) {
    return 'Rel.AI could not reach the update service. Check your internet connection and try again.';
  }
  if (/invalid stable version|cannot be trusted|does not match expected version|metadata version|SHA-256|checksum|untrusted update URL|untrusted download URL/i.test(technicalMessage)) {
    return 'Rel.AI could not verify this update. Check for updates again. If the problem continues, install the latest release from GitHub Releases.';
  }
  return 'Rel.AI could not complete the update. Try again. If the problem continues, open Troubleshooting for technical details.';
}

export { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, compareVersions, createAppUpdater, detectUpdateSupport, isStableVersion, normalizeStatus, parseStableVersion, progressPayload };
