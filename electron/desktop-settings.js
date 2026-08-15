import { normalizeWizardConfig, saveLauncherConfig } from './launcher-config.js';
import { readGuiConfig } from './launcher-utils.js';
import { normalizeApiKey } from './tunnel-credentials.js';

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
  const {
    setNotificationsEnabled = () => true,
    getNotificationsEnabled = () => true,
    setTunnelApiKey,
    getTunnelApiKey = () => '',
    clearTunnelApiKey = () => {},
    canRestart = () => '',
    restartDesktop
  } = runtimeActions;
  if (typeof restartDesktop !== 'function') throw new TypeError('restartDesktop is required.');
  if (typeof setTunnelApiKey !== 'function') throw new TypeError('setTunnelApiKey is required.');

  const restartBlock = String(canRestart('saving connection settings') || '');
  if (restartBlock) throw new Error(restartBlock);

  const current = readGuiConfig();
  const next = normalizeWizardConfig({
    port: settings.port ?? current.port,
    tunnelId: settings.tunnelId ?? current.tunnelId,
    token: current.token
  });
  const replacementApiKey = String(settings.tunnelApiKey || '').trim();
  if (replacementApiKey) normalizeApiKey(replacementApiKey);
  const previousApiKey = replacementApiKey ? String(getTunnelApiKey() || '') : '';
  const previousNotifications = getNotificationsEnabled() !== false;
  const notificationChange = typeof settings.notificationsEnabled === 'boolean';

  try {
    saveLauncherConfig(next);
    if (replacementApiKey) setTunnelApiKey(replacementApiKey);
    if (notificationChange) setNotificationsEnabled(settings.notificationsEnabled);
    const status = await restartDesktop();
    if (!status?.serverRunning) throw new Error(status?.error || 'Desktop settings were saved, but the service did not restart.');
    return { ok: true, status };
  } catch (error) {
    const rollbackErrors = [];
    try { saveLauncherConfig(current); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    if (replacementApiKey) {
      try {
        if (previousApiKey) setTunnelApiKey(previousApiKey);
        else clearTunnelApiKey();
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (notificationChange) {
      try { setNotificationsEnabled(previousNotifications); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    try { await restartDesktop(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    const message = error instanceof Error ? error.message : String(error || 'Desktop settings could not be saved.');
    if (!rollbackErrors.length) throw new Error(`${message} Previous connection settings were restored.`, { cause: error });
    throw new Error(`${message} Rel.AI also could not fully restore the previous connection settings.`, { cause: error });
  }
}

export { readDesktopSettings, saveDesktopSettings };
