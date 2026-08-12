function readMcpAuthenticationStatus(connection = {}, options = {}) {
  const authenticatedAt = timestamp(connection.lastAuthenticatedAt);
  const failedAt = timestamp(connection.lastAuthenticationFailureAt);
  const authMode = normalizeAuthMode(connection.lastAuthMode);
  let status = 'awaiting_authentication';
  if (authenticatedAt) status = statusForAuthMode(authMode);
  else if (failedAt) status = 'authentication_failed';
  return {
    status,
    authMode,
    lastAuthenticatedAt: authenticatedAt,
    lastAuthenticationFailureAt: failedAt,
    staticBearerConfigured: options.staticBearerConfigured === true
  };
}

function statusForAuthMode(authMode) {
  if (authMode === 'static_bearer') return 'bearer_authorized';
  if (authMode === 'local_no_auth') return 'local_authorized';
  return 'authorized';
}

function normalizeAuthMode(value) {
  const mode = String(value || '');
  return ['static_bearer', 'local_no_auth'].includes(mode) ? mode : '';
}

function timestamp(value) {
  const milliseconds = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}

export { readMcpAuthenticationStatus };
