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
let storedApiKey = '';

try {
  saveLauncherConfig({ port: 3333, token: 'preserved-token', tunnelId: 'tunnel_example123456' });
  assert.deepEqual(readDesktopSettings({ tunnelApiKeyConfigured: true, notificationsEnabled }), {
    ok: true,
    port: 3333,
    tunnelId: 'tunnel_example123456',
    tunnelApiKey: '',
    tunnelApiKeyConfigured: true,
    notificationsEnabled: true
  });

  const runtimeActions = {
    setNotificationsEnabled(value) { notificationsEnabled = value; },
    setTunnelApiKey(value) { storedApiKey = value; },
    async restartDesktop() { restarts += 1; return { serverRunning: true }; }
  };

  const result = await saveDesktopSettings({
    port: 4444,
    tunnelId: 'tunnel_replacement123',
    tunnelApiKey: 'sk-runtime-replacement-123456',
    notificationsEnabled: false
  }, runtimeActions);
  assert.equal(result.ok, true);
  assert.deepEqual(readGuiConfig(), { port: 4444, token: 'preserved-token', tunnelId: 'tunnel_replacement123' });
  assert.equal(storedApiKey, 'sk-runtime-replacement-123456');
  assert.equal(notificationsEnabled, false);
  assert.equal(restarts, 1);

  await assert.rejects(
    () => saveDesktopSettings({}, { setTunnelApiKey() {}, restartDesktop: async () => ({ serverRunning: false, error: 'restart failed' }) }),
    /restart failed/
  );
  await assert.rejects(() => saveDesktopSettings({}, { setTunnelApiKey() {} }), /restartDesktop is required/);
} finally {
  if (previousStateDir === undefined) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  if (previousConfig === undefined) delete process.env.REL_AI_MCP_CONFIG;
  else process.env.REL_AI_MCP_CONFIG = previousConfig;
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('Desktop secure tunnel settings unit tests passed.');
