import { importResourceModule, resolveResourcePath } from './resource-path.js';
import { normalizeNgrokAuthtoken } from './ngrok-token.js';

const connection = await importResourceModule('src/connectionProfile.js');
const DEFAULT_GATEWAY_ORIGIN = 'https://rel-ai.kynemcp.workers.dev';

function resolveSrcPath() {
  return resolveResourcePath('src');
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

/** @param {unknown} value @param {Record<string, unknown>} [legacy] @returns {'cloud' | 'direct'} */
function normalizeConnectionMode(value, legacy = {}) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode) {
    if (!['cloud', 'direct'].includes(mode)) throw new Error('Connection mode must be cloud or direct.');
    return mode;
  }
  const hasLegacyNgrok = Boolean(
    String(legacy.ngrokDomain || '').trim()
    && String(legacy.ngrokAuthtoken || '').trim()
  );
  if (hasLegacyNgrok || String(legacy.tunnelProvider || '').trim() === 'managed-ngrok') return 'direct';
  return 'cloud';
}

function normalizeGatewayOrigin(value) {
  const candidate = String(value || process.env.REL_AI_GATEWAY_ORIGIN || DEFAULT_GATEWAY_ORIGIN).trim();
  let url;
  try { url = new URL(candidate); }
  catch { throw new Error('Gateway origin must be an absolute HTTP(S) URL.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Gateway origin must use HTTPS except for a loopback development fixture.');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function buildTunnelCommand(domain, port) {
  const safeDomain = normalizeNgrokDomain(domain);
  const safePort = normalizePort(port);
  return `managed ngrok http --url=https://${safeDomain} http://127.0.0.1:${safePort} --config <Rel.AI ngrok.yml> --log=stdout --log-format=logfmt --log-level=info`;
}

function buildMcpUrl(publicBaseUrl) {
  let base = String(publicBaseUrl || '').trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/mcp`;
}

function legacyConnectionInputs(profile, env) {
  let ngrokDomain = env.REL_AI_MCP_NGROK_DOMAIN || profile.ngrokDomain || '';
  if (!ngrokDomain && profile.publicUrl) {
    let fromUrl = stripHttpProtocol(String(profile.publicUrl));
    while (fromUrl.endsWith('/')) fromUrl = fromUrl.slice(0, -1);
    ngrokDomain = fromUrl;
  }
  return {
    ngrokDomain,
    ngrokAuthtoken: env.REL_AI_MCP_NGROK_AUTHTOKEN || profile.ngrokAuthtoken || '',
    tunnelProvider: profile.tunnelProvider || ''
  };
}

function hasExistingConfig() {
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  const legacy = legacyConnectionInputs(profile, env);
  const explicitMode = String(env.REL_AI_MCP_CONNECTION_MODE || profile.connectionMode || '').trim();
  let mode;
  try {
    mode = normalizeConnectionMode(explicitMode, legacy);
    normalizePort(profile.port || env.REL_AI_MCP_PORT || 3333);
    if (mode === 'direct') {
      normalizeNgrokDomain(legacy.ngrokDomain);
      normalizeNgrokAuthtoken(legacy.ngrokAuthtoken);
    } else {
      normalizeGatewayOrigin(env.REL_AI_GATEWAY_ORIGIN || profile.gatewayOrigin || '');
    }
  } catch {
    return false;
  }
  const hasPort = Boolean(profile.port || env.REL_AI_MCP_PORT);
  if (!hasPort) return false;
  if (mode === 'cloud') return explicitMode === 'cloud';
  return true;
}

function readGuiConfig() {
  const profile = connection.readConnectionProfile();
  const env = connection.readLaunchEnv();
  const legacy = legacyConnectionInputs(profile, env);
  const connectionMode = normalizeConnectionMode(
    env.REL_AI_MCP_CONNECTION_MODE || profile.connectionMode || '',
    legacy
  );
  const ngrokDomain = connectionMode === 'direct' && legacy.ngrokDomain
    ? normalizeNgrokDomain(legacy.ngrokDomain)
    : String(legacy.ngrokDomain || '').trim();
  let gatewayOrigin;
  try { gatewayOrigin = normalizeGatewayOrigin(env.REL_AI_GATEWAY_ORIGIN || profile.gatewayOrigin || ''); }
  catch (error) {
    if (connectionMode === 'cloud') throw error;
    gatewayOrigin = DEFAULT_GATEWAY_ORIGIN;
  }
  return {
    connectionMode,
    gatewayOrigin,
    port: normalizePort(env.REL_AI_MCP_PORT || profile.port || 3333),
    ngrokDomain,
    token: env.REL_AI_MCP_TOKEN || '',
    ngrokAuthtoken: legacy.ngrokAuthtoken,
    publicUrl: connectionMode === 'direct'
      ? (profile.publicUrl || (ngrokDomain ? `https://${ngrokDomain}` : ''))
      : ''
  };
}

export {
  DEFAULT_GATEWAY_ORIGIN,
  resolveSrcPath,
  normalizePort,
  normalizeNgrokDomain,
  normalizeNgrokAuthtoken,
  normalizeConnectionMode,
  normalizeGatewayOrigin,
  buildTunnelCommand,
  buildMcpUrl,
  hasExistingConfig,
  readGuiConfig
};
