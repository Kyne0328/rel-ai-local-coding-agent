

import * as fs from "node:fs";
import * as path from "node:path";
import { importResourceModule } from './resource-path.js';
import { assessUpdateSynchronization, cleanText, cleanVersion, normalizeStatus, progressPayload, updateCompatibilityMetadata } from './app-updater-status.js';

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
