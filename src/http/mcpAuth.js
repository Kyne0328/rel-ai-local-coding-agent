import { createLocalAdminPolicy } from '../mcp/authorizationPolicy.js';
import { isAuthorized, sendJson } from './io.js';

function mcpAuthorization(req, options = {}) {
  if (isAuthorized(req, { ...options, allowNoAuth: false })) {
    return localAuthorization('static_bearer', 'secure-tunnel');
  }
  if (!options.token && options.allowNoAuth === true) {
    return localAuthorization('local_no_auth', 'local-no-auth');
  }
  return null;
}

function localAuthorization(authMode, clientId) {
  return {
    authMode,
    authInfo: { clientId, scopes: ['mcp'], authorizationPolicy: createLocalAdminPolicy() }
  };
}

function unauthorizedMcp(res) {
  if (res.headersSent) return;
  res.setHeader('WWW-Authenticate', 'Bearer realm="rel-ai-local"');
  sendJson(res, 401, {
    ok: false,
    error: 'Authorization required. The local MCP endpoint accepts only the private Rel.AI bearer token supplied by OpenAI tunnel-client.'
  });
}

export { mcpAuthorization, unauthorizedMcp };
