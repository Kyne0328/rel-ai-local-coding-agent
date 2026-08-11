import * as crypto from 'node:crypto';
import { ALL_CAPABILITIES, createConsentPolicy } from './authorizationPolicy.js';

const PRINCIPAL_FIELDS = Object.freeze([
  ['issuer', ['issuer']],
  ['clientId', ['clientId', 'client_id']],
  ['subject', ['subject', 'sub']],
  ['tenant', ['tenant', 'tenantId']],
  ['organization', ['organization', 'organizationId', 'orgId', 'org']],
  ['authorizationPolicy', ['authorizationPolicy', 'policyContext', 'policy']],
  ['authMode', ['authMode']],
  ['resource', ['resource']],
  ['scopes', ['scopes', 'scope']]
]);

function createHttpTaskPrincipal(authInfo = {}, authMode = 'oauth') {
  return Object.freeze(compactPrincipal({
    issuer: authInfo?.issuer,
    clientId: authInfo?.clientId ?? authInfo?.client_id ?? 'unknown-client',
    subject: authInfo?.subject ?? authInfo?.sub,
    tenant: authInfo?.tenant ?? authInfo?.tenantId,
    organization: authInfo?.organization ?? authInfo?.organizationId ?? authInfo?.orgId,
    authorizationPolicy: authInfo?.authorizationPolicy ?? authInfo?.policyContext,
    authMode: authMode || authInfo?.authMode || 'oauth',
    resource: authInfo?.resource,
    scopes: authInfo?.scopes ?? authInfo?.scope
  }));
}

function createGatewayTaskPrincipal(gatewayOrigin, principalId) {
  let origin;
  try {
    const url = new URL(String(gatewayOrigin || ''));
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol');
    origin = url.origin;
  } catch {
    throw new TypeError('Gateway origin must be an absolute HTTP(S) origin.');
  }
  const subject = boundedText(principalId, 200);
  if (!subject) throw new TypeError('Gateway principal ID is required.');
  return createHttpTaskPrincipal({
    issuer: origin,
    clientId: 'rel-ai',
    subject,
    authorizationPolicy: createConsentPolicy({ capabilities: ALL_CAPABILITIES, workspaces: ['*'] }),
    authMode: 'gateway',
    resource: origin + '/mcp',
    scopes: ['mcp']
  }, 'gateway');
}

function createStdioTaskPrincipal() {
  return Object.freeze({
    clientId: `stdio:${crypto.randomUUID()}`,
    authMode: 'local_session'
  });
}

function principalIdentity(value) {
  return normalizePrincipalKey(value);
}

function principalForContext(context = {}, connector = false) {
  return context?.principal || (connector ? 'connector:anonymous' : 'local:trusted');
}

function principalFingerprint(value) {
  return crypto.createHash('sha256').update(normalizePrincipalKey(value)).digest('base64url');
}

function normalizePrincipalKey(principal) {
  if (principal == null || principal === '') return 'anonymous';
  if (typeof principal === 'string' || typeof principal === 'number' || typeof principal === 'boolean') {
    return String(principal || 'anonymous');
  }
  if (typeof principal !== 'object' || Array.isArray(principal)) {
    throw new TypeError('Authenticated principal must be a string or object.');
  }

  const normalized = {};
  for (const [target, candidates] of PRINCIPAL_FIELDS) {
    const value = candidates.map(key => principal[key]).find(item => item != null && item !== '');
    if (value == null || value === '') continue;
    if (target === 'scopes') {
      const scopes = Array.isArray(value) ? value : String(value).split(/\s+/);
      normalized.scopes = [...new Set(scopes.map(item => boundedText(item, 200)).filter(Boolean))].sort();
    } else if (typeof value === 'object') {
      normalized[target] = canonicalJson(value);
    } else {
      normalized[target] = boundedText(value, 1000);
    }
  }
  return stableJson(Object.keys(normalized).length ? normalized : { clientId: 'anonymous' });
}

function compactPrincipal(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item == null || item === '') return false;
    return !Array.isArray(item) || item.length > 0;
  }));
}

function boundedText(value, maxChars) {
  return String(value == null ? '' : value).trim().slice(0, maxChars);
}

function stableJson(value) {
  return JSON.stringify(canonicalJson(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalJson(value[key]);
  return result;
}

export {
  createHttpTaskPrincipal,
  createGatewayTaskPrincipal,
  createStdioTaskPrincipal,
  normalizePrincipalKey,
  principalFingerprint,
  principalForContext,
  principalIdentity
};
