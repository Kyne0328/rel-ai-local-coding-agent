import { saveLauncherConfig } from './launcher-config.js';
import { readGuiConfig } from './launcher-utils.js';

function readDesktopSettings(runtimeState = {}) {
  let config;
  try {
    config = readGuiConfig();
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] read gui config:', error);
    config = { connectionMode: 'cloud', gatewayOrigin: '', port: 3333, token: '', ngrokDomain: '', ngrokAuthtoken: '' };
  }
  return {
    ok: true,
    connectionMode: String(config.connectionMode || 'cloud'),
    gatewayOrigin: String(config.gatewayOrigin || ''),
    port: Number(config.port || 3333),
    approvalToken: String(config.token || ''),
    ngrokDomain: String(config.ngrokDomain || ''),
    ngrokAuthtoken: '',
    ngrokAuthtokenConfigured: Boolean(String(config.ngrokAuthtoken || '').trim()),
    approvalRequired: runtimeState.approvalRequired === true,
    notificationsEnabled: runtimeState.notificationsEnabled !== false
  };
}

async function saveDesktopSettings(settings = {}, runtimeActions = {}) {
  const { setNotificationsEnabled = () => true, restartDesktop } = runtimeActions;
  if (typeof restartDesktop !== 'function') throw new TypeError('restartDesktop is required.');

  const current = readGuiConfig();
  const replacementAccountKey = String(settings.ngrokAuthtoken || '').trim();
  saveLauncherConfig({
    connectionMode: settings.connectionMode || current.connectionMode,
    gatewayOrigin: settings.gatewayOrigin || current.gatewayOrigin,
    port: settings.port ?? current.port,
    token: current.token,
    ngrokDomain: settings.ngrokDomain ?? current.ngrokDomain,
    ngrokAuthtoken: replacementAccountKey || current.ngrokAuthtoken
  });
  if (typeof settings.notificationsEnabled === 'boolean') {
    setNotificationsEnabled(settings.notificationsEnabled);
  }
  const status = await restartDesktop();
  if (!status.serverRunning) throw new Error(status.error || 'Desktop settings were saved, but the service did not restart.');
  return { ok: true, status };
}

export { readDesktopSettings, saveDesktopSettings };
