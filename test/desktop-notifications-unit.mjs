import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  createDesktopNotifications,
  normalizeNotificationPreferences
} from '../electron/desktop-notifications.js';
import { normalizeDesktopStatus } from '../electron/desktop-status.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-desktop-notifications-'));
const shown = [];
const logs = [];
let clicked = 0;

class FakeNotification {
  static isSupported() { return true; }
  constructor(options) {
    this.options = options;
    this.listeners = new Map();
    shown.push(this);
  }
  on(name, callback) { this.listeners.set(name, callback); }
  show() { this.shown = true; }
  click() { this.listeners.get('click')?.(); }
}

const normalized = normalizeNotificationPreferences({
  enabled: false,
  taskCompleted: 'yes',
  errors: false,
  connectionStatus: 1,
  applicationUpdates: true,
  ignoredUpdateVersion: ' 0.24.0 '
});
assert.deepEqual(normalized, {
  enabled: false,
  taskCompleted: true,
  errors: false,
  connectionStatus: true,
  applicationUpdates: true,
  ignoredUpdateVersion: '0.24.0'
});
assert.deepEqual(normalizeNotificationPreferences(null), DEFAULT_NOTIFICATION_PREFERENCES);

const options = {
  app: { getPath: () => root },
  Notification: FakeNotification,
  iconPath: 'C:\\RelAI\\icon.png',
  isReady: () => true,
  onNotificationClick: () => { clicked += 1; },
  onLog: (message, details) => logs.push({ message, details })
};
const service = createDesktopNotifications(options);
assert.deepEqual(service.getPreferences(), DEFAULT_NOTIFICATION_PREFERENCES);
assert.equal(service.getPreferences().errors, false);
assert.equal(service.show('errors', { title: 'Workspace action failed', body: 'Failed.' }), false);
assert.equal(shown.length, 0);

assert.equal(service.show('taskCompleted', { title: 'Task completed', body: 'Done.' }), true);
assert.equal(shown.length, 1);
assert.equal(shown[0].options.icon, 'C:\\RelAI\\icon.png');
shown[0].click();
assert.equal(clicked, 1);

let result = service.updatePreferences({ errors: false, connectionStatus: false });
assert.equal(result.ok, true);
assert.equal(result.preferences.errors, false);
assert.equal(result.preferences.connectionStatus, false);
assert.equal(service.show('errors', { title: 'Failed', body: 'No alert.' }), false);
assert.equal(shown.length, 1);

result = service.updatePreferences({ enabled: false });
assert.equal(result.ok, true);
assert.equal(service.show('taskCompleted', { title: 'Muted', body: 'No alert.' }), false);
assert.equal(service.getPreferences().taskCompleted, true, 'master switch must preserve category choices');
service.setEnabled(true);
service.updatePreferences({ errors: true, connectionStatus: true, ignoredUpdateVersion: '0.24.0' });

service.handleUpdateStatus({ state: 'available', availableVersion: '0.24.0' });
assert.equal(shown.length, 1, 'ignored version must suppress native update notifications');
service.handleUpdateStatus({ state: 'available', availableVersion: '0.24.1' });
assert.equal(shown.length, 2);
assert.equal(shown[1].options.title, 'Update available');
service.handleUpdateStatus({ state: 'available', availableVersion: '0.24.1' });
assert.equal(shown.length, 2, 'same update event must notify once per launch');
service.handleUpdateStatus({ state: 'downloaded', availableVersion: '0.24.1', integrityVerified: true });
assert.equal(shown.length, 3);
assert.equal(shown[2].options.title, 'Update ready to install');
service.handleUpdateStatus({ state: 'error', error: 'download failed' });
assert.equal(shown.length, 4);
assert.equal(shown[3].options.title, 'Application update failed');

service.handleDesktopStatusChange(
  normalizeDesktopStatus({ serverRunning: false, tunnelStatus: 'stopped', errorCode: '', error: '' }),
  normalizeDesktopStatus({ serverRunning: true, tunnelStatus: 'running', errorCode: '', error: '' })
);
assert.equal(shown.length, 5);
assert.equal(shown[4].options.title, 'Connection ready');
service.handleDesktopStatusChange(
  normalizeDesktopStatus({ serverRunning: false, tunnelStatus: 'stopped', errorCode: '', error: '' }),
  normalizeDesktopStatus({ serverRunning: true, tunnelStatus: 'running', authenticationRequired: true, errorCode: '', error: '' })
);
assert.equal(shown.length, 6);
assert.equal(shown[5].options.title, 'ChatGPT authorization required');
service.handleDesktopStatusChange(
  normalizeDesktopStatus({ serverRunning: true, tunnelStatus: 'running', errorCode: '', error: '' }),
  normalizeDesktopStatus({ serverRunning: false, tunnelStatus: 'stopped', errorCode: '', error: '' })
);
assert.equal(shown.length, 7);
assert.equal(shown[6].options.title, 'Rel.AI service stopped');
service.handleDesktopStatusChange(
  { serverRunning: false, tunnelStatus: 'stopped', errorCode: '', error: '' },
  { serverRunning: false, tunnelStatus: 'failed', errorCode: 'public_endpoint_failed', error: 'Tunnel failed.' }
);
assert.equal(shown.length, 8);
assert.equal(shown[7].options.title, 'Rel.AI needs attention');
assert.match(shown[7].options.body, /Secure MCP Tunnel could not start/);
assert.match(shown[7].options.body, /Check the OpenAI Secure MCP Tunnel settings, then reconnect/);
assert.doesNotMatch(shown[7].options.body, /Tunnel failed/, 'desktop alerts should keep raw connection errors in diagnostics');

const reloaded = createDesktopNotifications(options);
assert.deepEqual(reloaded.getPreferences(), service.getPreferences(), 'preferences must persist across application launches');
assert.equal(logs.length, 0);

const blockedStatePath = path.join(root, 'not-a-directory');
fs.writeFileSync(blockedStatePath, 'blocked');
const failedLogs = [];
const failedService = createDesktopNotifications({
  ...options,
  app: { getPath: () => blockedStatePath },
  onLog: (message, details) => failedLogs.push({ message, details })
});
const failedUpdate = failedService.updatePreferences({ enabled: false });
assert.equal(failedUpdate.ok, false);
assert.equal(failedService.getPreferences().enabled, true, 'failed persistence must preserve the active preference snapshot');
assert.throws(() => failedService.setEnabled(false), /could not be saved|could not persist|not a directory|ENOTDIR/i);
assert.ok(failedLogs.length >= 1);

fs.rmSync(root, { recursive: true, force: true });
console.log('Desktop notification preference tests passed.');
