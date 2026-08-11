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
    title: 'Connection service',
    descriptions: {
      running: ['Running', 'ok', 'Rel.AI is running the secured connection used by the dashboard and MCP endpoint.'],
      starting: ['Starting', 'working', 'Rel.AI is preparing the secured connection.'],
      stopped: ['Stopped', 'warn', 'The Rel.AI connection is not running.'],
      failed: ['Failed', 'bad', 'The Rel.AI connection could not start or stopped unexpectedly.']
    }
  },
  {
    key: 'publicEndpoint',
    title: 'Secure endpoint',
    descriptions: {
      available: ['Available', 'ok', 'The configured HTTPS endpoint is available to ChatGPT.'],
      connecting: ['Connecting', 'working', 'Rel.AI is publishing the configured HTTPS endpoint.'],
      unavailable: ['Unavailable', 'bad', 'The configured HTTPS endpoint could not be published.'],
      disabled: ['Not configured', 'warn', 'A permanent HTTPS endpoint has not been configured.']
    }
  },
  {
    key: 'chatgptReadiness',
    title: 'Authorization',
    descriptions: {
      ready: ['Authorized', 'ok', 'A ChatGPT authorization credential is ready for use.'],
      authorized: ['Authorized', 'ok', 'A ChatGPT authorization credential was accepted successfully.'],
      oauth_authorized: ['OAuth authorized', 'ok', 'An OAuth access token was accepted successfully.'],
      bearer_authorized: ['Bearer authorized', 'ok', 'The configured static bearer credential was accepted successfully.'],
      local_authorized: ['Development access', 'ok', 'A development-only unauthenticated MCP request was accepted.'],
      oauth_approved: ['OAuth approved', 'ok', 'Rel.AI has an active OAuth grant for this endpoint.'],
      authentication_required: ['Approval required', 'warn', 'Approve the existing ChatGPT app with the current approval token.'],
      authentication_failed: ['Authorization failed', 'bad', 'The latest ChatGPT authorization attempt was rejected.'],
      awaiting_authentication: ['Awaiting authorization', 'working', 'The endpoint is available, but no ChatGPT credential has been accepted since startup.'],
      authentication_unavailable: ['Authorization unavailable', 'bad', 'Rel.AI could not read the OAuth authorization state.'],
      unavailable: ['Unavailable', 'warn', 'Authorization is unavailable until the connection and secure endpoint are ready.']
    }
  },
  {
    key: 'mcpClient',
    title: 'Client and tools',
    descriptions: {
      stopped: ['Stopped', 'warn', 'The MCP endpoint is not accepting requests.'],
      starting: ['Starting', 'working', 'The MCP transport and tool catalog are starting.'],
      active: ['Active now', 'working', 'One or more authorized MCP requests are running.'],
      recent: ['Recently active', 'ok', 'A recent authorized request used the current tool catalog.'],
      idle: ['Ready', 'ok', 'The client and synchronized tool catalog are ready for requests.'],
      no_requests: ['Ready', 'ok', 'The endpoint is ready, but no authorized MCP request has been received since startup.'],
      request_failed: ['Last request failed', 'warn', 'The most recent completed MCP request failed.'],
      ready: ['Ready', 'ok', 'The client and synchronized tool catalog are ready for requests.'],
      connected: ['Recently active', 'ok', 'A recent authorized MCP request used the current credentials and tool manifest.'],
      stale: ['Refresh required', 'warn', 'The host connector metadata is no longer current.'],
      tool_refresh_required: ['Tool refresh required', 'warn', 'ChatGPT should request the current Rel.AI tool schema; authentication remains separate.'],
      device_update_required: ['Device update required', 'warn', 'This Rel.AI desktop protocol is older than the gateway minimum and must be updated.'],
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
    'stale', 'tool_refresh_required', 'device_update_required', 'reauthentication_required', 'capability_mismatch', 'reconnecting', 'degraded', 'failed'
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
  const cloudMode = data.desktopStatus?.connectionMode === 'cloud';
  const gateway = data.desktopStatus?.gateway && typeof data.desktopStatus.gateway === 'object' ? data.desktopStatus.gateway : null;
  const authentication = cloudMode && gateway
    ? { status: gateway.principalPaired ? 'oauth_authorized' : 'authentication_required' }
    : data.mcpAuthentication && typeof data.mcpAuthentication === 'object'
      ? { ...data.mcpAuthentication, status: data.mcpAuthentication.status }
      : source.chatgptReadiness;
  const connection = cloudMode && gateway
    ? cloudMcpClient(gateway)
    : data.mcpConnection && typeof data.mcpConnection === 'object'
      ? { ...data.mcpConnection, status: data.mcpConnection.activityStatus || legacyActivityStatus(data.mcpConnection.status) }
      : source.mcpClient;
  const normalized = normalizeConnectionState({
    ...source,
    ...(cloudMode && gateway ? { publicEndpoint: cloudPublicEndpoint(gateway) } : {}),
    chatgptReadiness: authentication,
    mcpClient: connection
  });
  normalized.mode = cloudMode ? 'cloud' : 'direct';
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
  const mode = String(state.mode || 'direct');
  return LAYERS.map(layer => layerView(layer, normalized[layer.key], mode));
}

export function connectionSummary(state = {}) {
  const mode = String(state.mode || 'direct');
  const normalized = normalizeConnectionState(state);
  const errorMessage = normalized.error?.message || '';
  const local = normalized.localService.status;
  const endpoint = normalized.publicEndpoint.status;
  const authentication = normalized.chatgptReadiness.status;
  const activity = normalized.mcpClient.status;

  if (local === 'failed') return summary('Local service failed', 'Needs attention', 'bad', errorMessage || 'Rel.AI could not start the local service.');
  if (local === 'stopped') return summary('Local service is stopped', 'Stopped', 'warn', 'Start or restart Rel.AI before an MCP client can use this computer.');
  if (local === 'starting') return summary('Starting the local service', 'Starting', 'working', 'Rel.AI is preparing the local dashboard and MCP service.');
  if (endpoint === 'unavailable') return mode === 'cloud'
    ? summary('Rel.AI Cloud unreachable', 'Needs attention', 'bad', errorMessage || 'The local service is running, but this device cannot currently reach Rel.AI Cloud.')
    : summary('Public endpoint unavailable', 'Needs attention', 'bad', errorMessage || 'The local service is running, but the permanent HTTPS endpoint could not be published.');
  if (endpoint === 'disabled') return mode === 'cloud'
    ? summary('Rel.AI Cloud unavailable', 'Unavailable', 'warn', 'The shared Rel.AI Cloud connection is not available on this device.')
    : summary('Public endpoint not configured', 'Setup required', 'warn', 'Configure a permanent HTTPS endpoint before connecting ChatGPT.');
  if (endpoint === 'connecting') return mode === 'cloud'
    ? summary('Restoring Rel.AI Cloud', 'Connecting', 'working', 'The local service stays running while this computer restores its outbound gateway session.')
    : summary('Publishing the ChatGPT endpoint', 'Connecting', 'working', 'The local service is running while Rel.AI publishes the permanent HTTPS endpoint.');

  if (!isMcpAuthenticationReady(normalized)) {
    if (authentication === 'authentication_required' || activity === 'reauthentication_required') {
      return mode === 'cloud'
        ? summary('Pair this device with ChatGPT', 'Pairing required', 'warn', 'Use the short-lived Rel.AI Cloud pairing flow. Direct approval tokens are not used for Cloud pairing.')
        : summary('OAuth approval required', 'Approval required', 'warn', 'Approve the OAuth connection with the current approval token. Static bearer access, if configured, is tracked separately.');
    }
    if (authentication === 'authentication_failed') return summary('MCP authentication failed', 'Authentication failed', 'bad', 'The latest MCP credential was rejected. Verify the configured authentication method and credential.');
    if (authentication === 'authentication_unavailable') return summary('Authentication state unavailable', 'Needs attention', 'bad', normalized.chatgptReadiness.oauth?.error?.message || 'Rel.AI could not read its OAuth authorization state.');
    if (authentication === 'awaiting_authentication') return summary('Ready for authentication', 'Awaiting authentication', 'working', 'The endpoint is available, but no MCP credential has been accepted since startup.');
    return summary('MCP authentication unavailable', 'Unavailable', 'warn', 'The endpoint is not ready to authenticate an MCP client.');
  }

  if (activity === 'failed') return summary('MCP transport failed', 'Needs attention', 'bad', errorMessage || 'Restart the Rel.AI transport and run connection diagnostics.');
  if (activity === 'device_update_required') return summary('Rel.AI Desktop update required', 'Device update required', 'warn', 'Update Rel.AI Desktop before the gateway can route MCP requests to this device. Authentication does not need to be reset.');
  if (activity === 'tool_refresh_required') return summary('ChatGPT tool refresh recommended', 'Tool refresh required', 'warn', 'Refresh the existing Rel.AI app tools in ChatGPT. Do not revoke OAuth or recreate the app.');
  if (activity === 'degraded') return summary('ChatGPT refresh required', 'Host action required', 'bad', 'Refresh the Rel.AI app actions in ChatGPT settings, approve any changed actions, then reconnect.');
  if (activity === 'capability_mismatch') return summary('Tool inventory is out of sync', 'Tool mismatch', 'warn', 'Rel.AI requested a tool-list refresh. ChatGPT may still require an explicit app-action refresh.');
  if (activity === 'reconnecting') return mode === 'cloud'
    ? summary('Restoring the device session', 'Reconnecting', 'working', 'Rel.AI is restoring the outbound device connection without restarting the local service or dashboard.')
    : summary('Refreshing the connector', 'Refreshing', 'working', 'Rel.AI is attempting a bounded capability or connector refresh.');
  if (activity === 'stale') return summary('Connector metadata is stale', 'Refresh required', 'warn', 'Refresh or recreate only the affected connector before sending another request.');
  if (activity === 'request_failed') return summary('The last MCP request failed', 'Last request failed', 'warn', requestDescription(normalized.mcpClient, 'Review the latest request error in Activity or Diagnostics.'));
  if (activity === 'active') return summary('MCP request in progress', 'Active now', 'working', requestDescription(normalized.mcpClient, 'An authorized MCP request is currently running.'));
  if (activity === 'recent' || activity === 'connected') return summary('Rel.AI is available to ChatGPT', 'Recently active', 'ok', requestDescription(normalized.mcpClient, 'A recent authorized MCP request completed successfully.'));
  if (activity === 'stopped') return summary('MCP endpoint is stopped', 'Stopped', 'warn', 'Authentication is valid, but the MCP transport is not accepting requests.');
  if (activity === 'starting') return summary('Starting MCP transport', 'Starting', 'working', 'Authentication is valid while the stateless MCP transport starts.');
  if (activity === 'idle') return summary('Rel.AI is ready for MCP requests', 'Idle', 'ok', requestDescription(normalized.mcpClient, 'The endpoint is ready; its last successful request is no longer recent.'));
  return summary('Rel.AI is ready for MCP requests', 'Ready', 'ok', 'Authentication is valid and the endpoint is ready. No authorized MCP request has been received since startup.');
}

function layerView(layer, value = {}, mode = 'direct') {
  const status = value.status;
  const [label, tone, fallbackDescription] = layer.descriptions[status];
  const cloudEndpoint = mode === 'cloud' && layer.key === 'publicEndpoint';
  return {
    key: layer.key,
    title: cloudEndpoint ? 'Rel.AI Cloud' : layer.title,
    status,
    label,
    tone,
    description: cloudEndpoint
      ? cloudEndpointDescription(status, fallbackDescription)
      : layer.key === 'chatgptReadiness'
        ? authenticationDescription(value, fallbackDescription)
        : layer.key === 'mcpClient'
          ? requestDescription(value, fallbackDescription)
          : fallbackDescription
  };
}

function cloudPublicEndpoint(gateway) {
  const state = String(gateway.state || 'offline');
  if (['connected', 'pairing', 'pairing_required', 'authenticating'].includes(state)) return { status: 'available' };
  if (state === 'error') return { status: 'unavailable' };
  return { status: 'connecting' };
}

function cloudMcpClient(gateway) {
  const schemaStatus = String(gateway.schemaStatus || '');
  if (['tool_refresh_required', 'device_update_required', 'reauthentication_required'].includes(schemaStatus)) return { status: schemaStatus };
  const state = String(gateway.state || 'offline');
  if (state === 'device_update_required') return { status: 'device_update_required' };
  if (state === 'connected') return { status: 'no_requests' };
  if (state === 'error') return { status: 'failed' };
  if (state === 'connecting' || state === 'authenticating' || state === 'offline') return { status: 'reconnecting' };
  return { status: 'stopped' };
}

function cloudEndpointDescription(status, fallback) {
  if (status === 'available') return 'The shared Rel.AI Cloud endpoint is available; this computer connects outward and does not expose a local public port.';
  if (status === 'connecting') return 'The shared Rel.AI Cloud endpoint remains stable while this computer restores its outbound device session.';
  if (status === 'unavailable') return 'This computer could not reach Rel.AI Cloud. The local dashboard remains available.';
  return fallback;
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
