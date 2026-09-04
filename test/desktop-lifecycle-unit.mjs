import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createDesktopLifecycleManager, detectStartupSupport } from "../electron/desktop-lifecycle.js";

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-lifecycle-'));
let loginEnabled = false;
let loginSettings = null;
let loginReadSettings = null;
let clock = 0;
const logs = [];
const app = {
  isPackaged: true,
  getVersion: () => '0.21.0',
  getPath: () => stateDir,
  getLoginItemSettings: settings => {
    loginReadSettings = settings ? { ...settings, args: [...(settings.args || [])] } : settings;
    return { openAtLogin: loginEnabled };
  },
  setLoginItemSettings: settings => {
    loginSettings = { ...settings };
    loginEnabled = settings.openAtLogin === true;
  }
};
const now = () => new Date(Date.parse('2026-07-25T06:00:00.000Z') + (clock++ * 1000)).toISOString();

assert.equal(detectStartupSupport({ app, platform: 'win32', env: {} }).supported, true);
assert.match(detectStartupSupport({ app: { ...app, isPackaged: false }, platform: 'win32', env: {} }).reason, /installed Windows app/);
assert.match(detectStartupSupport({ app, platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'C:\\RelAI' } }).reason, /Portable builds/);

const first = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, connectorRevision: 'surface-a', onLog: (message, options) => logs.push({ message, options }) });
const firstStatus = await first.start();
assert.equal(firstStatus.firstLaunch, true);
assert.equal(firstStatus.updated, false);
assert.equal(firstStatus.connectorRefreshRequired, false);
assert.equal(firstStatus.connectorRevision, 'surface-a');
assert.equal(firstStatus.recoveredAfterUncleanShutdown, false);
assert.equal(firstStatus.launchCount, 1);
assert.equal(firstStatus.launchAtLogin.supported, true);
assert.equal(firstStatus.launchAtLogin.enabled, false);
assert.equal(firstStatus.keepAwake, false);
assert.equal(firstStatus.keepRunningOnClose, true, 'closing the dashboard must keep tray mode by default');
assert.equal(firstStatus.autoDownloadUpdates, false, 'updates must keep manual download as the safe default');
assert.equal(firstStatus.reducedBackgroundWork, false, 'normal background preparation must remain the default');
assert.equal(first.setLaunchAtLogin(true).ok, true);
assert.equal(first.getStatus().launchAtLogin.enabled, true);
assert.deepEqual(loginReadSettings, { path: process.execPath, args: ['--background'] }, 'login-item readback must identify the same executable and background args used during registration');
assert.deepEqual(loginSettings, {
  openAtLogin: true,
  openAsHidden: true,
  path: process.execPath,
  args: ['--background']
});
assert.equal((await first.setKeepAwake(true)).status.keepAwake, true);
const preferenceUpdate = await first.setPreferences({
  keepRunningOnClose: false,
  autoDownloadUpdates: true,
  reducedBackgroundWork: true
});
assert.equal(preferenceUpdate.ok, true);
assert.equal(preferenceUpdate.status.keepRunningOnClose, false);
assert.equal(preferenceUpdate.status.autoDownloadUpdates, true);
assert.equal(preferenceUpdate.status.reducedBackgroundWork, true);
assert.equal((await first.setPreferences({ autoDownloadUpdates: 'yes' })).ok, false, 'app preferences must reject non-boolean values');
const cleanStatus = await first.markCleanShutdown();
assert.equal((await first.markCleanShutdown()).lastCleanExitAt, cleanStatus.lastCleanExitAt);

const second = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, connectorRevision: 'surface-a', onLog: (message, options) => logs.push({ message, options }) });
const secondStatus = await second.start();
assert.equal(secondStatus.firstLaunch, false);
assert.equal(secondStatus.updated, false);
assert.equal(secondStatus.connectorRefreshRequired, false);
assert.equal(secondStatus.recoveredAfterUncleanShutdown, false);
assert.equal(secondStatus.launchCount, 2);
assert.equal(secondStatus.keepAwake, true, 'keep-awake preference must persist across desktop restarts');
assert.equal(secondStatus.keepRunningOnClose, false, 'close behavior must persist across desktop restarts');
assert.equal(secondStatus.autoDownloadUpdates, true, 'automatic download preference must persist across desktop restarts');
assert.equal(secondStatus.reducedBackgroundWork, true, 'reduced background work must persist across desktop restarts');
assert.equal((await second.setKeepAwake(false)).status.keepAwake, false);
await second.markCleanShutdown();

const statePath = path.join(stateDir, 'desktop-lifecycle.json');
const previousState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const { connectorRevision: _legacyConnectorRevision, ...legacyState } = previousState;
fs.writeFileSync(statePath, `${JSON.stringify({ ...legacyState, version: '0.20.7', running: false }, null, 2)}\n`);
const updated = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, connectorRevision: 'surface-b', onLog: (message, options) => logs.push({ message, options }) });
const updatedStatus = await updated.start();
assert.equal(updatedStatus.updated, true);
assert.equal(updatedStatus.previousVersion, '0.20.7');
assert.equal(updatedStatus.connectorRefreshRequired, true, 'the first upgrade from lifecycle state without a connector revision must request a refresh');
await updated.markCleanShutdown();

const changedSurface = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, connectorRevision: 'surface-c', onLog: (message, options) => logs.push({ message, options }) });
const changedSurfaceStatus = await changedSurface.start();
assert.equal(changedSurfaceStatus.updated, false);
assert.equal(changedSurfaceStatus.connectorRefreshRequired, true, 'a changed connector revision must request refresh even without an app-version change');
await changedSurface.markCleanShutdown();

const interruptedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
fs.writeFileSync(statePath, `${JSON.stringify({ ...interruptedState, running: true }, null, 2)}\n`);
const recovered = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, connectorRevision: 'surface-c', onLog: (message, options) => logs.push({ message, options }) });
assert.equal((await recovered.start()).recoveredAfterUncleanShutdown, true);
assert.equal(recovered.getStatus().connectorRefreshRequired, false, 'restarting the same connector revision must not request another refresh');
assert.ok(logs.some(entry => entry.options.code === 'unclean_shutdown_detected'));

const background = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, argv: ['RelAI.exe', '--background'], now, connectorRevision: 'surface-b' });
assert.equal((await background.start()).openedAtLogin, true);
await background.markCleanShutdown();

const portable = createDesktopLifecycleManager({ app, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'RelAI.exe' }, now, connectorRevision: 'surface-b' });
assert.equal((await portable.start()).launchAtLogin.supported, false);
assert.equal(portable.setLaunchAtLogin(true).errorCode, 'startup_setting_not_supported');

await recovered.markCleanShutdown();
fs.rmSync(stateDir, { recursive: true, force: true });
console.log('Desktop lifecycle unit tests passed.');
