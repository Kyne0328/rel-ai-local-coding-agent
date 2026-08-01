import * as oauth from '../oauthProvider.js';
import { readConfig } from '../config.js';
import { runSpan } from '../telemetry.js';
import { oauthErrorPage, resolveBaseUrl } from './auth.js';
import { readFormOrJsonBody, sendHtml, sendJson } from './io.js';
import {
  MCP_PROTOCOL_VERSION,
  expectedMcpName,
  handleMcpConnectionState,
  handleMcpDelete,
  handleMcpGetDiagnostic,
  handleMcpRecovery,
  handleMcpStreamable,
  shutdownMcpTransport,
  transportSecurityOptions,
  validateMcpRequestHeaders
} from './mcpTransport.js';

function getMcpAccess(pathname) {
  return pathname === '/mcp' ? { kind: 'streamable-http' } : { kind: 'none' };
}

async function handleOauthProtectedResource(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  sendJson(ctx.res, 200, oauth.protectedResourceMetadata(baseUrl));
}

async function handleOauthMetadata(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  sendJson(ctx.res, 200, oauth.authorizationServerMetadata(baseUrl));
}

async function handleRegister(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.register', { 'oauth.issuer': baseUrl }, async () => {
    const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const result = oauth.registerClient(body, baseUrl);
    sendJson(ctx.res, result.error ? 400 : 201, result);
  }, { carrier: ctx.req.headers });
}

function authorizationQuery(parsed) {
  return Object.fromEntries(parsed.searchParams.entries());
}

async function handleAuthorizeGet(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.authorize', { 'oauth.issuer': baseUrl, 'oauth.phase': 'request' }, async () => {
    const check = oauth.validateAuthorizationRequest(authorizationQuery(ctx.parsed), { issuer: baseUrl });
    if (!check.ok) {
      if (check.redirectError && check.redirectUri) {
        redirectAuthorizationError(ctx, check, baseUrl);
        return;
      }
      sendHtml(ctx.res, 400, oauthErrorPage(check.error_description));
      return;
    }
    sendHtml(ctx.res, 200, oauth.renderLoginPage(check.request, baseUrl));
  }, { carrier: ctx.req.headers });
}

async function handleAuthorizePost(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.authorize', { 'oauth.issuer': baseUrl, 'oauth.phase': 'approval' }, async () => {
    const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const check = oauth.validateAuthorizationRequest(body, { issuer: baseUrl });
    if (!check.ok) {
      if (check.redirectError && check.redirectUri) {
        redirectAuthorizationError(ctx, check, baseUrl);
        return;
      }
      sendHtml(ctx.res, 400, oauthErrorPage(check.error_description));
      return;
    }
    if (!oauth.verifyLogin(body.dashboard_token, ctx.options.token)) {
      sendHtml(ctx.res, 401, oauth.renderLoginPage(check.request, baseUrl, {
        error: 'Incorrect approval token. Copy the current token from Rel.AI Settings > Connection and try again.'
      }));
      return;
    }
    const code = oauth.issueAuthorizationCode(check.request, baseUrl);
    if (typeof ctx.options.onOAuthAuthorized === 'function') {
      try { ctx.options.onOAuthAuthorized(); } catch (error) { debug('OAuth authorization callback', error); }
    }
    ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.request.redirectUri, { code, state: check.request.state, iss: baseUrl }) });
    ctx.res.end();
  }, { carrier: ctx.req.headers });
}

function redirectAuthorizationError(ctx, check, baseUrl) {
  ctx.res.writeHead(302, {
    Location: oauth.buildRedirectUrl(check.redirectUri, {
      error: check.error,
      error_description: check.error_description,
      state: check.state,
      iss: check.issuer || baseUrl
    })
  });
  ctx.res.end();
}

async function handleToken(ctx) {
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.token', { 'oauth.issuer': baseUrl }, async () => {
    const body = await readFormOrJsonBody(ctx.req, ctx.options.maxBodyBytes);
    const result = oauth.exchangeToken(body, baseUrl);
    sendJson(ctx.res, result.status, result.body);
  }, { carrier: ctx.req.headers });
}

function oauthWellKnownPaths(baseUrl) {
  const issuer = new URL(oauth.canonicalIssuer(baseUrl));
  const issuerPath = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '');
  return {
    protectedResource: '/.well-known/oauth-protected-resource/mcp',
    authorizationServer: `/.well-known/oauth-authorization-server${issuerPath}`,
    openidConfiguration: `${issuerPath}/.well-known/openid-configuration`
  };
}

function debug(context, error) {
  if (process.env.REL_AI_MCP_DEBUG) console.error(`[rel-ai-mcp] ${context}:`, error);
}

export {
  MCP_PROTOCOL_VERSION,
  expectedMcpName,
  getMcpAccess,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleMcpConnectionState,
  handleMcpDelete,
  handleMcpGetDiagnostic,
  handleMcpRecovery,
  handleMcpStreamable,
  shutdownMcpTransport,
  handleOauthMetadata,
  handleOauthProtectedResource,
  handleRegister,
  handleToken,
  oauthWellKnownPaths,
  transportSecurityOptions,
  validateMcpRequestHeaders
};
