import * as oauth from '../oauthProvider.js';
import { ERROR_CODES, errorPayload } from '../desktopUxContracts.js';
import { createLocalAdminPolicy } from '../mcp/authorizationPolicy.js';
import { resolveBaseUrl } from './auth.js';
import { isAuthorized, sendJson } from './io.js';

function bearerToken(req) {
  const header = req?.headers?.authorization || '';
  if (!/^Bearer\s+/i.test(header)) return '';
  return header.slice(7).trim();
}

function oauthAuthorization(req, options) {
  const token = bearerToken(req);
  return token ? oauth.validateAccessToken(token, resolveBaseUrl(options)) : null;
}

function mcpAuthorization(req, options = {}) {
  const oauthGrant = oauthAuthorization(req, options);
  if (oauthGrant) return { authMode: 'oauth', authInfo: oauthGrant };

  const staticAuthorized = isAuthorized(req, { ...options, allowNoAuth: false });
  const publicRuntime = Boolean(String(
    options.publicUrl || options.runtimePublicUrl || options.activeRuntimeUrl || ''
  ).trim());
  if (staticAuthorized && (options.allowStaticMcpBearer === true || !publicRuntime)) {
    return localAuthorization('static_bearer', 'static-bearer');
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

function unauthorizedMcp(res, baseUrl, req) {
  if (res.headersSent) return;
  res.setHeader('WWW-Authenticate', oauth.wwwAuthenticateHeader(baseUrl, 'invalid_token'));
  const code = bearerToken(req)
    ? ERROR_CODES.APPROVAL_TOKEN_REJECTED
    : ERROR_CODES.APPROVAL_TOKEN_REQUIRED;
  sendJson(res, 401, errorPayload(
    code,
    'Authorization required. Add this server in ChatGPT with Authentication: OAuth, or send a bearer token.'
  ));
}


export {



  mcpAuthorization,

  unauthorizedMcp
};
