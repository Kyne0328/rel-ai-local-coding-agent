

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { importResourceModule } from './resource-path.js';

const { readJsonFile, writeJsonAtomic } = await importResourceModule('src/durableState.js');

function createDesktopLifecycleManager(options = {}) {
  const {
    app,
    platform = process.platform,
    env = process.env,
    argv = process.argv,
    execPath = process.execPath,
    now = () => new Date().toISOString(),
    onLog = () => {},
    errorCodes = {}
  } = options;
  if (!app || typeof app.getVersion !== 'function') throw new TypeError('Electron app is required.');
  const statePath = path.join(safeUserDataPath(app), 'desktop-lifecycle.json');
  const startupSupport = detectStartupSupport({ app, platform, env });
  const codes = {
    unsupported: errorCodes.STARTUP_SETTING_NOT_SUPPORTED || 'startup_setting_not_supported',
    failed: errorCodes.STARTUP_SETTING_FAILED || 'startup_setting_failed',
    state: errorCodes.LIFECYCLE_STATE_FAILED || 'lifecycle_state_failed'
  };
  let launchId = '';
  let status = baseStatus(app, startupSupport);

  function start() {
    const previous = readState();
    const currentVersion = cleanVersion(app.getVersion());
    const launchAtLogin = readLaunchAtLogin();
    launchId = crypto.randomUUID();
    status = {
      ...baseStatus(app, startupSupport),
      currentVersion,
      previousVersion: previous.version && previous.version !== currentVersion ? cleanVersion(previous.version) : '',
      firstLaunch: !previous.version,
      updated: Boolean(previous.version && previous.version !== currentVersion),
      recoveredAfterUncleanShutdown: previous.running === true,
      launchCount: Math.max(0, Number(previous.launchCount || 0)) + 1,
      launchedAt: now(),
      lastCleanExitAt: cleanText(previous.lastCleanExitAt, 80),
      launchAtLogin,
      openedAtLogin: argv.includes('--background') || launchAtLogin.openedAtLogin === true
    };
    writeState({
      version: currentVersion,
      running: true,
      launchId,
      launchCount: status.launchCount,
      launchedAt: status.launchedAt,
      lastCleanExitAt: status.lastCleanExitAt
    });
    recordLaunch();
    return snapshot();
  }

  function markCleanShutdown() {
    if (!launchId) return snapshot();
    const cleanExitAt = now();
    writeState({
      version: status.currentVersion,
      running: false,
      launchId,
      launchCount: status.launchCount,
      launchedAt: status.launchedAt,
      lastCleanExitAt: cleanExitAt
    });
    status = { ...status, lastCleanExitAt: cleanExitAt };
    launchId = '';
    onLog('Desktop lifecycle recorded a clean shutdown.', { source: 'desktop-lifecycle' });
    return snapshot();
  }

  function getStatus() {
    status = { ...status, launchAtLogin: readLaunchAtLogin() };
    return snapshot();
  }

  function setLaunchAtLogin(enabled) {
    if (!startupSupport.supported) {
      return { ok: false, errorCode: codes.unsupported, error: startupSupport.reason, status: getStatus() };
    }
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled === true,
        openAsHidden: true,
        path: execPath,
        args: ['--background']
      });
      status = { ...status, launchAtLogin: readLaunchAtLogin() };
      onLog(`Launch at sign-in ${status.launchAtLogin.enabled ? 'enabled' : 'disabled'}.`, { source: 'desktop-lifecycle' });
      return { ok: true, status: snapshot() };
    } catch (error) {
      const message = cleanText(error?.message || error, 400) || 'Launch at sign-in could not be changed.';
      onLog(message, { source: 'desktop-lifecycle', level: 'error', code: codes.failed });
      return { ok: false, errorCode: codes.failed, error: message, status: snapshot() };
    }
  }

  function readLaunchAtLogin() {
    if (!startupSupport.supported) {
      return { supported: false, enabled: false, openedAtLogin: false, reason: startupSupport.reason };
    }
    try {
      const settings = app.getLoginItemSettings();
      return {
        supported: true,
        enabled: settings.openAtLogin === true,
        openedAtLogin: settings.wasOpenedAtLogin === true,
        reason: ''
      };
    } catch (error) {
      return {
        supported: false,
        enabled: false,
        openedAtLogin: false,
        reason: cleanText(error?.message || error, 300) || 'Startup settings are unavailable.'
      };
    }
  }

  function readState() {
    return readJsonFile(statePath, { backup: true, fallback: {} });
  }

  function writeState(value) {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      writeJsonAtomic(statePath, value, { mode: 0o600, backup: true });
    } catch (error) {
      onLog(`Desktop lifecycle state could not be saved: ${cleanText(error?.message || error, 240)}`, {
        source: 'desktop-lifecycle',
        level: 'warning',
        code: codes.state
      });
    }
  }

  function recordLaunch() {
    if (status.updated) {
      onLog(`Rel.AI MCP updated from ${status.previousVersion} to ${status.currentVersion}.`, { source: 'desktop-lifecycle' });
    } else if (status.firstLaunch) {
      onLog(`Rel.AI MCP ${status.currentVersion} started for the first time.`, { source: 'desktop-lifecycle' });
    }
    if (status.recoveredAfterUncleanShutdown) {
      onLog('Rel.AI recovered after the previous desktop process ended without a clean shutdown.', {
        source: 'desktop-lifecycle',
        level: 'warning',
        code: 'unclean_shutdown_detected'
      });
    }
  }

  function snapshot() {
    return { ...status, launchAtLogin: { ...status.launchAtLogin } };
  }

  return { start, markCleanShutdown, getStatus, setLaunchAtLogin };
}

function baseStatus(app, support) {
  return {
    currentVersion: cleanVersion(app.getVersion()),
    previousVersion: '',
    firstLaunch: false,
    updated: false,
    recoveredAfterUncleanShutdown: false,
    launchCount: 0,
    launchedAt: '',
    lastCleanExitAt: '',
    launchAtLogin: { supported: support.supported, enabled: false, openedAtLogin: false, reason: support.reason },
    openedAtLogin: false
  };
}

function detectStartupSupport({ app, platform, env }) {
  if (!app.isPackaged) return { supported: false, reason: 'Launch at sign-in is available only in the installed Windows app.' };
  if (platform !== 'win32') return { supported: false, reason: 'Launch at sign-in is currently available only on Windows.' };
  if (env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE) {
    return { supported: false, reason: 'Portable builds do not register themselves to launch at sign-in.' };
  }
  if (typeof app.getLoginItemSettings !== 'function' || typeof app.setLoginItemSettings !== 'function') {
    return { supported: false, reason: 'This build does not expose Windows startup settings.' };
  }
  return { supported: true, reason: '' };
}

function safeUserDataPath(app) {
  try { return app.getPath('userData'); } catch { return process.cwd(); }
}

function cleanVersion(value) {
  return cleanText(value, 80).replace(/^v/i, '');
}

function cleanText(value, limit) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export { createDesktopLifecycleManager, detectStartupSupport };
