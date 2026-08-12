// @ts-check
/** @typedef {import('../types/boundaries.d.ts').LauncherConfigInput} LauncherConfigInput */
/** @typedef {import('../types/boundaries.d.ts').LauncherConfig} LauncherConfig */

import * as net from 'node:net';
import { importResourceModule } from './resource-path.js';
import { normalizePort, normalizeTunnelId, readGuiConfig } from './launcher-utils.js';

const connection = await importResourceModule('src/connectionProfile.js');
const configModule = await importResourceModule('src/config.js');

/** @param {number} port @returns {Promise<boolean>} */
function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/** @param {LauncherConfigInput} [config] @returns {LauncherConfig} */
function normalizeWizardConfig(config = {}) {
  const port = normalizePort(config.port || 3333);
  const tunnelId = normalizeTunnelId(config.tunnelId);
  const token = String(config.token || '').trim() || connection.generateToken(32);
  return { port, tunnelId, token };
}

/** @param {LauncherConfigInput} [config] @returns {LauncherConfig} */
function saveLauncherConfig(config = {}) {
  let current = {};
  try { current = readGuiConfig(); } catch {}
  const normalized = normalizeWizardConfig({
    ...config,
    port: config.port ?? current.port ?? 3333,
    token: config.token ?? current.token ?? '',
    tunnelId: config.tunnelId ?? current.tunnelId ?? ''
  });
  configModule.ensureConfig();
  connection.writeLaunchEnv({
    REL_AI_MCP_PORT: String(normalized.port),
    REL_AI_MCP_TOKEN: normalized.token,
    REL_AI_MCP_TUNNEL_ID: normalized.tunnelId
  }, { replace: true });
  connection.writeConnectionProfile({
    host: '127.0.0.1',
    tunnelId: normalized.tunnelId,
    tunnelProvider: 'openai-secure-mcp',
    configPath: configModule.getConfigPath()
  }, { replace: true });
  return normalized;
}

export { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
