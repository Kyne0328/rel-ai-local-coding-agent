

import fs from 'node:fs';
import * as path from "node:path";
import { importResourceModule } from './resource-path.js';
import { assessUpdateSynchronization, cleanText, normalizeStatus, progressPayload, updateCompatibilityMetadata } from './app-updater-status.js';

const { readJsonFileAsync, writeJsonAtomicAsync } = await importResourceModule('src/durableState.js');

const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_CHECK_DELAY_MS = 15 * 1000;

function createUpdateStateStore({ app, onLog = () => {} }) {
  const statePath = path.join(safeUserDataPath(app), 'update-state.json');
  let lastCheckAt = 0;
  const hydrated = readJsonFileAsync(statePath, { backup: true, fallback: {} })
    .then(value => { lastCheckAt = Number(value.lastCheckAt || 0); })
    .catch(error => logStateError('read', error));

  async function readLastCheck() {
    await hydrated;
    return lastCheckAt;
  }

  async function writeLastCheck(timestamp) {
    await hydrated;
    lastCheckAt = Number(timestamp || 0);
    try {
      await writeJsonAtomicAsync(statePath, { lastCheckAt }, { mode: 0o600, backup: true });
    } catch (error) {
      logStateError('save', error);
    }
  }

  function logStateError(action, error) {
    onLog(`Could not ${action} update-check time: ${cleanText(error?.message || error, 200)}`, {
      source: 'updater',
      level: 'warning'
    });
  }

  return { readLastCheck, writeLastCheck };
}

function detectUpdateSupport({ app, platform, env, resourcesPath = process.resourcesPath }) {
  if (!app.isPackaged) return { supported: false, reason: 'Updates are available only in an installed Rel.AI MCP build.' };
  if (platform === 'win32') {
    if (env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE) {
      return { supported: false, reason: 'Portable builds must be updated manually from the GitHub Releases page.' };
    }
    return { supported: true, reason: '' };
  }
  if (platform === 'linux') {
    if (env.APPIMAGE || readLinuxPackageType(resourcesPath) === 'deb') return { supported: true, reason: '' };
    return { supported: false, reason: 'Automatic updates are available for installed Linux AppImage and DEB builds.' };
  }
  if (platform === 'darwin') return { supported: true, reason: '' };
  return { supported: false, reason: 'Automatic updates are not available for this operating system.' };
}

function readLinuxPackageType(resourcesPath) {
  try {
    return fs.readFileSync(path.join(String(resourcesPath || ''), 'package-type'), 'utf8').trim().toLowerCase();
  } catch {
    return '';
  }
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

export { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, assessUpdateSynchronization, cleanText, createLogger, createUpdateStateStore, detectUpdateSupport, isoNow, normalizeStatus, progressPayload, updateCompatibilityMetadata };
