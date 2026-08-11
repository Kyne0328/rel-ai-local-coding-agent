import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-desktop-settings-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
const previousConfig = process.env.REL_AI_MCP_CONFIG;
process.env.REL_AI_MCP_STATE_DIR = root;
process.env.REL_AI_MCP_CONFIG = path.join(root, 'config.json');

const { saveLauncherConfig } = await import('../electron/launcher-config.js');
const { readGuiConfig } = await import('../electron/launcher-utils.js');
const { readDesktopSettings, saveDesktopSettings } = await import('../electron/desktop-settings.js');

let notificationsEnabled = true;
let restarts = 0;

try {
  saveLauncherConfig({
    port: 3333,
    token: 'preserved-token',
    ngrokDomain: 'example.ngrok-free.dev',
    ngrokAuthtoken: 'account-key'
  });

  assert.deepEqual(readDesktopSettings({ approvalRequired: true, notificationsEnabled }), {
    ok: true,
    connectionMode: 'direct',
    gatewayOrigin: 'https://rel-ai.kynemcp.workers.dev',
    port: 3333,
    approvalToken: 'preserved-token',
    ngrokDomain: 'example.ngrok-free.dev',
    ngrokAuthtoken: '',
    ngrokAuthtokenConfigured: true,
    approvalRequired: true,
    notificationsEnabled: true
  });

  const runtimeActions = {
    setNotificationsEnabled(value) { notificationsEnabled = value; },
    async restartDesktop() {
      restarts += 1;
      return { serverRunning: true };
    }
  };

  const preserveResult = await saveDesktopSettings({
    port: 4444,
    approvalToken: 'must-not-be-used',
    ngrokDomain: 'updated.ngrok-free.dev',
    ngrokAuthtoken: '',
    notificationsEnabled: false
  }, runtimeActions);
  assert.equal(preserveResult.ok, true);
  assert.deepEqual(readGuiConfig(), {
    connectionMode: 'direct',
    gatewayOrigin: 'https://rel-ai.kynemcp.workers.dev',
    port: 4444,
    ngrokDomain: 'updated.ngrok-free.dev',
    token: 'preserved-token',
    ngrokAuthtoken: 'account-key',
    publicUrl: 'https://updated.ngrok-free.dev'
  });
  assert.equal(notificationsEnabled, false);

  await saveDesktopSettings({
    port: 4555,
    ngrokDomain: 'replacement.ngrok-free.dev',
    ngrokAuthtoken: 'new-account-key'
  }, runtimeActions);
  assert.deepEqual(readGuiConfig(), {
    connectionMode: 'direct',
    gatewayOrigin: 'https://rel-ai.kynemcp.workers.dev',
    port: 4555,
    ngrokDomain: 'replacement.ngrok-free.dev',
    token: 'preserved-token',
    ngrokAuthtoken: 'new-account-key',
    publicUrl: 'https://replacement.ngrok-free.dev'
  });
  assert.equal(restarts, 2);
  assert.equal(readDesktopSettings().ngrokAuthtoken, '');
  assert.equal(readDesktopSettings().ngrokAuthtokenConfigured, true);

  await assert.rejects(
    () => saveDesktopSettings({
      port: 4555,
      ngrokDomain: 'replacement.ngrok-free.dev',
      ngrokAuthtoken: ''
    }, { restartDesktop: async () => ({ serverRunning: false, error: 'restart failed' }) }),
    /restart failed/
  );
  await assert.rejects(() => saveDesktopSettings({}), /restartDesktop is required/);
} finally {
  if (previousStateDir === undefined) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  if (previousConfig === undefined) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Desktop settings unit tests passed.');
