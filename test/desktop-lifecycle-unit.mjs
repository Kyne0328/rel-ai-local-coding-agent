import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopLifecycleManager, detectStartupSupport } = require('../electron/desktop-lifecycle.js');

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-lifecycle-'));
let loginEnabled = false;
let loginSettings = null;
let clock = 0;
const logs = [];
const app = {
  isPackaged: true,
  getVersion: () => '0.21.0',
  getPath: () => stateDir,
  getLoginItemSettings: () => ({ openAtLogin: loginEnabled }),
  setLoginItemSettings: settings => {
    loginSettings = { ...settings };
    loginEnabled = settings.openAtLogin === true;
  }
};
const now = () => new Date(Date.parse('2026-07-25T06:00:00.000Z') + (clock++ * 1000)).toISOString();

assert.equal(detectStartupSupport({ app, platform: 'win32', env: {} }).supported, true);
assert.match(detectStartupSupport({ app: { ...app, isPackaged: false }, platform: 'win32', env: {} }).reason, /installed Windows app/);
assert.match(detectStartupSupport({ app, platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'C:\\RelAI' } }).reason, /Portable builds/);

const first = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, onLog: (message, options) => logs.push({ message, options }) });
const firstStatus = first.start();
assert.equal(firstStatus.firstLaunch, true);
assert.equal(firstStatus.updated, false);
assert.equal(firstStatus.recoveredAfterUncleanShutdown, false);
assert.equal(firstStatus.launchCount, 1);
assert.equal(firstStatus.launchAtLogin.supported, true);
assert.equal(firstStatus.launchAtLogin.enabled, false);
assert.equal(first.setLaunchAtLogin(true).ok, true);
assert.equal(first.getStatus().launchAtLogin.enabled, true);
assert.deepEqual(loginSettings, {
  openAtLogin: true,
  openAsHidden: true,
  path: process.execPath,
  args: ['--background']
});
const cleanStatus = first.markCleanShutdown();
assert.equal(first.markCleanShutdown().lastCleanExitAt, cleanStatus.lastCleanExitAt);

const second = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, onLog: (message, options) => logs.push({ message, options }) });
const secondStatus = second.start();
assert.equal(secondStatus.firstLaunch, false);
assert.equal(secondStatus.updated, false);
assert.equal(secondStatus.recoveredAfterUncleanShutdown, false);
assert.equal(secondStatus.launchCount, 2);
second.markCleanShutdown();

const statePath = path.join(stateDir, 'desktop-lifecycle.json');
const previousState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
fs.writeFileSync(statePath, `${JSON.stringify({ ...previousState, version: '0.20.7', running: false }, null, 2)}\n`);
const updated = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, onLog: (message, options) => logs.push({ message, options }) });
const updatedStatus = updated.start();
assert.equal(updatedStatus.updated, true);
assert.equal(updatedStatus.previousVersion, '0.20.7');
updated.markCleanShutdown();

const interruptedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
fs.writeFileSync(statePath, `${JSON.stringify({ ...interruptedState, running: true }, null, 2)}\n`);
const recovered = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, now, onLog: (message, options) => logs.push({ message, options }) });
assert.equal(recovered.start().recoveredAfterUncleanShutdown, true);
assert.ok(logs.some(entry => entry.options.code === 'unclean_shutdown_detected'));

const background = createDesktopLifecycleManager({ app, platform: 'win32', env: {}, argv: ['RelAI.exe', '--background'], now });
assert.equal(background.start().openedAtLogin, true);
background.markCleanShutdown();

const portable = createDesktopLifecycleManager({ app, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'RelAI.exe' }, now });
assert.equal(portable.start().launchAtLogin.supported, false);
assert.equal(portable.setLaunchAtLogin(true).errorCode, 'startup_setting_not_supported');

recovered.markCleanShutdown();
fs.rmSync(stateDir, { recursive: true, force: true });
console.log('Desktop lifecycle unit tests passed.');
