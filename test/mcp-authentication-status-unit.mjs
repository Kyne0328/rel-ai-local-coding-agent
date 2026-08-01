import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relai-mcp-auth-status-'));
const previousStateDir = process.env.REL_AI_MCP_STATE_DIR;
process.env.REL_AI_MCP_STATE_DIR = stateRoot;

try {
  const oauth = await import('../src/oauthProvider.js');
  const { readMcpAuthenticationStatus } = await import('../src/mcp/authenticationStatus.js');
  const now = Date.now();

  const approvalRequired = oauth.createEmptyOAuthStore();
  approvalRequired.approvalRequiredAt = now;
  oauth.writeOAuthStore(approvalRequired);

  const required = readMcpAuthenticationStatus({});
  assert.equal(required.status, 'authentication_required');
  assert.equal(required.oauthApprovalRequired, true);

  const bearer = readMcpAuthenticationStatus({
    lastAuthenticatedAt: new Date(now + 1).toISOString(),
    lastAuthMode: 'static_bearer'
  }, { staticBearerConfigured: true });
  assert.equal(bearer.status, 'bearer_authorized');
  assert.equal(bearer.oauthApprovalRequired, true, 'bearer success must not erase the separate OAuth approval marker');
  assert.equal(bearer.staticBearerConfigured, true);

  const oauthAuthorized = readMcpAuthenticationStatus({
    lastAuthenticatedAt: new Date(now + 2).toISOString(),
    lastAuthMode: 'oauth'
  });
  assert.equal(oauthAuthorized.status, 'oauth_authorized');

  const failedStore = oauth.createEmptyOAuthStore();
  oauth.writeOAuthStore(failedStore);
  const failed = readMcpAuthenticationStatus({
    lastAuthenticationFailureAt: new Date(now + 3).toISOString()
  });
  assert.equal(failed.status, 'authentication_failed');

  const approvedStore = oauth.createEmptyOAuthStore();
  const issuer = 'https://example.ngrok.app';
  const clientId = 'relai_client_status_test';
  approvedStore.lastApprovedAt = now;
  approvedStore.clients[clientId] = {
    client_id: clientId,
    issuer,
    application_type: 'web',
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    client_name: 'ChatGPT',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    registered_scope: 'mcp',
    granted_scope: 'mcp',
    created_at: now,
    last_used_at: now
  };
  approvedStore.accessTokens[oauth.secretKey('status-access-token')] = {
    issuer,
    clientId,
    scope: 'mcp',
    resource: `${issuer}/mcp`,
    issuedAt: now,
    expiresAt: now + 60_000
  };
  oauth.writeOAuthStore(approvedStore);
  const approved = readMcpAuthenticationStatus({});
  assert.equal(approved.status, 'oauth_approved');
  assert.equal(approved.oauth.activeAccessTokens, 1);
} finally {
  if (previousStateDir == null) delete process.env.REL_AI_MCP_STATE_DIR;
  else process.env.REL_AI_MCP_STATE_DIR = previousStateDir;
  fs.rmSync(stateRoot, { recursive: true, force: true });
}

console.log('MCP authentication status keeps OAuth approval and accepted credential evidence separate.');
