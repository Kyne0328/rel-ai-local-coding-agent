const fs = require('node:fs');
const path = require('node:path');

function resolveSrcPath() {
  const packagedSrc = process.resourcesPath ? path.join(process.resourcesPath, 'src') : '';
  if (packagedSrc && fs.existsSync(path.join(packagedSrc, 'connectionProfile.js'))) return packagedSrc;
  return path.join(__dirname, '..', 'src');
}

function connectionModule() {
  return require(path.join(resolveSrcPath(), 'connectionProfile'));
}

function normalizePort(value, fallback = 3333) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Port must be an integer between 1024 and 65535.');
  }
  return port;
}

function normalizeNgrokDomain(value) {
  const domain = String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  if (!domain) throw new Error('ngrok domain is required.');
  if (domain.length > 253) throw new Error('ngrok domain is too long.');
  if (!domain.includes('.')) throw new Error('ngrok domain must include a dot.');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain)) {
    throw new Error('ngrok domain can only contain letters, numbers, dots, and hyphens.');
  }
  if (domain.includes('..')) throw new Error('ngrok domain cannot contain empty labels.');
  for (const label of domain.split('.')) {
    if (!label || label.length > 63 || label.startsWith('-') || label.endsWith('-')) {
      throw new Error('ngrok domain contains an invalid DNS label.');
    }
  }
  return domain;
}

function buildTunnelCommand(domain, port) {
  const safeDomain = normalizeNgrokDomain(domain);
  const safePort = normalizePort(port);
  return `ngrok http --url=${safeDomain} ${safePort} --log=stdout`;
}

function buildMcpUrl(publicBaseUrl, chatgptSecret) {
  const base = String(publicBaseUrl || '').trim().replace(/\/+$/, '');
  const secret = String(chatgptSecret || '').trim();
  return `${base}/mcp/${encodeURIComponent(secret)}`;
}

function hasExistingConfig() {
  const connection = connectionModule();
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  try {
    normalizePort(profile.port || env.REL_AI_MCP_PORT || 3333);
    normalizeNgrokDomain(env.REL_AI_MCP_NGROK_DOMAIN || profile.ngrokDomain || String(profile.publicUrl || '').replace(/^https?:\/\//i, ''));
  } catch (_) {
    return false;
  }
  return Boolean(profile.port || env.REL_AI_MCP_PORT);
}

function readGuiConfig() {
  const connection = connectionModule();
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  let ngrokDomain = env.REL_AI_MCP_NGROK_DOMAIN || profile.ngrokDomain || '';
  if (!ngrokDomain && profile.publicUrl) ngrokDomain = String(profile.publicUrl).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return {
    port: normalizePort(profile.port || env.REL_AI_MCP_PORT || 3333),
    ngrokDomain: ngrokDomain ? normalizeNgrokDomain(ngrokDomain) : '',
    token: env.REL_AI_MCP_TOKEN || '',
    chatgptSecret: env.REL_AI_MCP_CHATGPT_SECRET || profile.chatgptSecret || '',
    publicUrl: profile.publicUrl || (ngrokDomain ? `https://${normalizeNgrokDomain(ngrokDomain)}` : '')
  };
}

module.exports = {
  resolveSrcPath,
  normalizePort,
  normalizeNgrokDomain,
  buildTunnelCommand,
  buildMcpUrl,
  hasExistingConfig,
  readGuiConfig
};
