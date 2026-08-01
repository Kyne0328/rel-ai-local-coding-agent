import * as oauth from '../oauthProvider.js';

function readMcpAuthenticationStatus(connection = {}, options = {}) {
  const authenticatedAt = timestamp(connection.lastAuthenticatedAt);
  const failedAt = timestamp(connection.lastAuthenticationFailureAt);
  const authMode = normalizeAuthMode(connection.lastAuthMode);
  const oauthState = readOauthStatus();

  let status = 'awaiting_authentication';
  if (authenticatedAt) status = statusForAuthMode(authMode);
  else if (failedAt) status = 'authentication_failed';
  else if (!oauthState.available) status = 'authentication_unavailable';
  else if (oauthState.approvalRequired) status = 'authentication_required';
  else if (oauthState.activeAccessTokens > 0 || oauthState.activeRefreshTokens > 0) status = 'oauth_approved';

  return {
    status,
    authMode,
    lastAuthenticatedAt: authenticatedAt,
    lastAuthenticationFailureAt: failedAt,
    staticBearerConfigured: options.staticBearerConfigured === true,
    oauthApprovalRequired: oauthState.approvalRequired,
    oauth: oauthState
  };
}

function readOauthStatus() {
  try {
    const state = oauth.authorizationStatus();
    return {
      available: true,
      approvalRequired: state.required === true,
      approvalRequiredAt: timestamp(state.approvalRequiredAt),
      lastApprovedAt: timestamp(state.lastApprovedAt),
      activeAccessTokens: nonNegativeInteger(state.activeAccessTokens),
      activeRefreshTokens: nonNegativeInteger(state.activeRefreshTokens),
      registeredClients: nonNegativeInteger(state.registeredClients),
      error: null
    };
  } catch (error) {
    return {
      available: false,
      approvalRequired: false,
      approvalRequiredAt: null,
      lastApprovedAt: null,
      activeAccessTokens: 0,
      activeRefreshTokens: 0,
      registeredClients: 0,
      error: {
        code: String(error?.code || 'OAUTH_STATUS_UNAVAILABLE'),
        message: error instanceof Error ? error.message : String(error || 'OAuth status is unavailable.')
      }
    };
  }
}

function statusForAuthMode(authMode) {
  if (authMode === 'oauth') return 'oauth_authorized';
  if (authMode === 'static_bearer') return 'bearer_authorized';
  if (authMode === 'local_no_auth') return 'local_authorized';
  return 'authorized';
}

function normalizeAuthMode(value) {
  const mode = String(value || '');
  return ['oauth', 'static_bearer', 'local_no_auth'].includes(mode) ? mode : '';
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function timestamp(value) {
  const milliseconds = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}

export { readMcpAuthenticationStatus };
