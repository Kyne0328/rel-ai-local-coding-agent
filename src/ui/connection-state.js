const DEFAULT_STATE = Object.freeze({
  localService: { status: 'stopped' },
  publicEndpoint: { status: 'disabled' },
  chatgptReadiness: { status: 'unavailable' },
  mcpClient: { status: 'stopped' },
  dashboardUpdates: { status: 'offline' },
  error: null
});

const AUTH_READY_STATUSES = new Set([
  'ready',
  'authorized',
  'oauth_authorized',
  'bearer_authorized',
  'local_authorized',
  'oauth_approved'
]);

const LAYERS = Object.freeze([
  {
    key: 'localService',
    title: 'Local service',
    descriptions: {
      running: ['Running', 'ok', 'The Rel.AI service on this computer is accepting dashboard and MCP requests.'],
      starting: ['Starting', 'working', 'Rel.AI is starting the local service.'],
      stopped: ['Stopped', 'warn', 'The local service is not running.'],
      failed: ['Failed', 'bad', 'The local service could not start or stopped unexpectedly.']
    }
  },
  {
    key: 'publicEndpoint',
    title: 'Public endpoint',
    descriptions: {
      available: ['Published', 'ok', 'The permanent HTTPS endpoint has been published by the tunnel process.'],
      connecting: ['Connecting', 'working', 'Rel.AI is publishing the permanent HTTPS endpoint.'],
      unavailable: ['Unavailable', 'bad', 'The configured public endpoint could not be published.'],
      disabled: ['Not configured', 'warn', 'A permanent HTTPS endpoint has not been configured.']
    }
  },
  {
    key: 'chatgptReadiness',
    title: 'MCP authentication',
    descriptions: {
      ready: ['Authorized', 'ok', 'An MCP credential is ready for use.'],
      authorized: ['Authorized', 'ok', 'An MCP credential was accepted successfully.'],
      oauth_authorized: ['OAuth authorized', 'ok', 'An OAuth access token was accepted successfully.'],
      bearer_authorized: ['Bearer authorized', 'ok', 'The configured static bearer credential was accepted successfully.'],
      local_authorized: ['Local access', 'ok', 'The local no-auth development path accepted an MCP request.'],
      oauth_approved: ['OAuth approved', 'ok', 'Rel.AI has an active OAuth grant for this endpoint.'],
      authentication_required: ['OAuth approval required', 'warn', 'OAuth clients must be approved with the current approval token.'],
      authentication_failed: ['Authentication failed', 'bad', 'The latest MCP authentication attempt was rejected.'],
      awaiting_authentication: ['Awaiting authentication', 'working', 'The endpoint is available, but no MCP credential has been accepted since startup.'],
      authentication_unavailable: ['Authentication unavailable', 'bad', 'Rel.AI could not read the OAuth authorization state.'],
      unavailable: ['Unavailable', 'warn', 'MCP authentication is unavailable until the local service and public endpoint are available.']
    }
  },
  {
    key: 'mcpClient',
    title: 'MCP activity',
    descriptions: {
      stopped: ['Stopped', 'warn', 'The MCP endpoint is not accepting requests.'],
      starting: ['Starting', 'working', 'The stateless MCP transport is starting.'],
      active: ['Active now', 'working', 'One or more authorized MCP requests are currently running.'],
      recent: ['Recently active', 'ok', 'An authorized MCP request completed successfully within the recent-activity window.'],
      idle: ['Idle', '', 'The endpoint is ready. Its last successful request is outside the recent-activity window.'],
      no_requests: ['No requests yet', '', 'The endpoint is ready, but no authorized MCP request has been received since startup.'],
      request_failed: ['Last request failed', 'warn', 'The most recent completed MCP request failed.'],
      ready: ['No requests yet', '', 'The endpoint is ready, but no authorized MCP request has been received since startup.'],
      connected: ['Recently active', 'ok', 'A recent authorized MCP request used the current credentials and tool manifest.'],
      stale: ['Refresh required', 'warn', 'The host connector metadata is no longer current.'],
      reauthentication_required: ['Reauthentication required', 'warn', 'The approval credential changed and the affected connector must authenticate again.'],
      capability_mismatch: ['Capability mismatch', 'warn', 'The host did not advertise the required current capabilities.'],
      reconnecting: ['Refreshing', 'working', 'Rel.AI is requesting a bounded connector or tool-manifest refresh.'],
      degraded: ['Host action required', 'bad', 'Automatic recovery ended and the affected connector must be refreshed or recreated.'],
      failed: ['Failed', 'bad', 'The stateless MCP transport failed.']
    }
  },
  {
    key: 'dashboardUpdates',
    title: 'Dashboard updates',
    descriptions: {
      live: ['Live', 'ok', 'This dashboard is receiving live state and activity updates.'],
      connecting: ['Connecting', 'working', 'This dashboard is opening its live update stream.'],
      reconnecting: ['Reconnecting', 'working', 'This dashboard is restoring its live update stream.'],
      paused: ['Paused', 'warn', 'Live dashboard updates are paused.'],
      offline: ['Offline', 'bad', 'This dashboard is not receiving updates. MCP connectivity may still be available.']
    }
  }
]);

const ALLOWED = Object.freeze({
  localService: new Set(['running', 'starting', 'stopped', 'failed']),
  publicEndpoint: new Set(['available', 'connecting', 'unavailable', 'disabled']),
  chatgptReadiness: new Set([
    'ready', 'authorized', 'oauth_authorized', 'bearer_authorized', 'local_authorized', 'oauth_approved',
    'authentication_required', 'authentication_failed', 'awaiting_authentication', 'authentication_unavailable', 'unavailable'
  ]),
  mcpClient: new Set([
    'stopped', 'starting', 'active', 'recent', 'idle', 'no_requests', 'request_failed', 'ready', 'connected',
    'stale', 'reauthentication_required', 'capability_mismatch', 'reconnecting', 'degraded', 'failed'
  ]),
  dashboardUpdates: new Set(['live', 'connecting', 'reconnecting', 'paused', 'offline'])
});

export function normalizeConnectionState(state = {}) {
  return {
    localService: normalizeLayer('localService', state.localService, DEFAULT_STATE.localService.status),
    publicEndpoint: normalizeLayer('publicEndpoint', state.publicEndpoint, DEFAULT_STATE.publicEndpoint.status),
    chatgptReadiness: normalizeLayer('chatgptReadiness', state.chatgptReadiness, DEFAULT_STATE.chatgptReadiness.status),
    mcpClient: normalizeLayer('mcpClient', state.mcpClient, DEFAULT_STATE.mcpClient.status),
    dashboardUpdates: { ...(state.dashboardUpdates || {}), status: normalizeDashboardStatus(state.dashboardUpdates?.status) },
    error: normalizeError(state.error)
  };
}

export function connectionStateFor(data = {}, dashboardStatus = '') {
  const source = data.connectionState || data.desktopStatus?.connectionState || DEFAULT_STATE;
  const authentication = data.mcpAuthentication && typeof data.mcpAuthentication === 'object'
    ? { ...data.mcpAuthentication, status: data.mcpAuthentication.status }
    : source.chatgptReadiness;
  const connection = data.mcpConnection && typeof data.mcpConnection === 'object'
    ? { ...data.mcpConnection, status: data.mcpConnection.activityStatus || legacyActivityStatus(data.mcpConnection.status) }
    : source.mcpClient;
  const normalized = normalizeConnectionState({
    ...source,
    chatgptReadiness: authentication,
    mcpClient: connection
  });
  if (normalized.localService.status !== 'running' || normalized.publicEndpoint.status !== 'available') {
    normalized.chatgptReadiness = { ...normalized.chatgptReadiness, status: 'unavailable' };
  }
  if (dashboardStatus) normalized.dashboardUpdates = { status: normalizeDashboardStatus(dashboardStatus) };
  return normalized;
}

export function withConnectionState(data = {}, dashboardStatus = '') {
  return { ...data, connectionState: connectionStateFor(data, dashboardStatus) };
}

export function isMcpAuthenticationReady(state = {}) {
  return AUTH_READY_STATUSES.has(String(state.chatgptReadiness?.status || state.status || ''));
}

export function connectionLayerViews(state = {}) {
  const normalized = normalizeConnectionState(state);
  return LAYERS.map(layer => layerView(layer, normalized[layer.key]));
}

export function connectionSummary(state = {}) {
  const normalized = normalizeConnectionState(state);
  const errorMessage = normalized.error?.message || '';
  const local = normalized.localService.status;
  const endpoint = normalized.publicEndpoint.status;
  const authentication = normalized.chatgptReadiness.status;
  const activity = normalized.mcpClient.status;

  if (local === 'failed') return summary('Local service failed', 'Needs attention', 'bad', errorMessage || 'Rel.AI could not start the local service.');
  if (local === 'stopped') return summary('Local service is stopped', 'Stopped', 'warn', 'Start or restart Rel.AI before an MCP client can use this computer.');
  if (local === 'starting') return summary('Starting the local service', 'Starting', 'working', 'Rel.AI is preparing the local dashboard and MCP service.');
  if (endpoint === 'unavailable') return summary('Public endpoint unavailable', 'Needs attention', 'bad', errorMessage || 'The local service is running, but the permanent HTTPS endpoint could not be published.');
  if (endpoint === 'disabled') return summary('Public endpoint not configured', 'Setup required', 'warn', 'Configure a permanent HTTPS endpoint before connecting ChatGPT.');
  if (endpoint === 'connecting') return summary('Publishing the ChatGPT endpoint', 'Connecting', 'working', 'The local service is running while Rel.AI publishes the permanent HTTPS endpoint.');

  if (!isMcpAuthenticationReady(normalized)) {
    if (authentication === 'authentication_required' || activity === 'reauthentication_required') {
      return summary('OAuth approval required', 'Approval required', 'warn', 'Approve the OAuth connection with the current approval token. Static bearer access, if configured, is tracked separately.');
    }
    if (authentication === 'authentication_failed') return summary('MCP authentication failed', 'Authentication failed', 'bad', 'The latest MCP credential was rejected. Verify the configured authentication method and credential.');
    if (authentication === 'authentication_unavailable') return summary('Authentication state unavailable', 'Needs attention', 'bad', normalized.chatgptReadiness.oauth?.error?.message || 'Rel.AI could not read its OAuth authorization state.');
    if (authentication === 'awaiting_authentication') return summary('Ready for authentication', 'Awaiting authentication', 'working', 'The endpoint is available, but no MCP credential has been accepted since startup.');
    return summary('MCP authentication unavailable', 'Unavailable', 'warn', 'The endpoint is not ready to authenticate an MCP client.');
  }

  if (activity === 'failed') return summary('MCP transport failed', 'Needs attention', 'bad', errorMessage || 'Restart the Rel.AI transport and run connection diagnostics.');
  if (activity === 'degraded') return summary('ChatGPT refresh required', 'Host action required', 'bad', 'Refresh the Rel.AI app actions in ChatGPT settings, approve any changed actions, then reconnect.');
  if (activity === 'capability_mismatch') return summary('Tool inventory is out of sync', 'Tool mismatch', 'warn', 'Rel.AI requested a tool-list refresh. ChatGPT may still require an explicit app-action refresh.');
  if (activity === 'reconnecting') return summary('Refreshing the connector', 'Refreshing', 'working', 'Rel.AI is attempting a bounded capability or connector refresh.');
  if (activity === 'stale') return summary('Connector metadata is stale', 'Refresh required', 'warn', 'Refresh or recreate only the affected connector before sending another request.');
  if (activity === 'request_failed') return summary('The last MCP request failed', 'Last request failed', 'warn', requestDescription(normalized.mcpClient, 'Review the latest request error in Activity or Diagnostics.'));
  if (activity === 'active') return summary('MCP request in progress', 'Active now', 'working', requestDescription(normalized.mcpClient, 'An authorized MCP request is currently running.'));
  if (activity === 'recent' || activity === 'connected') return summary('Rel.AI is available to ChatGPT', 'Recently active', 'ok', requestDescription(normalized.mcpClient, 'A recent authorized MCP request completed successfully.'));
  if (activity === 'stopped') return summary('MCP endpoint is stopped', 'Stopped', 'warn', 'Authentication is valid, but the MCP transport is not accepting requests.');
  if (activity === 'starting') return summary('Starting MCP transport', 'Starting', 'working', 'Authentication is valid while the stateless MCP transport starts.');
  if (activity === 'idle') return summary('Rel.AI is ready for MCP requests', 'Idle', 'ok', requestDescription(normalized.mcpClient, 'The endpoint is ready; its last successful request is no longer recent.'));
  return summary('Rel.AI is ready for MCP requests', 'Ready', 'ok', 'Authentication is valid and the endpoint is ready. No authorized MCP request has been received since startup.');
}

function layerView(layer, value = {}) {
  const status = value.status;
  const [label, tone, fallbackDescription] = layer.descriptions[status];
  return {
    key: layer.key,
    title: layer.title,
    status,
    label,
    tone,
    description: layer.key === 'chatgptReadiness'
      ? authenticationDescription(value, fallbackDescription)
      : layer.key === 'mcpClient'
        ? requestDescription(value, fallbackDescription)
        : fallbackDescription
  };
}

function authenticationDescription(value, fallback) {
  if (value.status === 'bearer_authorized' && value.oauthApprovalRequired === true) {
    return 'The static bearer credential was accepted successfully. OAuth clients still require approval with the current approval token.';
  }
  return fallback;
}

function requestDescription(value, fallback) {
  const details = [];
  if (Number(value.activeRequestCount || 0) > 0) details.push(`${Number(value.activeRequestCount)} active request${Number(value.activeRequestCount) === 1 ? '' : 's'}`);
  if (value.lastRequestMethod) details.push(`latest method: ${value.lastRequestMethod}`);
  const timestamp = value.lastSuccessfulRequestAt || value.lastFailedRequestAt || value.lastRequestAt;
  if (timestamp) details.push(`at ${timestamp}`);
  return details.length ? `${fallback} ${details.join(' · ')}.` : fallback;
}

function legacyActivityStatus(status) {
  if (status === 'ready') return 'no_requests';
  if (status === 'connected') return 'recent';
  return status;
}

function summary(title, label, tone, message) {
  return { title, label, tone, message };
}

function normalizeLayer(layer, value, fallback) {
  const source = value && typeof value === 'object' ? value : {};
  return { ...source, status: validStatus(layer, source.status) || fallback };
}

function validStatus(layer, value) {
  const status = String(value || '').trim();
  return ALLOWED[layer].has(status) ? status : '';
}

function normalizeDashboardStatus(value) {
  const status = String(value || '').trim();
  if (status === 'stopped') return 'offline';
  return ALLOWED.dashboardUpdates.has(status) ? status : DEFAULT_STATE.dashboardUpdates.status;
}

function normalizeError(error) {
  if (!error || typeof error !== 'object') return null;
  const message = String(error.message || '').trim();
  if (!message) return null;
  return { code: String(error.code || 'unknown'), message };
}
