import { HttpError, readBodyBytes, readJson } from './protocol.js';
import { bearerToken, randomBase64Url, sha256Base64Url } from './security.js';

const AUTHORIZATION_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_BODY_LIMIT = 32 * 1024;
const SUPPORTED_SCOPES = new Set(['mcp', 'offline_access']);
const REQUIRED_RESOURCE_SCOPE = 'mcp';

async function handleOAuthRoute(request, env) {
  const url = new URL(request.url);
  const key = `${request.method.toUpperCase()} ${url.pathname}`;
  if (key === 'GET /.well-known/oauth-protected-resource'
    || key === 'GET /.well-known/oauth-protected-resource/mcp') {
    return protectedResourceMetadata(request, env);
  }
  if (key === 'GET /.well-known/oauth-authorization-server') {
    return authorizationServerMetadata(request, env);
  }
  if (key === 'POST /register') return registerClient(request, env);
  if (key === 'GET /authorize') return beginAuthorization(request, env);
  if (key === 'POST /authorize') return completeAuthorization(request, env);
  if (key === 'POST /token') return exchangeToken(request, env);
  if (key === 'POST /revoke') return revokeToken(request, env);
  return null;
}

function protectedResourceMetadata(request, env) {
  const urls = oauthUrls(request, env);
  return oauthJson({
    resource: urls.resource,
    resource_name: 'Rel.AI Cloud MCP',
    authorization_servers: [urls.issuer],
    scopes_supported: ['mcp', 'offline_access'],
    bearer_methods_supported: ['header']
  });
}

function authorizationServerMetadata(request, env) {
  const urls = oauthUrls(request, env);
  return oauthJson({
    issuer: urls.issuer,
    authorization_endpoint: urls.authorization,
    token_endpoint: urls.token,
    registration_endpoint: urls.registration,
    revocation_endpoint: urls.revocation,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp', 'offline_access']
  });
}

async function registerClient(request, env) {
  const body = await readJson(request, OAUTH_BODY_LIMIT);
  let redirectUris;
  let grantTypes;
  let responseTypes;
  try {
    redirectUris = normalizeRedirectUris(body.redirect_uris);
    grantTypes = normalizeStringArray(body.grant_types, ['authorization_code', 'refresh_token']);
    responseTypes = normalizeStringArray(body.response_types, ['code']);
  } catch (error) {
    if (error instanceof HttpError) return oauthError('invalid_client_metadata', error.message);
    throw error;
  }
  const tokenEndpointAuthMethod = String(body.token_endpoint_auth_method || 'none');
  if (tokenEndpointAuthMethod !== 'none') {
    return oauthError('invalid_client_metadata', 'Only public clients using token_endpoint_auth_method=none are supported.');
  }
  if (!grantTypes.includes('authorization_code') || grantTypes.some(value => !['authorization_code', 'refresh_token'].includes(value))) {
    return oauthError('invalid_client_metadata', 'grant_types must include authorization_code and may include refresh_token.');
  }
  if (responseTypes.length !== 1 || responseTypes[0] !== 'code') {
    return oauthError('invalid_client_metadata', 'Only response_types=["code"] is supported.');
  }
  const clientName = cleanText(body.client_name || 'MCP client', 120);
  const clientId = `relai_client_${randomBase64Url(24)}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO oauth_clients
      (client_id, redirect_uris_json, client_name, token_endpoint_auth_method, grant_types_json, response_types_json, created_at, revoked_at)
     VALUES (?, ?, ?, 'none', ?, ?, ?, NULL)`
  ).bind(clientId, JSON.stringify(redirectUris), clientName, JSON.stringify(grantTypes), JSON.stringify(responseTypes), now).run();

  return oauthJson({
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    redirect_uris: redirectUris,
    client_name: clientName,
    token_endpoint_auth_method: 'none',
    grant_types: grantTypes,
    response_types: responseTypes
  }, 201);
}

async function beginAuthorization(request, env) {
  const url = new URL(request.url);
  const urls = oauthUrls(request, env);
  const clientId = cleanText(url.searchParams.get('client_id'), 200);
  const client = await loadClient(env, clientId);
  if (!client) return authorizationHtmlError('Unknown or revoked OAuth client.');

  const redirectUri = String(url.searchParams.get('redirect_uri') || '');
  if (!client.redirectUris.includes(redirectUri)) return authorizationHtmlError('The redirect URI is not registered for this client.');
  if (url.searchParams.get('response_type') !== 'code') {
    return redirectOAuthError(redirectUri, url.searchParams.get('state'), 'unsupported_response_type', 'Only authorization code responses are supported.');
  }

  const codeChallenge = String(url.searchParams.get('code_challenge') || '');
  const codeChallengeMethod = String(url.searchParams.get('code_challenge_method') || '');
  if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return redirectOAuthError(redirectUri, url.searchParams.get('state'), 'invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }

  const resource = String(url.searchParams.get('resource') || '');
  if (resource !== urls.resource) {
    return redirectOAuthError(redirectUri, url.searchParams.get('state'), 'invalid_target', 'The requested resource is not supported.');
  }

  let scope;
  try {
    scope = normalizeScope(url.searchParams.get('scope') || 'mcp');
  } catch (error) {
    return redirectOAuthError(redirectUri, url.searchParams.get('state'), 'invalid_scope', error.message);
  }
  const requestId = `authreq_${randomBase64Url(24)}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_authorization_requests WHERE expires_at <= ? OR used_at IS NOT NULL').bind(now),
    env.DB.prepare(
      `INSERT INTO oauth_authorization_requests
        (request_id, client_id, redirect_uri, state, scope, resource, code_challenge, created_at, expires_at, used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).bind(
      requestId,
      clientId,
      redirectUri,
      cleanText(url.searchParams.get('state'), 2048),
      scope,
      resource,
      codeChallenge,
      now,
      now + AUTHORIZATION_REQUEST_TTL_MS
    )
  ]);
  return authorizationPage({ requestId, clientName: client.clientName, scope });
}

async function completeAuthorization(request, env) {
  const form = await readForm(request, OAUTH_BODY_LIMIT);
  const requestId = cleanText(form.get('request_id'), 200);
  const pending = await env.DB.prepare(
    `SELECT r.request_id, r.client_id, r.redirect_uri, r.state, r.scope, r.resource, r.code_challenge,
            r.expires_at, r.used_at, c.client_name
       FROM oauth_authorization_requests r
       JOIN oauth_clients c ON c.client_id = r.client_id
      WHERE r.request_id = ? AND c.revoked_at IS NULL`
  ).bind(requestId).first();
  if (!pending || Number(pending.expires_at) <= Date.now() || pending.used_at != null) {
    return authorizationHtmlError('This authorization request is invalid or expired. Restart the connection from ChatGPT.');
  }

  if (String(form.get('action') || '') === 'deny') {
    await env.DB.prepare('UPDATE oauth_authorization_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL')
      .bind(Date.now(), requestId)
      .run();
    return redirectOAuthError(String(pending.redirect_uri), pending.state, 'access_denied', 'The user denied this request.');
  }

  const normalizedCode = normalizePairingCode(form.get('pairing_code'));
  if (!/^[A-Z2-9]{8}$/.test(normalizedCode)) {
    return authorizationPage({
      requestId,
      clientName: pending.client_name,
      scope: pending.scope,
      error: 'Enter the eight-character pairing code shown in the Rel.AI desktop app.'
    }, 400);
  }
  const pairingHash = await sha256Base64Url(normalizedCode);
  const now = Date.now();
  const pairing = await env.DB.prepare(
    `SELECT pairing_codes.device_id
       FROM pairing_codes
       JOIN devices ON devices.device_id = pairing_codes.device_id
      WHERE pairing_codes.code_hash = ?
        AND pairing_codes.claimed_at IS NULL
        AND pairing_codes.expires_at > ?
        AND devices.status = 'active'`
  ).bind(pairingHash, now).first();
  if (!pairing) {
    return authorizationPage({
      requestId,
      clientName: pending.client_name,
      scope: pending.scope,
      error: 'That pairing code is invalid, expired, or already used. Generate a new code in Rel.AI.'
    }, 400);
  }

  const requestClaim = await env.DB.prepare(
    `UPDATE oauth_authorization_requests
        SET used_at = ?
      WHERE request_id = ? AND used_at IS NULL AND expires_at > ?
      RETURNING request_id`
  ).bind(now, requestId, now).first();
  if (!requestClaim) return authorizationHtmlError('This authorization request was already completed.');

  const pairingClaim = await env.DB.prepare(
    `UPDATE pairing_codes
        SET claimed_at = ?
      WHERE code_hash = ? AND claimed_at IS NULL AND expires_at > ?
      RETURNING device_id`
  ).bind(now, pairingHash, now).first();
  if (!pairingClaim) {
    return redirectOAuthError(String(pending.redirect_uri), pending.state, 'access_denied', 'The pairing code could not be claimed.');
  }

  const authorizationCode = `relai_code_${randomBase64Url(32)}`;
  const authorizationCodeHash = await sha256Base64Url(authorizationCode);
  await env.DB.prepare(
    `INSERT INTO oauth_authorization_codes
      (code_hash, client_id, device_id, redirect_uri, scope, resource, code_challenge, created_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).bind(
    authorizationCodeHash,
    pending.client_id,
    pairingClaim.device_id,
    pending.redirect_uri,
    pending.scope,
    pending.resource,
    pending.code_challenge,
    now,
    now + AUTHORIZATION_CODE_TTL_MS
  ).run();

  const redirect = new URL(String(pending.redirect_uri));
  redirect.searchParams.set('code', authorizationCode);
  if (pending.state) redirect.searchParams.set('state', String(pending.state));
  return redirectResponse(redirect.href);
}

async function exchangeToken(request, env) {
  const form = await readForm(request, OAUTH_BODY_LIMIT);
  const grantType = String(form.get('grant_type') || '');
  if (grantType === 'authorization_code') return exchangeAuthorizationCode(form, request, env);
  if (grantType === 'refresh_token') return exchangeRefreshToken(form, request, env);
  return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token grants are supported.');
}

async function exchangeAuthorizationCode(form, request, env) {
  const clientId = cleanText(form.get('client_id'), 200);
  const client = await loadClient(env, clientId);
  if (!client) return oauthError('invalid_client', 'The OAuth client is unknown or revoked.', 401);
  const authorizationCode = String(form.get('code') || '');
  const redirectUri = String(form.get('redirect_uri') || '');
  const codeVerifier = String(form.get('code_verifier') || '');
  const resource = String(form.get('resource') || '');
  if (!authorizationCode || !redirectUri || !validCodeVerifier(codeVerifier)) {
    return oauthError('invalid_request', 'code, redirect_uri, and a valid PKCE code_verifier are required.');
  }
  const urls = oauthUrls(request, env);
  if (resource !== urls.resource) return oauthError('invalid_target', 'The requested resource is not supported.');

  const codeHash = await sha256Base64Url(authorizationCode);
  const row = await env.DB.prepare(
    `SELECT code_hash, client_id, device_id, redirect_uri, scope, resource, code_challenge, expires_at, used_at
       FROM oauth_authorization_codes WHERE code_hash = ?`
  ).bind(codeHash).first();
  if (!row || row.used_at != null || Number(row.expires_at) <= Date.now()
    || row.client_id !== clientId || row.redirect_uri !== redirectUri || row.resource !== resource) {
    return oauthError('invalid_grant', 'The authorization code is invalid, expired, or already used.');
  }
  const calculatedChallenge = await sha256Base64Url(codeVerifier);
  if (!constantTimeEqual(calculatedChallenge, String(row.code_challenge))) {
    return oauthError('invalid_grant', 'The PKCE code verifier is invalid.');
  }

  const now = Date.now();
  const consumed = await env.DB.prepare(
    `UPDATE oauth_authorization_codes SET used_at = ?
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
      RETURNING device_id`
  ).bind(now, codeHash, now).first();
  if (!consumed) return oauthError('invalid_grant', 'The authorization code was already used.');
  return issueTokens(env, {
    clientId,
    deviceId: String(row.device_id),
    scope: String(row.scope),
    resource: String(row.resource),
    issueRefreshToken: scopeSet(row.scope).has('offline_access')
  });
}

async function exchangeRefreshToken(form, request, env) {
  const clientId = cleanText(form.get('client_id'), 200);
  if (!await loadClient(env, clientId)) return oauthError('invalid_client', 'The OAuth client is unknown or revoked.', 401);
  const refreshToken = String(form.get('refresh_token') || '');
  if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required.');
  const urls = oauthUrls(request, env);
  const resource = String(form.get('resource') || urls.resource);
  if (resource !== urls.resource) return oauthError('invalid_target', 'The requested resource is not supported.');

  const tokenHash = await sha256Base64Url(refreshToken);
  const row = await env.DB.prepare(
    `SELECT token_hash, client_id, device_id, scope, resource, expires_at, revoked_at
       FROM oauth_refresh_tokens WHERE token_hash = ?`
  ).bind(tokenHash).first();
  if (!row || row.revoked_at != null || Number(row.expires_at) <= Date.now()
    || row.client_id !== clientId || row.resource !== resource) {
    return oauthError('invalid_grant', 'The refresh token is invalid, expired, or revoked.');
  }

  const now = Date.now();
  const replacementToken = `relai_refresh_${randomBase64Url(32)}`;
  const replacementHash = await sha256Base64Url(replacementToken);
  const rotated = await env.DB.prepare(
    `UPDATE oauth_refresh_tokens
        SET revoked_at = ?, replaced_by_hash = ?
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
      RETURNING device_id`
  ).bind(now, replacementHash, tokenHash, now).first();
  if (!rotated) return oauthError('invalid_grant', 'The refresh token was already used.');
  return issueTokens(env, {
    clientId,
    deviceId: String(row.device_id),
    scope: String(row.scope),
    resource: String(row.resource),
    issueRefreshToken: true,
    refreshToken: replacementToken,
    refreshTokenHash: replacementHash
  });
}

async function issueTokens(env, options) {
  const now = Date.now();
  const accessToken = `relai_access_${randomBase64Url(32)}`;
  const accessTokenHash = await sha256Base64Url(accessToken);
  let refreshToken = options.refreshToken || '';
  let refreshTokenHash = options.refreshTokenHash || '';
  if (options.issueRefreshToken && !refreshToken) {
    refreshToken = `relai_refresh_${randomBase64Url(32)}`;
    refreshTokenHash = await sha256Base64Url(refreshToken);
  }
  const statements = [
    env.DB.prepare(
      `INSERT INTO oauth_access_tokens
        (token_hash, client_id, device_id, scope, resource, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
    ).bind(accessTokenHash, options.clientId, options.deviceId, options.scope, options.resource, now, now + ACCESS_TOKEN_TTL_MS)
  ];
  if (options.issueRefreshToken) {
    statements.push(env.DB.prepare(
      `INSERT INTO oauth_refresh_tokens
        (token_hash, client_id, device_id, scope, resource, created_at, expires_at, revoked_at, replaced_by_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).bind(refreshTokenHash, options.clientId, options.deviceId, options.scope, options.resource, now, now + REFRESH_TOKEN_TTL_MS));
  }
  await env.DB.batch(statements);
  return oauthJson({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: options.scope,
    ...(options.issueRefreshToken ? { refresh_token: refreshToken } : {})
  }, 200, { pragma: 'no-cache' });
}

async function revokeToken(request, env) {
  const form = await readForm(request, OAUTH_BODY_LIMIT);
  const token = String(form.get('token') || '');
  const clientId = cleanText(form.get('client_id'), 200);
  if (clientId && !await loadClient(env, clientId)) return oauthError('invalid_client', 'The OAuth client is unknown or revoked.', 401);
  if (token) {
    const tokenHash = await sha256Base64Url(token);
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE oauth_access_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ? AND (? = \'\' OR client_id = ?)'
      ).bind(now, tokenHash, clientId, clientId),
      env.DB.prepare(
        'UPDATE oauth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ? AND (? = \'\' OR client_id = ?)'
      ).bind(now, tokenHash, clientId, clientId)
    ]);
  }
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } });
}

async function authorizeMcpRequest(request, env) {
  const urls = oauthUrls(request, env);
  const token = bearerToken(request);
  if (!token) return { response: oauthUnauthorized(urls, 'invalid_token', 'A bearer access token is required.') };
  const tokenHash = await sha256Base64Url(token);
  const row = await env.DB.prepare(
    `SELECT t.device_id, t.scope, t.resource, t.expires_at
       FROM oauth_access_tokens t
       JOIN oauth_clients c ON c.client_id = t.client_id
       JOIN devices d ON d.device_id = t.device_id
      WHERE t.token_hash = ?
        AND t.revoked_at IS NULL
        AND c.revoked_at IS NULL
        AND d.status = 'active'`
  ).bind(tokenHash).first();
  if (!row || Number(row.expires_at) <= Date.now() || row.resource !== urls.resource) {
    return { response: oauthUnauthorized(urls, 'invalid_token', 'The access token is invalid, expired, revoked, or intended for another resource.') };
  }
  if (!scopeSet(row.scope).has(REQUIRED_RESOURCE_SCOPE)) {
    return { response: oauthForbidden(urls, 'The access token does not grant the mcp scope.') };
  }
  return { token: row };
}

function oauthUnauthorized(urls, error, description) {
  return oauthErrorJson('invalid_token', description, 401, {
    'www-authenticate': bearerChallenge(urls, { error, description })
  });
}

function oauthForbidden(urls, description) {
  return oauthErrorJson('insufficient_scope', description, 403, {
    'www-authenticate': bearerChallenge(urls, { error: 'insufficient_scope', description })
  });
}

function bearerChallenge(urls, options = {}) {
  const values = [
    'Bearer realm="rel-ai-cloud"',
    `resource_metadata="${urls.protectedResourceMetadata}"`,
    'scope="mcp offline_access"'
  ];
  if (options.error) values.push(`error="${escapeHeaderValue(options.error)}"`);
  if (options.description) values.push(`error_description="${escapeHeaderValue(options.description)}"`);
  return values.join(', ');
}

async function loadClient(env, clientId) {
  if (!clientId) return null;
  const row = await env.DB.prepare(
    `SELECT client_id, redirect_uris_json, client_name, grant_types_json, response_types_json
       FROM oauth_clients WHERE client_id = ? AND revoked_at IS NULL`
  ).bind(clientId).first();
  if (!row) return null;
  try {
    return {
      clientId: String(row.client_id),
      redirectUris: JSON.parse(String(row.redirect_uris_json)),
      clientName: cleanText(row.client_name || 'MCP client', 120),
      grantTypes: JSON.parse(String(row.grant_types_json)),
      responseTypes: JSON.parse(String(row.response_types_json))
    };
  } catch {
    return null;
  }
}

function oauthUrls(request, env) {
  const requestedOrigin = new URL(request.url).origin;
  const configured = String(env.PUBLIC_BASE_URL || requestedOrigin).replace(/\/$/, '');
  const base = new URL(configured);
  if (base.protocol !== 'https:' && !isLoopbackHost(base.hostname)) {
    throw new HttpError(500, 'INVALID_PUBLIC_BASE_URL', 'PUBLIC_BASE_URL must use HTTPS.');
  }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new HttpError(500, 'INVALID_PUBLIC_BASE_URL', 'PUBLIC_BASE_URL must be an origin without credentials, path, query, or fragment.');
  }
  const issuer = base.origin;
  return {
    issuer,
    resource: `${issuer}/mcp`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource`,
    authorization: `${issuer}/authorize`,
    token: `${issuer}/token`,
    registration: `${issuer}/register`,
    revocation: `${issuer}/revoke`
  };
}

function normalizeRedirectUris(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new HttpError(400, 'INVALID_CLIENT_METADATA', 'redirect_uris must contain between one and ten URIs.');
  }
  const unique = [...new Set(value.map(item => String(item || '')))];
  for (const item of unique) {
    let url;
    try { url = new URL(item); } catch { throw new HttpError(400, 'INVALID_CLIENT_METADATA', 'Every redirect URI must be an absolute URI.'); }
    const secure = url.protocol === 'https:';
    const loopback = url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if ((!secure && !loopback) || url.username || url.password || url.hash) {
      throw new HttpError(400, 'INVALID_CLIENT_METADATA', 'Redirect URIs must use HTTPS, except HTTP loopback addresses, and must not contain credentials or fragments.');
    }
  }
  return unique;
}

function normalizeStringArray(value, fallback) {
  if (value == null) return [...fallback];
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new HttpError(400, 'INVALID_CLIENT_METADATA', 'OAuth metadata arrays must contain between one and ten values.');
  }
  return [...new Set(value.map(item => cleanText(item, 100)).filter(Boolean))];
}

function normalizeScope(value) {
  const scopes = [...new Set(String(value || '').split(/\s+/).filter(Boolean))];
  if (!scopes.includes(REQUIRED_RESOURCE_SCOPE)) throw new Error('The mcp scope is required.');
  if (scopes.some(scope => !SUPPORTED_SCOPES.has(scope))) throw new Error('One or more requested scopes are unsupported.');
  return ['mcp', ...(scopes.includes('offline_access') ? ['offline_access'] : [])].join(' ');
}

function scopeSet(value) {
  return new Set(String(value || '').split(/\s+/).filter(Boolean));
}

function normalizePairingCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function validCodeVerifier(value) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(String(value || ''));
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(index % Math.max(b.length, 1)) || 0);
  }
  return difference === 0;
}

async function readForm(request, maxBytes) {
  const bytes = await readBodyBytes(request, maxBytes);
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, 'FORM_ENCODING_REQUIRED', 'OAuth form endpoints require application/x-www-form-urlencoded.');
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

function authorizationPage(options, status = 200) {
  const clientName = escapeHtml(options.clientName || 'MCP client');
  const scope = escapeHtml(options.scope || 'mcp');
  const error = options.error ? `<div class="error" role="alert">${escapeHtml(options.error)}</div>` : '';
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Rel.AI</title><style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#f9fafb}.card{width:min(92vw,460px);background:#1f2937;border:1px solid #374151;border-radius:18px;padding:28px;box-shadow:0 20px 60px #0008}h1{margin:0 0 8px;font-size:1.6rem}p{line-height:1.5;color:#d1d5db}.scope{padding:10px 12px;background:#111827;border-radius:10px;font-family:ui-monospace,monospace}label{display:block;margin:20px 0 8px;font-weight:700}input{box-sizing:border-box;width:100%;padding:14px;border-radius:10px;border:1px solid #4b5563;background:#111827;color:#fff;font:inherit;text-transform:uppercase;letter-spacing:.12em}.actions{display:flex;gap:10px;margin-top:18px}button{flex:1;padding:12px;border:0;border-radius:10px;font:inherit;font-weight:700;cursor:pointer}.approve{background:#f9fafb;color:#111827}.deny{background:#374151;color:#f9fafb}.error{margin-top:16px;padding:12px;border-radius:10px;background:#7f1d1d;color:#fee2e2}small{display:block;margin-top:16px;color:#9ca3af;line-height:1.4}</style></head>
<body><main class="card"><h1>Connect Rel.AI</h1><p><strong>${clientName}</strong> is requesting access to the Rel.AI desktop paired with this code.</p><div class="scope">Scopes: ${scope}</div>${error}
<form method="post" action="/authorize"><input type="hidden" name="request_id" value="${escapeHtml(options.requestId)}"><label for="pairing_code">Pairing code</label><input id="pairing_code" name="pairing_code" autocomplete="one-time-code" inputmode="text" maxlength="9" placeholder="ABCD-EFGH" required autofocus><div class="actions"><button class="deny" type="submit" name="action" value="deny" formnovalidate>Cancel</button><button class="approve" type="submit" name="action" value="approve">Connect</button></div></form><small>The code is single-use and generated by the Rel.AI desktop app. Rel.AI Cloud does not store repository contents.</small></main></body></html>`;
  return new Response(body, { status, headers: htmlHeaders() });
}

function authorizationHtmlError(message) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rel.AI authorization error</title></head><body><main><h1>Authorization could not continue</h1><p>${escapeHtml(message)}</p></main></body></html>`;
  return new Response(body, { status: 400, headers: htmlHeaders() });
}

function htmlHeaders() {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  };
}

function redirectOAuthError(redirectUri, state, error, description) {
  const url = new URL(String(redirectUri));
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', cleanText(description, 300));
  if (state) url.searchParams.set('state', String(state));
  return redirectResponse(url.href);
}

function redirectResponse(location) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

function oauthJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders }
  });
}

function oauthError(error, description, status = 400) {
  return oauthErrorJson(error, description, status);
}

function oauthErrorJson(error, description, status = 400, headers = {}) {
  return oauthJson({ error, error_description: cleanText(description, 500) }, status, headers);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function escapeHeaderValue(value) {
  return String(value || '').replace(/["\\\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value, limit = 500) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function isLoopbackHost(hostname) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

export {
  authorizeMcpRequest,
  constantTimeEqual,
  handleOAuthRoute,
  normalizeRedirectUris,
  normalizeScope,
  oauthUrls,
  validCodeVerifier
};
