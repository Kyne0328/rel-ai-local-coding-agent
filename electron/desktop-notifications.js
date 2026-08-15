import * as path from 'node:path';
import { importResourceModule } from './resource-path.js';

const { readJsonFile, writeJsonAtomic } = await importResourceModule('src/durableState.js');

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  enabled: true,
  taskCompleted: true,
  errors: false,
  connectionStatus: true,
  applicationUpdates: true,
  ignoredUpdateVersion: ''
});
const NOTIFICATION_CATEGORIES = new Set([
  'taskCompleted',
  'errors',
  'connectionStatus',
  'applicationUpdates'
]);

function normalizeNotificationPreferences(value, fallback = DEFAULT_NOTIFICATION_PREFERENCES) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    enabled: booleanValue(source.enabled, booleanValue(base.enabled, true)),
    taskCompleted: booleanValue(source.taskCompleted, booleanValue(base.taskCompleted, true)),
    errors: booleanValue(source.errors, booleanValue(base.errors, false)),
    connectionStatus: booleanValue(source.connectionStatus, booleanValue(base.connectionStatus, true)),
    applicationUpdates: booleanValue(source.applicationUpdates, booleanValue(base.applicationUpdates, true)),
    ignoredUpdateVersion: cleanText(
      typeof source.ignoredUpdateVersion === 'string'
        ? source.ignoredUpdateVersion
        : base.ignoredUpdateVersion,
      80
    )
  };
}

function createDesktopNotifications(options = {}) {
  const {
    app,
    Notification,
    iconPath = '',
    isReady = () => true,
    onNotificationClick = () => {},
    onLog = () => {}
  } = options;
  if (!app || typeof app.getPath !== 'function') throw new TypeError('Electron app is required.');

  const statePath = path.join(safeUserDataPath(app), 'desktop-notifications.json');
  const notifiedKeys = new Set();
  let preferences = readPreferences();

  function readPreferences() {
    try {
      const stored = readJsonFile(statePath, {
        backup: true,
        fallback: DEFAULT_NOTIFICATION_PREFERENCES,
        onRecovery: details => onLog('Recovered desktop notification preferences from backup.', {
          source: 'desktop-notifications',
          level: 'warning',
          ...details
        })
      });
      return normalizeNotificationPreferences(stored);
    } catch (error) {
      onLog(`Desktop notification preferences could not be read: ${cleanText(error?.message || error, 240)}`, {
        source: 'desktop-notifications',
        level: 'warning'
      });
      return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }
  }

  function getPreferences() {
    return { ...preferences };
  }

  function updatePreferences(patch = {}) {
    const next = normalizeNotificationPreferences(
      patch && typeof patch === 'object' ? { ...preferences, ...patch } : preferences,
      preferences
    );
    try {
      writeJsonAtomic(statePath, next, { mode: 0o600, backup: true });
      preferences = next;
      return { ok: true, preferences: getPreferences() };
    } catch (error) {
      const message = cleanText(error?.message || error, 400) || 'Desktop notification preferences could not be saved.';
      onLog(message, { source: 'desktop-notifications', level: 'error' });
      return { ok: false, error: message, preferences: getPreferences() };
    }
  }

  function setEnabled(value) {
    const result = updatePreferences({ enabled: value === true });
    if (!result.ok) throw new Error(result.error || 'Desktop notification preferences could not be saved.');
    return result.preferences.enabled;
  }

  function show(category, content = {}, eventOptions = {}) {
    if (!NOTIFICATION_CATEGORIES.has(category)) return false;
    if (!preferences.enabled || !preferences[category]) return false;
    const version = cleanText(eventOptions.version, 80);
    if (category === 'applicationUpdates' && version && preferences.ignoredUpdateVersion === version) return false;
    if (!isReady()) return false;
    if (typeof Notification?.isSupported === 'function' && !Notification.isSupported()) return false;

    const title = cleanText(content.title, 100);
    const body = cleanText(content.body, 260);
    if (!title) return false;
    try {
      const notificationOptions = { title, body, silent: false };
      if (iconPath) notificationOptions.icon = iconPath;
      const notification = new Notification(notificationOptions);
      if (typeof notification.on === 'function') notification.on('click', onNotificationClick);
      notification.show();
      return true;
    } catch (error) {
      onLog(`Desktop notification could not be shown: ${cleanText(error?.message || error, 240)}`, {
        source: 'desktop-notifications',
        level: 'warning'
      });
      return false;
    }
  }

  function showOnce(key, category, content, eventOptions) {
    const normalizedKey = cleanText(key, 200);
    if (!normalizedKey || notifiedKeys.has(normalizedKey)) return false;
    const shown = show(category, content, eventOptions);
    if (shown) notifiedKeys.add(normalizedKey);
    return shown;
  }

  function handleDesktopStatusChange(previous = {}, current = {}) {
    const previousState = desktopState(previous);
    const currentState = desktopState(current);
    if (previousState === currentState) return false;
    if (currentState === 'error') {
      return show('errors', {
        title: 'Rel.AI needs attention',
        body: cleanText(current.error, 220) || 'The desktop service could not complete the requested connection change.'
      });
    }
    if (currentState === 'ready') {
      return show('connectionStatus', {
        title: 'Connection ready',
        body: 'The secure ChatGPT connection is active and configured workspaces are available.'
      });
    }
    if (currentState === 'authorization_required') {
      return show('connectionStatus', {
        title: 'ChatGPT authorization required',
        body: 'Open Rel.AI to approve the current ChatGPT connection.'
      });
    }
    if (currentState === 'stopped' && previousState !== 'stopped') {
      return show('connectionStatus', {
        title: 'Rel.AI service stopped',
        body: 'The local service and public ChatGPT connection are no longer running.'
      });
    }
    return false;
  }

  function handleUpdateStatus(status = {}) {
    const state = String(status.state || '');
    const version = cleanText(status.availableVersion, 80);
    if (state === 'available' && version) {
      return showOnce(`update:available:${version}`, 'applicationUpdates', {
        title: 'Update available',
        body: `Rel.AI MCP ${version} is available to download.`
      }, { version });
    }
    if (state === 'downloaded' && version && status.integrityVerified === true) {
      return showOnce(`update:downloaded:${version}`, 'applicationUpdates', {
        title: 'Update ready to install',
        body: `Rel.AI MCP ${version} is downloaded and ready to install.`
      }, { version });
    }
    if (state === 'error') {
      const error = cleanText(status.error, 200);
      return showOnce(`update:error:${status.errorCode || ''}:${error}`, 'errors', {
        title: 'Application update failed',
        body: error || 'Rel.AI could not complete the application update action.'
      });
    }
    return false;
  }

  return {
    getPreferences,
    updatePreferences,
    setEnabled,
    show,
    handleDesktopStatusChange,
    handleUpdateStatus
  };
}

function desktopState(status = {}) {
  if (status.errorCode || status.error || status.tunnelStatus === 'failed') return 'error';
  if (status.serverRunning && status.authenticationRequired === true) return 'authorization_required';
  if (status.connectionState?.chatgptReadiness?.status === 'ready') return 'ready';
  if (!status.serverRunning) return 'stopped';
  return 'connecting';
}

function booleanValue(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function cleanText(value, limit) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

function safeUserDataPath(app) {
  try { return app.getPath('userData'); } catch { return process.cwd(); }
}

export {
  DEFAULT_NOTIFICATION_PREFERENCES,
  createDesktopNotifications,
  normalizeNotificationPreferences
};
