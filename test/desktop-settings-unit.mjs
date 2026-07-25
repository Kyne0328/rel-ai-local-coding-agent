import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopSettingsManager } = require('../electron/desktop-settings.js');

let config = {
  port: 3333,
  token: 'preserved-token',
  ngrokDomain: 'example.ngrok-free.dev',
  ngrokAuthtoken: 'account-key'
};
let notificationsEnabled = true;
const saved = [];
let restarts = 0;
const manager = createDesktopSettingsManager({
  readGuiConfig: () => ({ ...config }),
  saveLauncherConfig: value => {
    saved.push({ ...value });
    config = { ...value };
  },
  getApprovalRequired: () => true,
  getNotificationsEnabled: () => notificationsEnabled,
  setNotificationsEnabled: value => { notificationsEnabled = value; },
  restartDesktop: async () => {
    restarts += 1;
    return { serverRunning: true };
  }
});

assert.deepEqual(manager.get(), {
  ok: true,
  port: 3333,
  approvalToken: 'preserved-token',
  ngrokDomain: 'example.ngrok-free.dev',
  ngrokAuthtoken: '',
  ngrokAuthtokenConfigured: true,
  approvalRequired: true,
  notificationsEnabled: true
});

const preserveResult = await manager.save({
  port: 4444,
  approvalToken: 'must-not-be-used',
  ngrokDomain: 'updated.ngrok-free.dev',
  ngrokAuthtoken: '',
  notificationsEnabled: false
});
assert.equal(preserveResult.ok, true);
assert.deepEqual(saved.at(-1), {
  port: 4444,
  token: 'preserved-token',
  ngrokDomain: 'updated.ngrok-free.dev',
  ngrokAuthtoken: 'account-key'
});
assert.equal(notificationsEnabled, false);

await manager.save({
  port: 4555,
  ngrokDomain: 'replacement.ngrok-free.dev',
  ngrokAuthtoken: 'new-account-key'
});
assert.deepEqual(saved.at(-1), {
  port: 4555,
  token: 'preserved-token',
  ngrokDomain: 'replacement.ngrok-free.dev',
  ngrokAuthtoken: 'new-account-key'
});
assert.equal(restarts, 2);
assert.equal(manager.get().ngrokAuthtoken, '');
assert.equal(manager.get().ngrokAuthtokenConfigured, true);

const failed = createDesktopSettingsManager({
  readGuiConfig: () => ({ ...config }),
  saveLauncherConfig: () => {},
  restartDesktop: async () => ({ serverRunning: false, error: 'restart failed' })
});
await assert.rejects(() => failed.save({}), /restart failed/);

console.log('Desktop settings unit tests passed.');
