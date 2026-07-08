// OAuth 2.1 authorization server for the ChatGPT MCP connector.
//
// This turns the local Rel.AI MCP server into its own OAuth 2.1 authorization
// server + resource server so ChatGPT Developer Mode can use the "OAuth"
// authentication option instead of the secret-in-URL "No Authentication" flow.
//
// Flow (MCP authorization spec, 2025-06-18 + RFC 7591/8707/PKCE):
//   1. POST /mcp with no/invalid token -> 401 + WWW-Authenticate pointing at the
//      protected-resource metadata.
//   2. GET /.well-known/oauth-protected-resource  -> lists this authorization server.
//   3. GET /.well-known/oauth-authorization-server -> endpoint metadata.
//   4. POST /register (dynamic client registration) -> client_id (public client).
//   5. GET /authorize -> local login page; the user proves identity with the
//      existing REL_AI_MCP_TOKEN. On success we mint a single-use auth code bound to
//      the client, redirect_uri, PKCE challenge, and resource.
//   6. POST /token (authorization_code + PKCE, or refresh_token) -> access token.
//   7. POST /mcp with Authorization: Bearer <access token> -> allowed.
//
// Single-user local tool: the "login" is the dashboard token. State persists to a
// 0600 file in the state dir so ChatGPT does not need to re-auth on every restart.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;          // 1 hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;              // 5 minutes
const SCOPE = "mcp";

function stateDir() {
  return process.env.REL_AI_MCP_STATE_DIR || path.join(os.homedir(), ".rel-ai-mcp");
}

function storePath() {
  return path.join(stateDir(), "oauth-store.json");
}

function emptyStore() {
  return { clients: {}, codes: {}, accessTokens: {}, refreshTokens: {} };
}

function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    return { ...emptyStore(), ...objectOrEmpty(parsed) };
  } catch (error) {
    if (process.env.REL_AI_MCP_DEBUG) console.error('[rel-ai-mcp] oauth store read:', error);
    return emptyStore();
  }
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function writeStore(store) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(storePath(), `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

// Drop anything past its lifetime so the store does not grow without bound.
function pruneStore(store) {
  const now = Date.now();
  for (const key of ["codes", "accessTokens", "refreshTokens"]) {
    for (const [id, entry] of Object.entries(store[key] || {})) {
      if (!entry || (entry.expiresAt && entry.expiresAt <= now)) delete store[key][id];
    }
  }
  // Registration is unauthenticated (RFC 7591), so clients{} would otherwise grow
  // forever — ChatGPT mints a fresh client_id every time the connector is re-added.
  // Keep a client while anything still references it or while it is young enough
  // that a pending authorize/refresh could still come back for it.
  const referenced = new Set();
  for (const key of ["codes", "accessTokens", "refreshTokens"]) {
    for (const entry of Object.values(store[key] || {})) {
      if (entry && entry.clientId) referenced.add(entry.clientId);
    }
  }
  for (const [clientId, client] of Object.entries(store.clients || {})) {
    if (referenced.has(clientId)) continue;
    const createdAt = client && Number(client.created_at) ? Number(client.created_at) : 0;
    if (!createdAt || now - createdAt > REFRESH_TOKEN_TTL_MS) delete store.clients[clientId];
  }
  return store;
}

function randomId(prefix, bytes = 32) {
  return `${prefix}${crypto.randomBytes(bytes).toString("base64url")}`;
}

function base64UrlSha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("base64url");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a == null ? "" : a));
  const right = Buffer.from(String(b == null ? "" : b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function stripTrailingSlash(value) {
  let result = String(value || "");
  while (result.endsWith("/")) result = result.slice(0, -1);
  return result;
}

// ---- Discovery metadata ----------------------------------------------------

function protectedResourceMetadata(baseUrl) {
  const base = stripTrailingSlash(baseUrl);
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
    resource_documentation: `${base}/dashboard`
  };
}

function authorizationServerMetadata(baseUrl) {
  const base = stripTrailingSlash(baseUrl);
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE]
  };
}

function wwwAuthenticateHeader(baseUrl, error) {
  const base = stripTrailingSlash(baseUrl);
  const parts = [`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`];
  if (error) parts.push(`error="${error}"`);
  return parts.join(", ");
}

// ---- Dynamic client registration (RFC 7591) --------------------------------

function registerClient(body = {}) {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).filter(Boolean) : [];
  if (redirectUris.length === 0) {
    return { error: "invalid_redirect_uri", error_description: "At least one redirect_uri is required." };
  }
  for (const uri of redirectUris) {
    try { new URL(uri); } catch {
      return { error: "invalid_redirect_uri", error_description: `Invalid redirect_uri: ${uri}` };
    }
  }
  const store = pruneStore(readStore());
  const clientId = randomId("relai_client_", 16);
  const client = {
    client_id: clientId,
    redirect_uris: redirectUris,
    client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 200) : "",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
    created_at: Date.now()
  };
  store.clients[clientId] = client;
  writeStore(store);
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(client.created_at / 1000),
    redirect_uris: redirectUris,
    grant_types: client.grant_types,
    response_types: client.response_types,
    token_endpoint_auth_method: "none",
    scope: SCOPE
  };
}

// ---- Authorization request validation --------------------------------------

// Returns { ok: true, request } when the /authorize query is a well-formed code
// request from a registered client, else { ok: false, ... }. redirectError marks
// errors that must be reported by redirecting back to the client per RFC 6749.
function oauthError(error, description, redirectError = false, extras = {}) {
  return { ok: false, redirectError, error, error_description: description, ...extras };
}

function authorizationClient(query, store) {
  const clientId = String(query.client_id || "");
  const client = store.clients[clientId];
  if (!client) return { error: oauthError("invalid_client", "Unknown client_id. Re-add the connector in ChatGPT.") };
  return { clientId, client };
}

function authorizationRedirect(query, client) {
  const redirectUri = String(query.redirect_uri || "");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { error: oauthError("invalid_request", "redirect_uri does not match a registered value.") };
  }
  return { redirectUri };
}

function authorizationCodeChallenge(query, redirectUri) {
  if (String(query.response_type || "") !== "code") {
    return { error: oauthError("unsupported_response_type", "Only response_type=code is supported.", true, { redirectUri, state: query.state }) };
  }
  const codeChallenge = String(query.code_challenge || "");
  const method = String(query.code_challenge_method || "");
  if (!codeChallenge || method !== "S256") {
    return { error: oauthError("invalid_request", "PKCE with code_challenge_method=S256 is required.", true, { redirectUri, state: query.state }) };
  }
  return { codeChallenge };
}

function validateAuthorizationRequest(query = {}) {
  const store = pruneStore(readStore());
  const clientResult = authorizationClient(query, store);
  if (clientResult.error) return clientResult.error;
  const redirectResult = authorizationRedirect(query, clientResult.client);
  if (redirectResult.error) return redirectResult.error;
  const challengeResult = authorizationCodeChallenge(query, redirectResult.redirectUri);
  if (challengeResult.error) return challengeResult.error;
  return {
    ok: true,
    request: {
      clientId: clientResult.clientId,
      clientName: clientResult.client.client_name || "",
      redirectUri: redirectResult.redirectUri,
      state: query.state != null ? String(query.state) : "",
      codeChallenge: challengeResult.codeChallenge,
      resource: query.resource != null ? String(query.resource) : "",
      scope: query.scope != null ? String(query.scope) : SCOPE
    }
  };
}

// Mint a single-use authorization code after the user has proven identity.
function issueAuthorizationCode(request) {
  const store = pruneStore(readStore());
  const code = randomId("relai_code_", 32);
  store.codes[code] = {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: request.resource || "",
    scope: request.scope || SCOPE,
    expiresAt: Date.now() + AUTH_CODE_TTL_MS
  };
  writeStore(store);
  return code;
}

function buildRedirectUrl(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---- Token endpoint --------------------------------------------------------

function issueTokens(store, { clientId, scope, resource }) {
  const now = Date.now();
  const accessToken = randomId("relai_at_", 32);
  const refreshToken = randomId("relai_rt_", 32);
  store.accessTokens[accessToken] = {
    clientId,
    scope: scope || SCOPE,
    resource: resource || "",
    issuedAt: now,
    expiresAt: now + ACCESS_TOKEN_TTL_MS
  };
  store.refreshTokens[refreshToken] = {
    clientId,
    scope: scope || SCOPE,
    resource: resource || "",
    issuedAt: now,
    expiresAt: now + REFRESH_TOKEN_TTL_MS
  };
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: scope || SCOPE
  };
}

function _exchangeAuthCode(store, body) {
  const code = String(body.code || "");
  const entry = store.codes[code];
  if (!entry) return { status: 400, body: { error: "invalid_grant", error_description: "Authorization code is invalid or expired." } };
  delete store.codes[code];
  if (entry.expiresAt <= Date.now()) {
    writeStore(store);
    return { status: 400, body: { error: "invalid_grant", error_description: "Authorization code expired." } };
  }
  if (String(body.client_id || "") !== entry.clientId) {
    writeStore(store);
    return { status: 400, body: { error: "invalid_grant", error_description: "client_id does not match the authorization code." } };
  }
  if (String(body.redirect_uri || "") !== entry.redirectUri) {
    writeStore(store);
    return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri does not match the authorization request." } };
  }
  const verifier = String(body.code_verifier || "");
  if (!verifier || base64UrlSha256(verifier) !== entry.codeChallenge) {
    writeStore(store);
    return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed." } };
  }
  const tokens = issueTokens(store, { clientId: entry.clientId, scope: entry.scope, resource: entry.resource });
  writeStore(store);
  return { status: 200, body: tokens };
}

function _exchangeRefreshToken(store, body) {
  const refreshToken = String(body.refresh_token || "");
  const entry = store.refreshTokens[refreshToken];
  if (!entry || entry.expiresAt <= Date.now()) {
    return { status: 400, body: { error: "invalid_grant", error_description: "Refresh token is invalid or expired." } };
  }
  if (body.client_id && String(body.client_id) !== entry.clientId) {
    return { status: 400, body: { error: "invalid_grant", error_description: "client_id does not match the refresh token." } };
  }
  delete store.refreshTokens[refreshToken];
  const tokens = issueTokens(store, { clientId: entry.clientId, scope: entry.scope, resource: entry.resource });
  writeStore(store);
  return { status: 200, body: tokens };
}

function exchangeToken(body = {}) {
  const grantType = String(body.grant_type || "");
  const store = pruneStore(readStore());

  if (grantType === "authorization_code") return _exchangeAuthCode(store, body);
  if (grantType === "refresh_token") return _exchangeRefreshToken(store, body);

  return { status: 400, body: { error: "unsupported_grant_type", error_description: `Unsupported grant_type: ${grantType}` } };
}

// ---- Resource-server token validation --------------------------------------

function validateAccessToken(token) {
  if (!token) return null;
  const store = readStore();
  const entry = store.accessTokens[token];
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry;
}

// ---- Login page ------------------------------------------------------------

function renderLoginPage(request, baseUrl, options = {}) {
  const hidden = {
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    response_type: "code",
    resource: request.resource,
    scope: request.scope
  };
  const hiddenInputs = Object.entries(hidden)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("\n      ");
  const errorHtml = options.error
    ? `<div class="err">${escapeHtml(options.error)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Rel.AI MCP</title>
<style>
  body { font-family: system-ui, sans-serif; background:#0b0f1a; color:#e6eaf2; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { background:#121828; border:1px solid #243049; border-radius:14px; padding:28px; width:340px; box-shadow:0 12px 40px rgba(0,0,0,.45); }
  h1 { font-size:18px; margin:0 0 6px; }
  p { font-size:13px; color:#9aa6bd; line-height:1.5; margin:0 0 18px; }
  label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:#9aa6bd; margin-bottom:6px; }
  input[type=password] { width:100%; box-sizing:border-box; background:#0b0f1a; border:1px solid #243049; border-radius:8px; color:#e6eaf2; padding:10px; font-size:14px; }
  button { width:100%; margin-top:16px; background:#3b6cf0; color:#fff; border:0; border-radius:8px; padding:11px; font-size:14px; font-weight:600; cursor:pointer; }
  .err { background:rgba(255,99,120,.12); border:1px solid rgba(255,99,120,.4); color:#ff9aa8; font-size:12px; padding:9px 11px; border-radius:8px; margin-bottom:14px; }
  .who { font-size:12px; color:#9aa6bd; margin-top:14px; }
</style>
</head>
<body>
  <form class="card" method="POST" action="/authorize">
    <h1>Authorize ChatGPT</h1>
    <p>Connect ChatGPT to your local Rel.AI MCP workspace bridge. Enter your Rel.AI dashboard token to approve this connection.</p>
    <p class="who" style="margin-top:0;">Find it in <code style="background:#0b0f1a;padding:1px 4px;border-radius:4px;">~/.rel-ai-mcp/.env</code> (REL_AI_MCP_TOKEN) or in the terminal output when the server started.</p>
    ${errorHtml}
    <label for="dashboard_token">Dashboard token</label>
    <input id="dashboard_token" name="dashboard_token" type="password" autocomplete="off" autofocus required>
    ${hiddenInputs}
    <button type="submit">Approve connection</button>
    <div class="who">Requesting client: ${escapeHtml(request.clientName || request.clientId)}</div>
  </form>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Verify the dashboard-token login. When the server runs with no token (local
// allow-no-auth testing), there is nothing to verify against, so consent is granted.
function verifyLogin(submittedToken, serverToken) {
  if (!serverToken) return true;
  return timingSafeEqual(submittedToken, serverToken);
}

module.exports = {
  protectedResourceMetadata,
  authorizationServerMetadata,
  wwwAuthenticateHeader,
  registerClient,
  validateAuthorizationRequest,
  issueAuthorizationCode,
  buildRedirectUrl,
  exchangeToken,
  validateAccessToken,
  renderLoginPage,
  verifyLogin,
  SCOPE
};
