'use strict';

function createDesktopSettingsManager(options = {}) {
  const {
    readGuiConfig,
    saveLauncherConfig,
    getApprovalRequired = () => false,
    getNotificationsEnabled = () => true,
    setNotificationsEnabled = () => true,
    restartDesktop
  } = options;
  if (typeof readGuiConfig !== 'function') throw new TypeError('readGuiConfig is required.');
  if (typeof saveLauncherConfig !== 'function') throw new TypeError('saveLauncherConfig is required.');
  if (typeof restartDesktop !== 'function') throw new TypeError('restartDesktop is required.');

  function get() {
    let config;
    try {
      config = readGuiConfig();
    } catch (error) {
      if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] read gui config:', error);
      config = { port: 3333, token: '', ngrokDomain: '', ngrokAuthtoken: '' };
    }
    return {
      ok: true,
      port: Number(config.port || 3333),
      approvalToken: String(config.token || ''),
      ngrokDomain: String(config.ngrokDomain || ''),
      ngrokAuthtoken: '',
      ngrokAuthtokenConfigured: Boolean(String(config.ngrokAuthtoken || '').trim()),
      approvalRequired: getApprovalRequired() === true,
      notificationsEnabled: getNotificationsEnabled() !== false
    };
  }

  async function save(settings = {}) {
    const current = readGuiConfig();
    const replacementAccountKey = String(settings.ngrokAuthtoken || '').trim();
    saveLauncherConfig({
      port: settings.port,
      token: current.token,
      ngrokDomain: settings.ngrokDomain,
      ngrokAuthtoken: replacementAccountKey || current.ngrokAuthtoken
    });
    if (typeof settings.notificationsEnabled === 'boolean') {
      setNotificationsEnabled(settings.notificationsEnabled);
    }
    const status = await restartDesktop();
    if (!status.serverRunning) throw new Error(status.error || 'Desktop settings were saved, but the service did not restart.');
    return { ok: true, status };
  }

  return { get, save };
}

module.exports = { createDesktopSettingsManager };
