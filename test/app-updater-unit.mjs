import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, compareVersions, createAppUpdater, detectUpdateSupport, isStableVersion, normalizeStatus, parseStableVersion, progressPayload } from "../electron/app-updater.js";

class FakeUpdater extends EventEmitter {
  constructor({ checkFailures = [], downloadFailures = [] } = {}) {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = [];
    this.checkFailures = [...checkFailures];
    this.downloadFailures = [...downloadFailures];
  }
  async checkForUpdates() {
    this.checkCalls += 1;
    const error = this.checkFailures.shift();
    if (error) { this.emit('error', error); throw error; }
  }
  async downloadUpdate() {
    this.downloadCalls += 1;
    const error = this.downloadFailures.shift();
    if (error) { this.emit('error', error); throw error; }
  }
  quitAndInstall(silent, forceRunAfter) { this.installCalls.push({ silent, forceRunAfter }); }
}

const roots = [];

async function waitFor(condition, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function createHarness({ currentVersion = '0.20.7', packaged = true, env = {}, activeCalls = 0, activeTaskCount = 0, taskState = 'idle', tasks = [], checkFailures = [], downloadFailures = [], currentCompatibility = null } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-updater-'));
  roots.push(temp);
  const fake = new FakeUpdater({ checkFailures, downloadFailures });
  const statuses = [];
  const logs = [];
  const timers = [];
  const activity = { activeCalls, activeTaskCount, state: taskState, tasks };
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
    getTaskActivity: () => ({ ...activity, tasks: [...activity.tasks] }),
    onStatusChange: status => statuses.push(status),
    onBeforeInstall: () => { beforeInstall += 1; },
    retryDelay: async () => {},
    onLog: (message, options) => logs.push({ message, options }),
    currentCompatibility: currentCompatibility || {
      applicationVersion: currentVersion,
      schemaVersion: 3,
      manifestHash: 'hash-current',
      deviceProtocolVersion: 1,
      minimumCompatibleDeviceProtocol: 1
    },
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
assert.equal(detectUpdateSupport({ app: supportApp, platform: 'linux', env: { APPIMAGE: '/opt/Rel.AI-MCP.AppImage' } }).supported, true);
const debResources = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-updater-deb-'));
roots.push(debResources);
fs.writeFileSync(path.join(debResources, 'package-type'), 'deb\n');
assert.equal(detectUpdateSupport({ app: supportApp, platform: 'linux', env: {}, resourcesPath: debResources }).supported, true,
  'installed DEB builds must use electron-updater instead of sending users to App Center');
assert.match(detectUpdateSupport({ app: supportApp, platform: 'linux', env: {}, resourcesPath: os.tmpdir() }).reason, /installed Linux AppImage and DEB builds/);
assert.match(detectUpdateSupport({ app: supportApp, platform: 'darwin', env: {} }).reason, /not available/);
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
assert.ok(Number.isSafeInteger(AUTO_CHECK_DELAY_MS) && AUTO_CHECK_DELAY_MS >= 0, 'automatic update delay must remain bounded');
assert.ok(Number.isSafeInteger(AUTO_CHECK_INTERVAL_MS) && AUTO_CHECK_INTERVAL_MS > AUTO_CHECK_DELAY_MS, 'automatic update interval must remain longer than the initial delay');
assert.equal(normalizeStatus({ supported: true, state: 'downloaded', integrityVerified: false }).canInstall, false);
assert.equal(normalizeStatus({ supported: true, state: 'downloaded', integrityVerified: true }).canInstall, true);

const valid = createHarness();
assert.equal(valid.updater.start().state, 'idle');
assert.equal(valid.fake.autoDownload, false);
assert.equal(valid.fake.autoInstallOnAppQuit, false);
assert.equal(valid.fake.allowPrerelease, false);
await waitFor(
  () => valid.timers.some(timer => timer.delay === AUTO_CHECK_DELAY_MS),
  'starting the updater must eventually schedule its automatic update check'
);

const checkPromise = valid.updater.checkForUpdates();
assert.equal(valid.updater.getStatus().state, 'checking');
assert.equal(valid.updater.getStatus().integrityVerified, false);
await checkPromise;
assert.equal(valid.fake.checkCalls, 1);
await waitFor(
  () => valid.timers.some(timer => timer.delay === AUTO_CHECK_INTERVAL_MS),
  'a completed update check must eventually schedule the next automatic check'
);

const transientNetworkError = () => Object.assign(new Error('net::ERR_HTTP2_SERVER_REFUSED_STREAM'), { code: 'ERR_HTTP2_SERVER_REFUSED_STREAM' });
const transientCheck = createHarness({ checkFailures: [transientNetworkError()] });
transientCheck.updater.start();
const transientCheckResult = await transientCheck.updater.checkForUpdates();
assert.equal(transientCheckResult.ok, true, 'transient HTTP/2 stream refusals should recover inside one update action');
assert.ok(transientCheck.fake.checkCalls > 1, 'transient updater failures should retry at least once');
assert.equal(transientCheck.logs.some(entry => entry.options.code === 'update_failed'), false, 'retrying a transient updater failure must not emit update_failed');
assert.ok(transientCheck.logs.some(entry => entry.options.code === 'update_retry'), 'transient updater retries should remain diagnosable');

const exhaustedFailures = Array.from({ length: 20 }, () => transientNetworkError());
const exhaustedCheck = createHarness({ checkFailures: exhaustedFailures });
exhaustedCheck.updater.start();
const exhaustedCheckResult = await exhaustedCheck.updater.checkForUpdates();
assert.equal(exhaustedCheckResult.ok, false);
assert.ok(exhaustedCheck.fake.checkCalls > 1, 'transient updater failures should retry before giving up');
assert.ok(exhaustedCheck.fake.checkCalls < exhaustedFailures.length, 'transient updater retries must remain bounded');
assert.equal(exhaustedCheck.logs.filter(entry => entry.options.code === 'update_failed').length, 1, 'exhausted retries should emit one terminal update failure');
assert.equal(exhaustedCheck.updater.getStatus().state, 'error');
assert.match(exhaustedCheck.updater.getStatus().error, /could not reach the update service/i, 'network internals must be converted to recovery guidance');

const nonTransientCheck = createHarness({ checkFailures: [Object.assign(new Error('certificate rejected'), { code: 'ERR_CERT_AUTHORITY_INVALID' })] });
nonTransientCheck.updater.start();
const nonTransientResult = await nonTransientCheck.updater.checkForUpdates();
assert.equal(nonTransientResult.ok, false);
assert.equal(nonTransientCheck.fake.checkCalls, 1, 'non-transient updater failures must fail without retrying');
assert.equal(nonTransientCheck.logs.filter(entry => entry.options.code === 'update_failed').length, 1, 'an emitted and rejected updater error must have one owner');
assert.ok(nonTransientCheck.logs.some(entry => entry.message === 'certificate rejected'), 'technical updater detail must remain in diagnostics');
assert.doesNotMatch(nonTransientResult.error, /certificate rejected/i, 'ordinary UI must not expose raw updater internals');
assert.match(nonTransientResult.error, /Troubleshooting/i);

valid.fake.emit('update-available', {
  version: '0.21.0',
  releaseDate: '2026-07-26T00:00:00.000Z',
  releaseNotes: '### Improvements\n- Faster updater\n- Clearer release notes',
  relai: { schemaVersion: 3, manifestHash: 'hash-current', deviceProtocolVersion: 1, minimumCompatibleDeviceProtocol: 1 }
});
assert.equal(valid.updater.getStatus().state, 'available');
assert.equal(valid.updater.getStatus().availableVersion, '0.21.0');
assert.equal(valid.updater.getStatus().canDownload, true);
assert.deepEqual(valid.updater.getStatus().updateSynchronization, { status: 'current', toolRefreshRequired: false, deviceUpdateRequired: false });
assert.equal(valid.updater.getStatus().availableCompatibility.schemaVersion, 3);
assert.deepEqual(valid.updater.getStatus().releaseNotes, [{
  version: '0.21.0',
  note: '### Improvements\n- Faster updater\n- Clearer release notes'
}]);

const downloadPromise = valid.updater.downloadUpdate();
assert.equal(valid.updater.getStatus().state, 'downloading');
await downloadPromise;
assert.equal(valid.fake.downloadCalls, 1);
valid.fake.emit('download-progress', { percent: 52.5, transferred: 525, total: 1000, bytesPerSecond: 100 });
assert.equal(valid.updater.getStatus().progress.percent, 52.5);
valid.fake.emit('update-downloaded', { version: '0.21.0' });
assert.equal(valid.updater.getStatus().state, 'downloaded');

const transientDownload = createHarness({ downloadFailures: [transientNetworkError()] });
transientDownload.updater.start();
transientDownload.fake.emit('update-available', { version: '0.21.0' });
const transientDownloadResult = await transientDownload.updater.downloadUpdate();
assert.equal(transientDownloadResult.ok, true, 'transient download transport failures should retry without user intervention');
assert.equal(transientDownload.fake.downloadCalls, 2);
assert.equal(transientDownload.logs.some(entry => entry.options.code === 'update_failed'), false);
assert.equal(valid.updater.getStatus().integrityVerified, true);
assert.equal(valid.updater.getStatus().canInstall, true);

valid.activity.activeCalls = 2;
valid.activity.activeTaskCount = 2;
valid.activity.state = 'working';
const blocked = valid.updater.installUpdate();
assert.equal(blocked.ok, false);
assert.equal(blocked.errorCode, 'update_install_blocked');
assert.match(blocked.error, /2 active Rel\.AI tasks/);
assert.equal(valid.updater.getStatus().state, 'downloaded');

valid.activity.activeCalls = 0;
valid.activity.activeTaskCount = 1;
valid.activity.state = 'waiting';
valid.activity.tasks = [{ taskId: 'waiting-task', status: 'waiting', activeCalls: 0 }];
const waitingBlocked = valid.updater.installUpdate();
assert.equal(waitingBlocked.ok, false, 'an open task must block restart even between connector calls');
assert.match(waitingBlocked.error, /active Rel\.AI task/);
assert.equal(valid.updater.getStatus().state, 'downloaded');

valid.activity.activeTaskCount = 0;
valid.activity.state = 'idle';
valid.activity.tasks = [];
const install = valid.updater.installUpdate();
assert.equal(install.ok, true);
assert.equal(valid.updater.getStatus().state, 'installing');
assert.equal(valid.beforeInstall(), 1);
valid.timers.at(-1).callback();
await Promise.resolve();
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

const schemaChange = createHarness();
schemaChange.updater.start();
schemaChange.fake.emit('update-available', {
  version: '0.21.0',
  relai: { schemaVersion: 4, manifestHash: 'hash-next', deviceProtocolVersion: 1, minimumCompatibleDeviceProtocol: 1 }
});
assert.deepEqual(schemaChange.updater.getStatus().updateSynchronization, { status: 'tool_refresh_required', toolRefreshRequired: true, deviceUpdateRequired: false });

const deviceChange = createHarness();
deviceChange.updater.start();
deviceChange.fake.emit('update-available', {
  version: '0.21.0',
  relai: { schemaVersion: 3, manifestHash: 'hash-current', deviceProtocolVersion: 2, minimumCompatibleDeviceProtocol: 2 }
});
assert.deepEqual(deviceChange.updater.getStatus().updateSynchronization, { status: 'device_update_required', toolRefreshRequired: false, deviceUpdateRequired: true });

const metadataUnknown = createHarness();
metadataUnknown.updater.start();
metadataUnknown.fake.emit('update-available', { version: '0.21.0' });
assert.equal(metadataUnknown.updater.getStatus().updateSynchronization, null, 'missing compatibility metadata must not invent a refresh warning');
assert.equal(metadataUnknown.updater.getStatus().availableCompatibility, null);

const multiReleaseNotes = normalizeStatus({
  supported: true,
  state: 'available',
  availableVersion: '0.21.0',
  releaseNotes: [
    { version: '0.21.0', note: 'Latest notes' },
    { version: '0.20.9', note: 'Previous notes' }
  ]
});
assert.deepEqual(multiReleaseNotes.releaseNotes, [
  { version: '0.21.0', note: 'Latest notes' },
  { version: '0.20.9', note: 'Previous notes' }
]);

const invalidInstalled = createHarness({ currentVersion: 'development' });
invalidInstalled.updater.start();
invalidInstalled.fake.emit('update-available', { version: '1.0.0' });
assert.equal(invalidInstalled.updater.getStatus().state, 'error');
assert.match(invalidInstalled.updater.getStatus().error, /could not verify this update/i);
assert.ok(invalidInstalled.logs.some(entry => /installed application version is invalid/i.test(entry.message)), 'invalid-version detail must remain in diagnostics');

const mismatch = createHarness();
mismatch.updater.start();
mismatch.fake.emit('update-available', { version: '0.21.0' });
mismatch.fake.emit('update-downloaded', { version: '0.21.1' });
assert.equal(mismatch.updater.getStatus().state, 'error');
assert.equal(mismatch.updater.getStatus().integrityVerified, false);
assert.equal(mismatch.updater.getStatus().canInstall, false);
assert.match(mismatch.updater.getStatus().error, /could not verify this update/i);
assert.ok(mismatch.logs.some(entry => /does not match expected version/i.test(entry.message)), 'download mismatch detail must remain in diagnostics');
assert.equal(mismatch.updater.installUpdate().ok, false);
assert.match(mismatch.updater.installUpdate().error, /Download and verify/);

const unsupported = createHarness({ packaged: false });
assert.equal(unsupported.updater.start().state, 'unsupported');
assert.equal((await unsupported.updater.checkForUpdates()).errorCode, 'update_not_supported');

for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
console.log('App updater unit tests passed.');
