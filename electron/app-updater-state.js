

import * as fs from "node:fs";
import * as path from "node:path";
import { importResourceModule } from './resource-path.js';

const { readJsonFile, writeJsonAtomic } = await importResourceModule('src/durableState.js');

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_DELAY_MS = 15 * 1000;

function createUpdateStateStore({ app, onLog = () => {} }) {
  const statePath = path.join(safeUserDataPath(app), 'update-state.json');

  function readLastCheck() {
    const value = readJsonFile(statePath, { backup: true, fallback: {} });
    return Number(value.lastCheckAt || 0);
  }

  function writeLastCheck(timestamp) {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
      writeJsonAtomic(statePath, { lastCheckAt: Number(timestamp || 0) }, { mode: 0o600, backup: true });
    } catch (error) {
      onLog(`Could not save update-check time: ${cleanText(error?.message || error, 200)}`, {
        source: 'updater',
        level: 'warning'
      });
    }
  }

  return { readLastCheck, writeLastCheck };
}

function detectUpdateSupport({ app, platform, env }) {
  if (!app.isPackaged) return { supported: false, reason: 'Updates are available only in an installed Rel.AI MCP build.' };
  if (platform === 'win32') {
    if (env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE) {
      return { supported: false, reason: 'Portable builds must be updated manually from the GitHub Releases page.' };
    }
    return { supported: true, reason: '' };
  }
  if (platform === 'linux') {
    if (!env.APPIMAGE) {
      return { supported: false, reason: 'Automatic updates are available for the Linux AppImage. DEB installations must be updated manually.' };
    }
    return { supported: true, reason: '' };
  }
  return { supported: false, reason: 'Automatic updates are not available for this operating system.' };
}

function normalizeStatus(value) {
  const state = String(value.state || 'idle');
  const supported = value.supported === true;
  return {
    state,
    supported,
    supportReason: cleanText(value.supportReason, 300),
    currentVersion: cleanVersion(value.currentVersion),
    availableVersion: cleanVersion(value.availableVersion),
    releaseDate: cleanText(value.releaseDate, 80),
    checkedAt: cleanText(value.checkedAt, 80),
    downloadedAt: cleanText(value.downloadedAt, 80),
    progress: value.progress ? progressPayload(value.progress) : null,
    errorCode: cleanText(value.errorCode, 120),
    error: cleanText(value.error, 600),
    integrityVerified: value.integrityVerified === true,
    updateSynchronization: normalizeUpdateSynchronization(value.updateSynchronization),
    availableCompatibility: normalizeUpdateCompatibility(value.availableCompatibility),
    canCheck: supported && !['checking', 'downloading', 'installing'].includes(state),
    canDownload: supported && state === 'available',
    canInstall: supported && state === 'downloaded' && value.integrityVerified === true
  };
}

function updateCompatibilityMetadata(info = {}, applicationVersion = '') {
  const raw = info?.relai || info?.relAi || info?.relaiCompatibility;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = {
    applicationVersion: cleanVersion(applicationVersion || info?.version),
    schemaVersion: Number(raw.schemaVersion),
    manifestHash: cleanText(raw.manifestHash, 200),
    deviceProtocolVersion: Number(raw.deviceProtocolVersion),
    minimumCompatibleDeviceProtocol: Number(raw.minimumCompatibleDeviceProtocol)
  };
  if (!value.applicationVersion || !Number.isInteger(value.schemaVersion) || value.schemaVersion <= 0 || !value.manifestHash) return null;
  if (!Number.isInteger(value.deviceProtocolVersion) || value.deviceProtocolVersion <= 0) return null;
  if (!Number.isInteger(value.minimumCompatibleDeviceProtocol) || value.minimumCompatibleDeviceProtocol <= 0) return null;
  return value;
}

function normalizeUpdateCompatibility(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return updateCompatibilityMetadata({ relai: value, version: value.applicationVersion }, value.applicationVersion);
}

function normalizeUpdateSynchronization(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = String(value.status || '');
  if (!['current', 'tool_refresh_required', 'device_update_required'].includes(status)) return null;
  return {
    status,
    toolRefreshRequired: value.toolRefreshRequired === true,
    deviceUpdateRequired: value.deviceUpdateRequired === true
  };
}

function assessUpdateSynchronization(current = {}, available = {}) {
  const schemaChanged = Number(current.schemaVersion || 0) !== Number(available.schemaVersion || 0)
    || String(current.manifestHash || '') !== String(available.manifestHash || '');
  const deviceChanged = Number(current.deviceProtocolVersion || 0) !== Number(available.deviceProtocolVersion || 0)
    || Number(current.minimumCompatibleDeviceProtocol || 0) !== Number(available.minimumCompatibleDeviceProtocol || 0);
  return {
    status: deviceChanged ? 'device_update_required' : schemaChanged ? 'tool_refresh_required' : 'current',
    toolRefreshRequired: schemaChanged,
    deviceUpdateRequired: deviceChanged
  };
}

function progressPayload(value = {}) {
  return {
    percent: clampNumber(value.percent, 0, 100),
    transferred: nonNegativeNumber(value.transferred),
    total: nonNegativeNumber(value.total),
    bytesPerSecond: nonNegativeNumber(value.bytesPerSecond)
  };
}

function clampNumber(value, minimum, maximum) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(number * 10) / 10));
}

function nonNegativeNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function cleanVersion(value) {
  return cleanText(value, 80).replace(/^v/i, '');
}

function cleanText(value, limit) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function isoNow(now) {
  return new Date(now()).toISOString();
}

function safeUserDataPath(app) {
  try {
    return app.getPath('userData');
  } catch {
    return process.cwd();
  }
}

function createLogger(onLog) {
  const write = (level, args) => {
    const message = args.map(value => value instanceof Error ? value.message : String(value || '')).join(' ');
    onLog(cleanText(message, 1000), { source: 'updater', level });
  };
  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warning', args),
    error: (...args) => write('error', args),
    debug: (...args) => write('info', args)
  };
}

export { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, assessUpdateSynchronization, cleanText, cleanVersion, createLogger, createUpdateStateStore, detectUpdateSupport, isoNow, normalizeStatus, progressPayload, updateCompatibilityMetadata };
