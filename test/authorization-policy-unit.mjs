import assert from 'node:assert/strict';
import {
  CAPABILITIES,
  assertAuthorizedToolCall,
  createConsentPolicy,
  createLocalAdminPolicy,
  isTrustedLocalPrincipal,
  requiredCapability
} from '../src/mcp/authorizationPolicy.js';

const grant = createConsentPolicy({
  capabilities: [CAPABILITIES.REPOSITORY_READ, CAPABILITIES.REPOSITORY_WRITE],
  workspaces: ['repo-a'],
  availableWorkspaces: ['repo-a', 'repo-b']
});
const principal = { clientId: 'client-a', authMode: 'oauth', authorizationPolicy: grant };
assert.equal(requiredCapability('relai_read'), CAPABILITIES.REPOSITORY_READ);
assert.equal(requiredCapability('relai_edit'), CAPABILITIES.REPOSITORY_WRITE);
assert.equal(requiredCapability('relai_unknown_operation'), '');
assert.equal(assertAuthorizedToolCall({ principal, operationName: 'relai_read', workspace: 'repo-a' }).kind, 'client_grant');
assert.throws(
  () => assertAuthorizedToolCall({ principal, operationName: 'relai_exec', workspace: 'repo-a' }),
  error => error.code === 'AUTHORIZATION_DENIED' && /command:execute/.test(error.message)
);
assert.throws(
  () => assertAuthorizedToolCall({ principal, operationName: 'relai_read', workspace: 'repo-b' }),
  error => error.code === 'AUTHORIZATION_DENIED' && /repo-b/.test(error.message)
);
assert.equal(assertAuthorizedToolCall({ principal: { authorizationPolicy: createLocalAdminPolicy() }, operationName: 'relai_git_push', workspace: 'repo-b' }).kind, 'local_admin');
assert.equal(assertAuthorizedToolCall({ principal: 'local:trusted', operationName: 'relai_exec', workspace: 'repo-b' }).kind, 'local_admin');
const stdioPrincipal = { clientId: 'stdio:1234567890abcdef', authMode: 'local_session' };
assert.equal(isTrustedLocalPrincipal(stdioPrincipal), true);
assert.equal(assertAuthorizedToolCall({ principal: stdioPrincipal, operationName: 'relai_exec', workspace: 'repo-b' }).kind, 'local_admin');
assert.equal(isTrustedLocalPrincipal({ clientId: 'remote-client', authMode: 'local_session' }), false);
assert.throws(
  () => assertAuthorizedToolCall({ principal, operationName: 'relai_unknown_operation', workspace: 'repo-a' }),
  error => error.code === 'AUTHORIZATION_DENIED' && error.details?.reason === 'unclassified_operation'
);
console.log('Client capability and workspace authorization policy tests passed.');
