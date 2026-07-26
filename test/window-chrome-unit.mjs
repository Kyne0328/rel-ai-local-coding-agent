import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dashboardWindowChrome, dashboardWindowChromeState } = require('../electron/window-chrome.js');

const windows = dashboardWindowChrome('win32');
assert.equal(windows.platform, 'win32');
assert.equal(windows.customTitleBar, true);
assert.equal(windows.controls, 'custom');
assert.equal(windows.windowOptions.frame, false);
assert.equal(windows.windowOptions.thickFrame, true);
assert.equal(windows.windowOptions.titleBarStyle, 'hidden');
assert.equal(windows.windowOptions.hasShadow, true);
assert.equal(windows.windowOptions.roundedCorners, true);

const macos = dashboardWindowChrome('darwin');
assert.equal(macos.platform, 'darwin');
assert.equal(macos.customTitleBar, true);
assert.equal(macos.controls, 'native');
assert.equal(macos.windowOptions.titleBarStyle, 'hiddenInset');
assert.deepEqual(macos.windowOptions.trafficLightPosition, { x: 14, y: 13 });
assert.equal(Object.hasOwn(macos.windowOptions, 'frame'), false);

const linux = dashboardWindowChrome('linux');
assert.equal(linux.platform, 'linux');
assert.equal(linux.customTitleBar, false);
assert.equal(linux.controls, 'native');
assert.deepEqual(linux.windowOptions, {});

const state = dashboardWindowChromeState({
  isMaximized: () => true,
  isMinimized: () => false,
  isFullScreen: () => true
}, 'win32');
assert.deepEqual(state, {
  platform: 'win32',
  customTitleBar: true,
  controls: 'custom',
  maximized: true,
  minimized: false,
  fullScreen: true
});

assert.deepEqual(dashboardWindowChromeState(null, 'linux'), {
  platform: 'linux',
  customTitleBar: false,
  controls: 'native',
  maximized: false,
  minimized: false,
  fullScreen: false
});

console.log('Window chrome platform policy tests passed.');
