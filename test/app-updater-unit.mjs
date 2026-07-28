import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, compareVersions, createAppUpdater, detectUpdateSupport, isStableVersion, normalizeStatus, parseStableVersion, progressPayload } from "../electron/app-updater.js";

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = [];
  }
  async checkForUpdates() { this.checkCalls += 1; }
  async downloadUpdate() { this.downloadCalls += 1; }
  quitAndInstall(silent, forceRunAfter) { this.installCalls.push({ silent, forceRunAfter }); }
}

const roots = [];
function createHarness({ currentVersion = '0.20.7', packaged = true, env = {}, activeCalls = 0 } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-updater-'));
  roots.push(temp);
  const fake = new FakeUpdater();
  const statuses = [];
  const logs = [];
  const timers = [];
  const activity = { activeCalls };
  let beforeInstall = 0;
  const updater = createAppUpdater({
    app: {
      isPackaged: packaged,
      getVersion: () => currentVersion,
      getPath: () => temp
    },
    autoUpdater: fake,
    platform: 'win32',
    env,
    now: () => Date.parse('2026-07-25T00:00:00.000Z'),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
    getTaskActivity: () => ({ activeCalls: activity.activeCalls }),
    onStatusChange: status => statuses.push(status),
    onBeforeInstall: () => { beforeInstall += 1; },
    onLog: (message, options) => logs.push({ message, options }),
    errorCodes: {
      UPDATE_FAILED: 'update_failed',
      UPDATE_NOT_SUPPORTED: 'update_not_supported',
      UPDATE_BUSY: 'update_busy',
      UPDATE_INSTALL_BLOCKED: 'update_install_blocked'
    }
  });
  return { updater, fake, statuses, logs, timers, activity, beforeInstall: () => beforeInstall };
}

const supportApp = {
  isPackaged: true,
  getVersion: () => '0.20.7',
  getPath: () => os.tmpdir()
};
assert.deepEqual(detectUpdateSupport({ app: { ...supportApp, isPackaged: false }, platform: 'win32', env: {} }), {
  supported: false,
  reason: 'Updates are available only in an installed Rel.AI MCP build.'
});
assert.match(detectUpdateSupport({ app: supportApp, platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'C:\\Portable' } }).reason, /Portable builds/);
assert.equal(detectUpdateSupport({ app: supportApp, platform: 'win32', env: {} }).supported, true);
assert.deepEqual(progressPayload({ percent: 44.44, transferred: -2, total: 100.8, bytesPerSecond: 20.2 }), {
  percent: 44.4,
  transferred: 0,
  total: 101,
  bytesPerSecond: 20
});
assert.deepEqual(parseStableVersion('1.2.3'), [1, 2, 3]);
for (const value of ['1.2', 'v1.2.3', '1.2.3-beta.1', '']) assert.equal(parseStableVersion(value), null, value);
assert.equal(isStableVersion('10.20.30'), true);
assert.equal(isStableVersion('10.20.30-rc.1'), false);
assert.equal(compareVersions('1.2.3', '1.2.2'), 1);
assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
assert.equal(compareVersions('1.2.3', '2.0.0'), -1);
assert.equal(Number.isNaN(compareVersions('bad', '1.0.0')), true);
assert.equal(AUTO_CHECK_INTERVAL_MS, 86400000);
assert.equal(AUTO_CHECK_DELAY_MS, 15000);
assert.equal(normalizeStatus({ supported: true, state: 'downloaded', integrityVerified: false }).canInstall, false);
assert.equal(normalizeStatus({ supported: true, state: 'downloaded', integrityVerified: true }).canInstall, true);

const valid = createHarness();
assert.equal(valid.updater.start().state, 'idle');
assert.equal(valid.fake.autoDownload, false);
assert.equal(valid.fake.autoInstallOnAppQuit, false);
assert.equal(valid.fake.allowPrerelease, false);
assert.equal(valid.timers[0].delay, AUTO_CHECK_DELAY_MS);

const checkPromise = valid.updater.checkForUpdates();
assert.equal(valid.updater.getStatus().state, 'checking');
assert.equal(valid.updater.getStatus().integrityVerified, false);
await checkPromise;
assert.equal(valid.fake.checkCalls, 1);
assert.equal(valid.timers.at(-1).delay, AUTO_CHECK_INTERVAL_MS);

valid.fake.emit('update-available', { version: '0.21.0', releaseDate: '2026-07-26T00:00:00.000Z' });
assert.equal(valid.updater.getStatus().state, 'available');
assert.equal(valid.updater.getStatus().availableVersion, '0.21.0');
assert.equal(valid.updater.getStatus().canDownload, true);
assert.equal(valid.updater.getStatus().integrityVerified, false);

const downloadPromise = valid.updater.downloadUpdate();
assert.equal(valid.updater.getStatus().state, 'downloading');
await downloadPromise;
assert.equal(valid.fake.downloadCalls, 1);
valid.fake.emit('download-progress', { percent: 52.5, transferred: 525, total: 1000, bytesPerSecond: 100 });
assert.equal(valid.updater.getStatus().progress.percent, 52.5);
valid.fake.emit('update-downloaded', { version: '0.21.0' });
assert.equal(valid.updater.getStatus().state, 'downloaded');
assert.equal(valid.updater.getStatus().integrityVerified, true);
assert.equal(valid.updater.getStatus().canInstall, true);

valid.activity.activeCalls = 2;
const blocked = valid.updater.installUpdate();
assert.equal(blocked.ok, false);
assert.equal(blocked.errorCode, 'update_install_blocked');
assert.match(blocked.error, /2 active Rel\.AI tool calls/);
assert.equal(valid.updater.getStatus().state, 'downloaded');

valid.activity.activeCalls = 0;
const install = valid.updater.installUpdate();
assert.equal(install.ok, true);
assert.equal(valid.updater.getStatus().state, 'installing');
assert.equal(valid.beforeInstall(), 1);
valid.timers.at(-1).callback();
assert.deepEqual(valid.fake.installCalls, [{ silent: false, forceRunAfter: true }]);
assert.ok(valid.logs.some(entry => entry.options.source === 'updater'));
assert.ok(valid.statuses.some(status => status.state === 'downloaded' && status.integrityVerified === true));

for (const candidate of ['bad-version', 'v0.21.0', '0.21.0-beta.1', '0.20.7', '0.19.9']) {
  const harness = createHarness();
  harness.updater.start();
  harness.fake.emit('update-available', { version: candidate });
  assert.equal(harness.updater.getStatus().state, 'error', candidate);
  assert.equal(harness.updater.getStatus().canDownload, false, candidate);
  assert.equal(harness.updater.getStatus().integrityVerified, false, candidate);
}

const invalidInstalled = createHarness({ currentVersion: 'development' });
invalidInstalled.updater.start();
invalidInstalled.fake.emit('update-available', { version: '1.0.0' });
assert.equal(invalidInstalled.updater.getStatus().state, 'error');
assert.match(invalidInstalled.updater.getStatus().error, /installed application version is invalid/i);

const mismatch = createHarness();
mismatch.updater.start();
mismatch.fake.emit('update-available', { version: '0.21.0' });
mismatch.fake.emit('update-downloaded', { version: '0.21.1' });
assert.equal(mismatch.updater.getStatus().state, 'error');
assert.equal(mismatch.updater.getStatus().integrityVerified, false);
assert.equal(mismatch.updater.getStatus().canInstall, false);
assert.match(mismatch.updater.getStatus().error, /does not match expected version/);
assert.equal(mismatch.updater.installUpdate().ok, false);
assert.match(mismatch.updater.installUpdate().error, /Download and verify/);

const unsupported = createHarness({ packaged: false });
assert.equal(unsupported.updater.start().state, 'unsupported');
assert.equal((await unsupported.updater.checkForUpdates()).errorCode, 'update_not_supported');

for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
console.log('App updater unit tests passed.');
