const fs = require('node:fs');
const path = require('node:path');
const { normalizeNgrokAuthtoken } = require('./ngrok-token');

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

function stripHttpProtocol(value) {
  const text = String(value || '');
  const lower = text.toLowerCase();
  if (lower.startsWith('https://')) return text.slice(8);
  if (lower.startsWith('http://')) return text.slice(7);
  return text;
}

function isDomainEdgeChar(ch) {
  if (ch?.length !== 1) return false;
  const code = ch.codePointAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function hasOnlyDomainChars(value) {
  for (const ch of value) {
    if (ch !== '.' && ch !== '-' && !isDomainEdgeChar(ch)) return false;
  }
  return true;
}

function normalizeNgrokDomain(value) {
  let domain = stripHttpProtocol(String(value || '').trim()).toLowerCase();
  while (domain.endsWith('/')) domain = domain.slice(0, -1);

  if (!domain) throw new Error('ngrok domain is required.');
  if (domain.length > 253) throw new Error('ngrok domain is too long.');
  if (!domain.includes('.')) throw new Error('ngrok domain must include a dot.');
  if (!hasOnlyDomainChars(domain) || !isDomainEdgeChar(domain[0]) || !isDomainEdgeChar(domain.at(-1))) {
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
  return `managed ngrok http --url=https://${safeDomain} http://127.0.0.1:${safePort} --config <Rel.AI ngrok.yml> --log=stdout`;
}

// ChatGPT connects to the plain /mcp endpoint with Authentication: OAuth. The
// legacy secret-in-URL path has been removed, so this no longer embeds a secret.
function buildMcpUrl(publicBaseUrl) {
  let base = String(publicBaseUrl || '').trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/mcp`;
}

function hasExistingConfig() {
  const connection = connectionModule();
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  try {
    normalizePort(profile.port || env.REL_AI_MCP_PORT || 3333);
    normalizeNgrokDomain(env.REL_AI_MCP_NGROK_DOMAIN || profile.ngrokDomain || stripHttpProtocol(String(profile.publicUrl || '')));
    normalizeNgrokAuthtoken(env.REL_AI_MCP_NGROK_AUTHTOKEN || profile.ngrokAuthtoken || '');
  } catch {
    return false;
  }
  return Boolean(profile.port || env.REL_AI_MCP_PORT);
}

function readGuiConfig() {
  const connection = connectionModule();
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  let ngrokDomain = env.REL_AI_MCP_NGROK_DOMAIN || profile.ngrokDomain || '';
  if (!ngrokDomain && profile.publicUrl) {
    let fromUrl = stripHttpProtocol(String(profile.publicUrl));
    while (fromUrl.endsWith('/')) fromUrl = fromUrl.slice(0, -1);
    ngrokDomain = fromUrl;
  }
  return {
    port: normalizePort(env.REL_AI_MCP_PORT || profile.port || 3333),
    ngrokDomain: ngrokDomain ? normalizeNgrokDomain(ngrokDomain) : '',
    token: env.REL_AI_MCP_TOKEN || '',
    ngrokAuthtoken: env.REL_AI_MCP_NGROK_AUTHTOKEN || profile.ngrokAuthtoken || '',
    publicUrl: profile.publicUrl || (ngrokDomain ? `https://${normalizeNgrokDomain(ngrokDomain)}` : '')
  };
}

module.exports = {
  resolveSrcPath,
  normalizePort,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  buildTunnelCommand,
  buildMcpUrl,
  hasExistingConfig,
  readGuiConfig
};
