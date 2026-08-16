

import { AUTO_CHECK_INTERVAL_MS, AUTO_CHECK_DELAY_MS, cleanText, createLogger, createUpdateStateStore, detectUpdateSupport, normalizeStatus, progressPayload } from "./app-updater-state.js";
import { importResourceModule } from './resource-path.js';

const { runtimeMetadata } = await importResourceModule('src/runtimeCompatibility.js');
import { bindUpdaterEvents } from "./app-updater-events.js";
import { taskActivityBlockReason } from './tool-sleep-blocker.js';
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
    currentCompatibility = null
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
  const handlers = [];
  let autoCheckTimer = null;
  let retryingOperation = '';
  let started = false;
  let status = normalizeStatus({
    state: support.supported ? 'idle' : 'unsupported',
    supported: support.supported,
    supportReason: support.reason,
    currentVersion: app.getVersion()
  });

  function start() {
    if (started) return snapshot();
    started = true;
    if (!support.supported) {
      emit({ state: 'unsupported' });
      return snapshot();
    }
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
    void scheduleAutomaticCheck();
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
      await runWithRetries('Update check', () => autoUpdater.checkForUpdates());
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
      await runWithRetries('Update download', () => autoUpdater.downloadUpdate());
      return { ok: true, status: snapshot() };
    } catch (error) {
      return handleError(error);
    }
  }

  function installUpdate() {
    if (!support.supported) return failure(codes.unsupported, support.reason, false);
    if (status.state !== 'downloaded' || status.integrityVerified !== true) {
      return failure(codes.busy, 'Download and verify the update before restarting to install it.', false);
    }
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

  async function scheduleAutomaticCheck() {
    if (!support.supported || !started) return;
    if (autoCheckTimer) clearTimer(autoCheckTimer);
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
    if (retryingOperation && isTransientUpdateError(error)) return;
    return handleError(error);
  }

  function handleError(error) {
    const message = cleanText(error instanceof Error ? error.message : error, 600) || 'The application update failed.';
    log(message, { level: 'error', code: codes.failed });
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

export { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, compareVersions, createAppUpdater, detectUpdateSupport, isStableVersion, normalizeStatus, parseStableVersion, progressPayload };
