import assert from 'node:assert/strict';
import { readMcpAuthenticationStatus } from '../src/mcp/authenticationStatus.js';

const now = Date.now();

const awaiting = readMcpAuthenticationStatus({}, { staticBearerConfigured: true });
assert.equal(awaiting.status, 'awaiting_authentication');
assert.equal(awaiting.staticBearerConfigured, true);

const bearer = readMcpAuthenticationStatus({
  lastAuthenticatedAt: new Date(now + 1).toISOString(),
  lastAuthMode: 'static_bearer'
}, { staticBearerConfigured: true });
assert.equal(bearer.status, 'bearer_authorized');
assert.equal(bearer.authMode, 'static_bearer');
assert.equal(bearer.staticBearerConfigured, true);

const local = readMcpAuthenticationStatus({
  lastAuthenticatedAt: new Date(now + 2).toISOString(),
  lastAuthMode: 'local_no_auth'
});
assert.equal(local.status, 'local_authorized');
assert.equal(local.authMode, 'local_no_auth');

const failed = readMcpAuthenticationStatus({
  lastAuthenticationFailureAt: new Date(now + 3).toISOString()
});
assert.equal(failed.status, 'authentication_failed');

console.log('MCP authentication status reflects local bearer evidence only.');
