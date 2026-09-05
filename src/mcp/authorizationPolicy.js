import { getOperationCapability } from '../tools/actionCatalog.js';

const AUTHORIZATION_POLICY_VERSION = 1;
const CAPABILITIES = Object.freeze({
  REPOSITORY_READ: 'repository:read',
  REPOSITORY_WRITE: 'repository:write',
  COMMAND_EXECUTE: 'command:execute',
  PROCESS_MANAGE: 'process:manage',
  COMPUTER_CONTROL: 'computer:control',
  GIT_PUBLISH: 'git:publish'
});
const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES));

class AuthorizationDeniedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AuthorizationDeniedError';
    this.code = 'AUTHORIZATION_DENIED';
    this.retryable = false;
    this.details = details;
  }
}

function createLocalAdminPolicy() {
  return Object.freeze({
    version: AUTHORIZATION_POLICY_VERSION,
    kind: 'local_admin',
    capabilities: [...ALL_CAPABILITIES],
    workspaces: ['*']
  });
}

function createConsentPolicy(options = {}) {
  const available = new Set((options.availableWorkspaces || []).map(cleanWorkspace).filter(Boolean));
  const capabilities = unique(options.capabilities).filter(value => ALL_CAPABILITIES.includes(value));
  const workspaces = unique(options.workspaces).map(cleanWorkspace).filter(value => value === '*' || available.size === 0 || available.has(value));
  if (capabilities.length === 0) throw new AuthorizationDeniedError('Select at least one Rel.AI capability.', { reason: 'capability_required' });
  if (workspaces.length === 0) throw new AuthorizationDeniedError('Select at least one configured workspace.', { reason: 'workspace_required' });
  return Object.freeze({
    version: AUTHORIZATION_POLICY_VERSION,
    kind: 'client_grant',
    capabilities: capabilities.sort(),
    workspaces: workspaces.sort()
  });
}

function normalizeAuthorizationPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Authorization policy must be an object.');
  if (Number(value.version) !== AUTHORIZATION_POLICY_VERSION) throw new TypeError('Unsupported authorization policy version.');
  if (!['local_admin', 'client_grant'].includes(value.kind)) throw new TypeError('Unsupported authorization policy kind.');
  const capabilities = unique(value.capabilities).filter(item => ALL_CAPABILITIES.includes(item));
  const workspaces = unique(value.workspaces).map(cleanWorkspace).filter(Boolean);
  if (capabilities.length === 0 || workspaces.length === 0) throw new TypeError('Authorization policy is incomplete.');
  return Object.freeze({
    version: AUTHORIZATION_POLICY_VERSION,
    kind: value.kind,
    capabilities: capabilities.sort(),
    workspaces: workspaces.sort()
  });
}

function requiredCapability(operationName) {
  return getOperationCapability(operationName);
}

function authorizedWorkspaceAliases(principal, aliases = []) {
  const available = unique(aliases).map(cleanWorkspace).filter(Boolean);
  if (principal === 'local:trusted' || isTrustedLocalPrincipal(principal)) return available;
  const policyValue = typeof principal === 'object' && principal && !Array.isArray(principal)
    ? principal.authorizationPolicy
    : null;
  let policy;
  try { policy = normalizeAuthorizationPolicy(policyValue); }
  catch { return []; }
  if (policy.workspaces.includes('*')) return available;
  const allowed = new Set(policy.workspaces);
  return available.filter(alias => allowed.has(alias));
}

function assertAuthorizedToolCall(options = {}) {
  const principal = options.principal;
  if (principal === 'local:trusted' || isTrustedLocalPrincipal(principal)) return createLocalAdminPolicy();
  if (!principal || principal === 'connector:anonymous') {
    throw denied(options, 'Authenticated client authorization is required.');
  }
  const policyValue = typeof principal === 'object' && !Array.isArray(principal)
    ? principal.authorizationPolicy
    : null;
  let policy;
  try { policy = normalizeAuthorizationPolicy(policyValue); }
  catch { throw denied(options, 'The authenticated client has no valid Rel.AI authorization grant.'); }
  const capability = requiredCapability(options.operationName);
  if (!capability) {
    throw denied(options, 'The requested operation is not classified by the authorization policy.', {
      reason: 'unclassified_operation'
    });
  }
  if (!policy.capabilities.includes(capability)) {
    throw denied(options, `The client grant does not permit ${capability}.`, { capability });
  }
  const workspace = cleanWorkspace(options.workspace);
  if (workspace && !policy.workspaces.includes('*') && !policy.workspaces.includes(workspace)) {
    throw denied(options, `The client grant does not permit workspace '${workspace}'.`, { workspace });
  }
  return policy;
}

function isTrustedLocalPrincipal(principal) {
  return Boolean(
    principal
    && typeof principal === 'object'
    && !Array.isArray(principal)
    && principal.authMode === 'local_session'
    && /^stdio:[A-Za-z0-9_-]{16,160}$/.test(String(principal.clientId || ''))
  );
}

function denied(options, message, details = {}) {
  return new AuthorizationDeniedError(message, {
    operation: String(options.operationName || ''),
    workspace: cleanWorkspace(options.workspace),
    ...details
  });
}


function unique(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))];
}

function cleanWorkspace(value) {
  return String(value || '').trim().slice(0, 200);
}

export {
  CAPABILITIES,
  assertAuthorizedToolCall,
  authorizedWorkspaceAliases,
  createConsentPolicy,
  createLocalAdminPolicy,
  isTrustedLocalPrincipal,
  requiredCapability
};
