// @ts-check
/** @typedef {import('../types/boundaries.d.ts').LauncherConfigInput} LauncherConfigInput */
/** @typedef {import('../types/boundaries.d.ts').LauncherConfig} LauncherConfig */

import * as net from 'node:net';
import { importResourceModule } from './resource-path.js';

const connection = await importResourceModule('src/connectionProfile.js');
const configModule = await importResourceModule('src/config.js');
import {
  buildTunnelCommand,
  normalizeConnectionMode,
  normalizeGatewayOrigin,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  normalizePort,
  readGuiConfig
} from './launcher-utils.js';

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
  const rawDomain = String(config.ngrokDomain || config.domain || '').trim();
  const rawAuthtoken = String(config.ngrokAuthtoken || config.ngrokToken || '').trim();
  const connectionMode = normalizeConnectionMode(config.connectionMode, {
    ngrokDomain: rawDomain,
    ngrokAuthtoken: rawAuthtoken
  });
  const gatewayOrigin = normalizeGatewayOrigin(config.gatewayOrigin);
  const direct = connectionMode === 'direct';
  const ngrokDomain = rawDomain ? (direct ? normalizeNgrokDomain(rawDomain) : rawDomain) : '';
  const ngrokAuthtoken = rawAuthtoken ? (direct ? normalizeNgrokAuthtoken(rawAuthtoken) : rawAuthtoken) : '';
  if (direct) {
    if (!ngrokDomain) throw new Error('ngrok domain is required.');
    if (!ngrokAuthtoken) throw new Error('ngrok authtoken is required.');
  }
  const token = String(config.token || '').trim() || connection.generateToken(32);
  return { connectionMode, gatewayOrigin, port, ngrokDomain, ngrokAuthtoken, token };
}

/** @param {LauncherConfigInput} [config] @returns {LauncherConfig} */
function saveLauncherConfig(config = {}) {
  let current = {};
  try { current = readGuiConfig(); } catch {}
  const normalized = normalizeWizardConfig({
    ...config,
    port: config.port ?? current.port ?? 3333,
    token: config.token ?? current.token ?? '',
    gatewayOrigin: config.gatewayOrigin ?? current.gatewayOrigin ?? '',
    ngrokDomain: config.ngrokDomain ?? config.domain ?? current.ngrokDomain ?? '',
    ngrokAuthtoken: config.ngrokAuthtoken ?? config.ngrokToken ?? current.ngrokAuthtoken ?? ''
  });
  configModule.ensureConfig();

  const direct = normalized.connectionMode === 'direct';
  const publicUrl = direct ? `https://${normalized.ngrokDomain}` : '';
  const tunnelCommand = direct ? buildTunnelCommand(normalized.ngrokDomain, normalized.port) : '';
  connection.writeLaunchEnv({
    REL_AI_MCP_CONNECTION_MODE: normalized.connectionMode,
    REL_AI_GATEWAY_ORIGIN: null,
    REL_AI_MCP_PORT: String(normalized.port),
    REL_AI_MCP_TOKEN: normalized.token,
    ...(normalized.ngrokDomain ? { REL_AI_MCP_NGROK_DOMAIN: normalized.ngrokDomain } : {}),
    ...(normalized.ngrokAuthtoken ? { REL_AI_MCP_NGROK_AUTHTOKEN: normalized.ngrokAuthtoken } : {}),
    ...(direct ? {
      REL_AI_MCP_PUBLIC_URL: publicUrl,
      REL_AI_MCP_TUNNEL_COMMAND: tunnelCommand
    } : {})
  });

  // Do NOT write port here — the profile port must only come from the running server.
  connection.writeConnectionProfile({
    host: '127.0.0.1',
    connectionMode: normalized.connectionMode,
    gatewayOrigin: normalized.gatewayOrigin,
    publicUrl,
    ngrokDomain: normalized.ngrokDomain,
    ngrokAuthtoken: normalized.ngrokAuthtoken,
    tunnelProvider: direct ? 'managed-ngrok' : 'rel-ai-gateway',
    configPath: configModule.getConfigPath()
  });

  return normalized;
}

export { isPortAvailable, normalizeWizardConfig, saveLauncherConfig };
