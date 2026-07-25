import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { localWindowWebPreferences, secureLocalWindow, isAllowedLocalTarget } = require('../electron/window-security.js');

const allowedFile = path.resolve('electron/renderer/wizard.html');
const preferences = localWindowWebPreferences('preload.js', 'relai-test');
assert.deepEqual(preferences, {
  preload: 'preload.js',
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
let permissionRequest = null;
let permissionCheck = null;
let openHandler = null;
const errors = [];
const window = {
  webContents: {
    session: {
      setPermissionRequestHandler: handler => { permissionRequest = handler; },
      setPermissionCheckHandler: handler => { permissionCheck = handler; },
      on: (name, handler) => sessionHandlers.set(name, handler)
    },
    on: (name, handler) => webHandlers.set(name, handler),
    setWindowOpenHandler: handler => { openHandler = handler; }
  }
};

assert.equal(secureLocalWindow(window, { allowedFile, onError: error => errors.push(error.message) }), window);
let permissionGranted = true;
permissionRequest(null, 'camera', granted => { permissionGranted = granted; });
assert.equal(permissionGranted, false);
assert.equal(permissionCheck(), false);

for (const [name, handlers] of [['will-download', sessionHandlers], ['will-attach-webview', webHandlers]]) {
  let prevented = false;
  handlers.get(name)({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, `${name} must be blocked`);
}

const allowedUrl = `${pathToFileURL(allowedFile).href}?recovery=1#step2`;
assert.equal(isAllowedLocalTarget(allowedUrl, allowedFile), true);
let prevented = false;
webHandlers.get('will-navigate')({ preventDefault: () => { prevented = true; } }, allowedUrl);
assert.equal(prevented, false);

for (const target of ['https://example.com/', pathToFileURL(path.resolve('electron/renderer/status.html')).href]) {
  prevented = false;
  webHandlers.get('will-redirect')({ preventDefault: () => { prevented = true; } }, target);
  assert.equal(prevented, true);
}
assert.equal(errors.length, 2);
assert.deepEqual(openHandler({ url: 'https://example.com/' }), { action: 'deny' });
assert.throws(() => secureLocalWindow(null, { allowedFile }), /BrowserWindow/);

console.log('Window security unit tests passed.');
