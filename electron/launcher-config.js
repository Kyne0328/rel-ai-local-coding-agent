// @ts-check
/** @typedef {import('../types/boundaries').LauncherConfigInput} LauncherConfigInput */
/** @typedef {import('../types/boundaries').LauncherConfig} LauncherConfig */

const net = require('node:net');
const path = require('node:path');
const { resolveResourcePath } = require('./resource-path');
const srcPath = resolveResourcePath('src');
const connection = require(path.join(srcPath, 'connectionProfile'));
const configModule = require(path.join(srcPath, 'config'));
const {
  buildTunnelCommand,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  normalizePort
} = require('./launcher-utils');

/** @param {number} port @returns {Promise<boolean>} */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** @param {LauncherConfigInput} [config] @returns {LauncherConfig} */
function normalizeWizardConfig(config = {}) {
  const port = normalizePort(config.port || 3333);
  const ngrokDomain = normalizeNgrokDomain(config.ngrokDomain || config.domain || '');
  const ngrokAuthtoken = normalizeNgrokAuthtoken(config.ngrokAuthtoken || config.ngrokToken || '');
  const token = String(config.token || '').trim() || connection.generateToken(32);
  return { port, ngrokDomain, ngrokAuthtoken, token };
}

/** @param {LauncherConfigInput} [config] @returns {LauncherConfig} */
function saveLauncherConfig(config = {}) {
  const normalized = normalizeWizardConfig(config);
  const publicUrl = `https://${normalized.ngrokDomain}`;
  const tunnelCommand = buildTunnelCommand(normalized.ngrokDomain, normalized.port);

  connection.writeLaunchEnv({
    REL_AI_MCP_PORT: String(normalized.port),
    REL_AI_MCP_TOKEN: normalized.token,
    REL_AI_MCP_NGROK_DOMAIN: normalized.ngrokDomain,
    REL_AI_MCP_NGROK_AUTHTOKEN: normalized.ngrokAuthtoken,
    REL_AI_MCP_PUBLIC_URL: publicUrl,
    REL_AI_MCP_TUNNEL_COMMAND: tunnelCommand
  });

  // Do NOT write port here — port in connectionProfile must only come from the running server.
  // Writing wizard-configured port here would make readGuiConfig return the desired port
  // before the server has restarted, causing dashboard and ngrok to target the wrong port.
  connection.writeConnectionProfile({
    host: '127.0.0.1',
    publicUrl,
    ngrokDomain: normalized.ngrokDomain,
    ngrokAuthtoken: normalized.ngrokAuthtoken,
    tunnelProvider: 'managed-ngrok',
    configPath: configModule.getConfigPath()
  });

  return normalized;
}

module.exports = { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
