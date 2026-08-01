import * as connection from "../connectionProfile.js";
import * as oauth from "../oauthProvider.js";
import { isAuthorized, timingSafeEqual, sendJson } from "./io.js";
import * as dashboardSessions from "./dashboardSessions.js";
import { ERROR_CODES, errorPayload } from "../desktopUxContracts.js";

// The active process is authoritative. Persisted profile state is only a fallback.
function resolveBaseUrl(options = {}) {
  return resolveBaseUrlDetails(options).baseUrl;
}

function resolveBaseUrlDetails(options = {}) {
  const profile = connection.readConnectionProfile();
  const candidates = [
    ['active_runtime', options.activeRuntimeUrl || options.runtimePublicUrl || options.activePublicUrl || options.proxyVisibleOrigin],
    ['explicit_process', options.publicUrl],
    ['managed_connection', options.managedPublicUrl || options.tunnelUrl || profile.activePublicUrl || profile.managedPublicUrl || profile.tunnelUrl],
    ['persisted_profile', profile.publicUrl],
    ['loopback_fallback', connection.localBaseUrl ? connection.localBaseUrl(options.host || '127.0.0.1', options.port || 3333) : `http://${options.host || '127.0.0.1'}:${options.port || 3333}`]
  ];
  const selected = candidates.find(([, value]) => String(value || '').trim());
  const baseUrl = oauth.canonicalIssuer(selected?.[1]);
  const persistedUrl = canonicalOptional(profile.publicUrl);
  const diagnostics = [];
  if (persistedUrl && persistedUrl !== baseUrl && selected?.[0] !== 'persisted_profile') {
    diagnostics.push({
      code: 'OAUTH_ISSUER_PROFILE_DISAGREEMENT',
      activeIssuer: baseUrl,
      persistedIssuer: persistedUrl,
      selectedSource: selected?.[0] || 'loopback_fallback',
      action: 'The active runtime issuer remains authoritative; update the persisted profile only if the runtime URL is intended to change.'
    });
  }
  return {
    baseUrl,
    source: selected?.[0] || 'loopback_fallback',
    persistedUrl,
    diagnostics
  };
}

function canonicalOptional(value) {
  if (!String(value || '').trim()) return '';
  try { return oauth.canonicalIssuer(value); } catch { return ''; }
}

function bearerToken(req) {
  const header = req?.headers?.authorization || "";
  if (!/^Bearer\s+/i.test(header)) return "";
  return header.slice(7).trim();
}

// An OAuth access token issued by our /token endpoint is a valid bearer for /mcp.
function oauthAuthorization(req, options) {
  const token = bearerToken(req);
  if (!token) return null;
  return oauth.validateAccessToken(token, resolveBaseUrl(options));
}

function isOAuthAuthorized(req, options) {
  return Boolean(oauthAuthorization(req, options));
}

// MCP access is granted by either the static REL_AI_MCP_TOKEN bearer (local/API
// clients) or an OAuth-issued access token (the ChatGPT OAuth connector). There is
// no unauthenticated path.
function isMcpAuthorized(req, options) {
  return isAuthorized(req, options) || isOAuthAuthorized(req, options);
}

function unauthorizedMcp(res, baseUrl, req) {
  if (res.headersSent) return;
  res.setHeader("WWW-Authenticate", oauth.wwwAuthenticateHeader(baseUrl, "invalid_token"));
  const code = bearerToken(req)
    ? ERROR_CODES.APPROVAL_TOKEN_REJECTED
    : ERROR_CODES.APPROVAL_TOKEN_REQUIRED;
  sendJson(res, 401, errorPayload(
    code,
    "Authorization required. Add this server in ChatGPT with Authentication: OAuth, or send a bearer token."
  ));
}

function hasDashboardQueryToken(parsed, options) {
  if (!options.token) return false;
  const supplied = parsed.searchParams.get("token");
  return supplied != null && timingSafeEqual(supplied, options.token);
}

function isDashboardAuthorized(req, parsed, options, res) {
  if (isAuthorized(req, options) || hasDashboardQueryToken(parsed, options)) return true;
  if (dashboardSessions.validateDashboardSession(req, options.token)) return true;
  const bootstrap = parsed.searchParams.get("bootstrap");
  if (!bootstrap) return false;
  const sessionId = dashboardSessions.consumeDashboardBootstrap(bootstrap, options.token);
  if (!sessionId) return false;
  dashboardSessions.setDashboardSessionCookie(res, sessionId);
  return true;
}

// Honor an explicit readiness override. The authenticated dashboard sends "0"
// because its secured session already proves access; when the parameter is absent,
// use the configured release.requireHttpToken default.
function resolveRequireHttpToken(parsed, config) {
  const raw = parsed.searchParams.get("requireHttpToken");
  if (raw != null) return raw !== "0";
  const configured = config?.release?.requireHttpToken;
  return configured !== false;
}

function oauthErrorPage(message) {
  const safe = String(message == null ? "" : message).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cannot authorize</title><link rel="stylesheet" href="/public/oauth.css"></head><body class="oauth-page oauth-error-page"><main class="oauth-card oauth-error-card"><h2>Cannot authorize this connection</h2><p>' + safe + '</p></main></body></html>';
}

export { resolveBaseUrl, resolveBaseUrlDetails, isOAuthAuthorized, oauthAuthorization, bearerToken, isMcpAuthorized, unauthorizedMcp, oauthErrorPage, isDashboardAuthorized, resolveRequireHttpToken };
