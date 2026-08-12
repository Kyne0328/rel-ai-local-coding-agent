import { saveLauncherConfig } from './launcher-config.js';
import { readGuiConfig } from './launcher-utils.js';

function readDesktopSettings(runtimeState = {}) {
  let config;
  try {
    config = readGuiConfig();
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] read gui config:', error);
    config = { port: 3333, token: '', tunnelId: '' };
  }
  return {
    ok: true,
    port: Number(config.port || 3333),
    tunnelId: String(config.tunnelId || ''),
    tunnelApiKey: '',
    tunnelApiKeyConfigured: runtimeState.tunnelApiKeyConfigured === true,
    notificationsEnabled: runtimeState.notificationsEnabled !== false
  };
}

async function saveDesktopSettings(settings = {}, runtimeActions = {}) {
  const { setNotificationsEnabled = () => true, setTunnelApiKey, restartDesktop } = runtimeActions;
  if (typeof restartDesktop !== 'function') throw new TypeError('restartDesktop is required.');
  if (typeof setTunnelApiKey !== 'function') throw new TypeError('setTunnelApiKey is required.');

  const current = readGuiConfig();
  const replacementApiKey = String(settings.tunnelApiKey || '').trim();
  if (replacementApiKey) setTunnelApiKey(replacementApiKey);
  saveLauncherConfig({
    port: settings.port ?? current.port,
    tunnelId: settings.tunnelId ?? current.tunnelId,
    token: current.token
  });
  if (typeof settings.notificationsEnabled === 'boolean') setNotificationsEnabled(settings.notificationsEnabled);
  const status = await restartDesktop();
  if (!status.serverRunning) throw new Error(status.error || 'Desktop settings were saved, but the service did not restart.');
  return { ok: true, status };
}

export { readDesktopSettings, saveDesktopSettings };
