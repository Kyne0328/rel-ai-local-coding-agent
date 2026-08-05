import * as oauth from '../oauthProvider.js';
import { readConfig } from '../config.js';
import { runSpan } from '../telemetry.js';
import { oauthErrorPage, resolveBaseUrl } from './auth.js';
import { readFormOrJsonBody, sendHtml, sendJson } from './io.js';
import { consumeRequestBudget } from './requestBudget.js';

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
  if (!enforceBudget(ctx, 'oauth-register', { limit: 30, windowMs: 10 * 60 * 1000 })) return;
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.register', { 'oauth.issuer': baseUrl }, async () => {
    const body = await readFormOrJsonBody(ctx.req, Math.min(ctx.options.maxBodyBytes, oauth.DCR_LIMITS.metadataBytes));
    const result = oauth.registerClient(body, baseUrl);
    sendJson(ctx.res, result.error ? Number(result.httpStatus || 400) : 201, result);
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
        redirectAuthorizationError(ctx, check);
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
    const body = await readFormOrJsonBody(ctx.req, Math.min(ctx.options.maxBodyBytes, 64 * 1024));
    const check = oauth.validateAuthorizationRequest(body, { issuer: baseUrl });
    if (!check.ok) {
      if (check.redirectError && check.redirectUri) {
        redirectAuthorizationError(ctx, check);
        return;
      }
      sendHtml(ctx.res, 400, oauthErrorPage(check.error_description));
      return;
    }
    if (!oauth.verifyLogin(body.dashboard_token, ctx.options.token)) {
      if (!enforceAuthorizationFailureBudget(ctx, check.request, baseUrl)) return;
      debug('OAuth approval rejected', `client ${check.request.clientId}`);
      sendHtml(ctx.res, 401, oauth.renderLoginPage(check.request, baseUrl, {
        error: 'Incorrect approval token. Copy the current token from Rel.AI Settings > Connection and try again.'
      }));
      return;
    }
    let code;
    try {
      code = oauth.issueAuthorizationCode({ ...check.request, authorizationPolicy: oauth.authorizationPolicyFromConsent() }, baseUrl);
    } catch (error) {
      debug('OAuth approval failed', error);
      sendHtml(ctx.res, 500, oauthErrorPage('Approval could not be completed. Close this page and try connecting from ChatGPT again.'));
      return;
    }
    if (typeof ctx.options.onOAuthAuthorized === 'function') {
      try { ctx.options.onOAuthAuthorized(); } catch (error) { debug('OAuth authorization callback', error); }
    }
    debug('OAuth approval', `client ${check.request.clientId} redirects to ${check.request.redirectUri}`);
    ctx.res.writeHead(302, { Location: oauth.buildRedirectUrl(check.request.redirectUri, { code, state: check.request.state }) });
    ctx.res.end();
  }, { carrier: ctx.req.headers });
}

function redirectAuthorizationError(ctx, check) {
  ctx.res.writeHead(302, {
    Location: oauth.buildRedirectUrl(check.redirectUri, {
      error: check.error,
      error_description: check.error_description,
      state: check.state
    })
  });
  ctx.res.end();
}

async function handleToken(ctx) {
  if (!enforceBudget(ctx, 'oauth-token', { limit: 60, windowMs: 10 * 60 * 1000 })) return;
  const baseUrl = resolveBaseUrl(ctx.options);
  await runSpan(readConfig(), 'relai.oauth.token', { 'oauth.issuer': baseUrl }, async () => {
    const body = await readFormOrJsonBody(ctx.req, Math.min(ctx.options.maxBodyBytes, 64 * 1024));
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

function enforceBudget(ctx, name, options) {
  const budget = consumeRequestBudget(ctx.req, name, options);
  if (budget.ok) return true;
  ctx.res.setHeader('Retry-After', String(budget.retryAfterSeconds));
  sendJson(ctx.res, 429, { error: 'temporarily_unavailable', error_description: 'Request rate limit exceeded.' });
  return false;
}

function enforceAuthorizationFailureBudget(ctx, request, baseUrl) {
  const budget = consumeRequestBudget(ctx.req, 'oauth-authorize-failure', { limit: 20, windowMs: 10 * 60 * 1000 });
  if (budget.ok) return true;
  sendHtml(ctx.res, 429, oauth.renderLoginPage(request, baseUrl, {
    error: 'Too many incorrect approval tokens. Copy the current token from Rel.AI Settings > Connection and try again.'
  }), { 'Retry-After': String(budget.retryAfterSeconds) });
  return false;
}

function debug(context, error) {
  if (process.env.REL_AI_MCP_DEBUG) console.error(`[rel-ai-mcp] ${context}:`, error);
}

export {
  getMcpAccess,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleOauthMetadata,
  handleOauthProtectedResource,
  handleRegister,
  handleToken,
  oauthWellKnownPaths
};
