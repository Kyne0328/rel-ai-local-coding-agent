import { importResourceModule } from './resource-path.js';

const connection = await importResourceModule('src/connectionProfile.js');

function normalizePort(value, fallback = 3333) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535.');
  }
  return port;
}

function normalizeTunnelId(value) {
  const text = String(value || '').trim();
  if (!/^tunnel_[A-Za-z0-9_-]{8,200}$/.test(text)) {
    throw new Error('OpenAI Secure MCP Tunnel ID must start with tunnel_.');
  }
  return text;
}

function normalizeConnectorName(value) {
  const text = String(value || '').trim();
  if (text.length < 3 || text.length > 80 || /[\r\n\0]/.test(text)) {
    throw new Error('ChatGPT connector name must be between 3 and 80 characters.');
  }
  return text;
}

function hasExistingConfig() {
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  try {
    normalizePort(env.REL_AI_MCP_PORT || profile.port || 0);
    normalizeTunnelId(env.REL_AI_MCP_TUNNEL_ID || profile.tunnelId || '');
    return Boolean(env.REL_AI_MCP_PORT || profile.port);
  } catch {
    return false;
  }
}

function readGuiConfig() {
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  return {
    port: normalizePort(env.REL_AI_MCP_PORT || profile.port || 3333),
    token: String(env.REL_AI_MCP_TOKEN || '').trim(),
    tunnelId: normalizeTunnelId(env.REL_AI_MCP_TUNNEL_ID || profile.tunnelId || ''),
    connectorName: profile.connectorName ? normalizeConnectorName(profile.connectorName) : ''
  };
}

export { normalizePort, normalizeTunnelId, normalizeConnectorName, hasExistingConfig, readGuiConfig };
