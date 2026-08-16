import assert from 'node:assert/strict';

import { localWindowWebPreferences, secureLocalWindow, isAllowedLocalTarget } from "../electron/window-security.js";

const allowedUrl = 'relai-app://renderer/wizard.html?recovery=1';
const preferences = localWindowWebPreferences('preload.cjs', 'relai-test', 'dashboard');assert.deepEqual(preferences, {
  preload: 'preload.cjs',
  additionalArguments: ['--relai-preload-surface=dashboard'],
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  partition: 'relai-test'
});

const webHandlers = new Map();
const sessionHandlers = new Map();
let downloadListenerRegistrations = 0;
let permissionRequest = null;
let permissionCheck = null;
let openHandler = null;
const errors = [];
const sharedSession = {
  setPermissionRequestHandler: handler => { permissionRequest = handler; },
  setPermissionCheckHandler: handler => { permissionCheck = handler; },
  on: (name, handler) => {
    if (name === 'will-download') downloadListenerRegistrations += 1;
    sessionHandlers.set(name, handler);
  }
};
const window = {
  webContents: {
    session: sharedSession,
    on: (name, handler) => webHandlers.set(name, handler),
    setWindowOpenHandler: handler => { openHandler = handler; }
  }
};

assert.equal(secureLocalWindow(window, { allowedUrl, onError: error => errors.push(error.message) }), window);
const recreatedWindow = {
  webContents: {
    session: sharedSession,
    on() {},
    setWindowOpenHandler() {}
  }
};
secureLocalWindow(recreatedWindow, { allowedUrl });
assert.equal(downloadListenerRegistrations, 1, 'recreating a window on the same Electron session must not accumulate will-download listeners');
let permissionGranted = true;
permissionRequest(null, 'camera', granted => { permissionGranted = granted; });
assert.equal(permissionGranted, false);
assert.equal(permissionCheck(), false);

for (const [name, handlers] of [['will-download', sessionHandlers], ['will-attach-webview', webHandlers]]) {
  let prevented = false;
  handlers.get(name)({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, `${name} must be blocked`);
}

assert.equal(isAllowedLocalTarget(`${allowedUrl}#step2`, allowedUrl), true);
let prevented = false;
webHandlers.get('will-navigate')({ preventDefault: () => { prevented = true; } }, `${allowedUrl}#step2`);
assert.equal(prevented, false);

for (const target of ['https://example.com/', 'relai-app://renderer/status.html', 'file:///tmp/wizard.html']) {
  prevented = false;
  webHandlers.get('will-redirect')({ preventDefault: () => { prevented = true; } }, target);
  assert.equal(prevented, true);
}
assert.equal(errors.length, 3);
assert.deepEqual(openHandler({ url: 'https://example.com/' }), { action: 'deny' });
assert.throws(() => secureLocalWindow(null, { allowedUrl }), /BrowserWindow/);

console.log('Window security unit tests passed.');
