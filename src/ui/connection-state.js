const DEFAULT_STATE = Object.freeze({
  localService: { status: 'stopped' },
  publicEndpoint: { status: 'disabled' },
  chatgptReadiness: { status: 'unavailable' },
  dashboardUpdates: { status: 'offline' },
  error: null
});

const LAYERS = Object.freeze([
  {
    key: 'localService',
    title: 'Local service',
    descriptions: {
      running: ['Running', 'ok', 'The Rel.AI service on this computer is accepting dashboard and MCP requests.'],
      starting: ['Starting', 'warn', 'Rel.AI is starting the local service.'],
      stopped: ['Stopped', 'warn', 'The local service is not running.'],
      failed: ['Failed', 'bad', 'The local service could not start or stopped unexpectedly.']
    }
  },
  {
    key: 'publicEndpoint',
    title: 'Public endpoint',
    descriptions: {
      available: ['Available', 'ok', 'The permanent HTTPS endpoint is published and reachable.'],
      connecting: ['Connecting', 'warn', 'Rel.AI is publishing the permanent HTTPS endpoint.'],
      unavailable: ['Unavailable', 'bad', 'The configured public endpoint could not be published.'],
      disabled: ['Not configured', 'warn', 'A permanent HTTPS endpoint has not been configured.']
    }
  },
  {
    key: 'chatgptReadiness',
    title: 'ChatGPT readiness',
    descriptions: {
      ready: ['Ready', 'ok', 'ChatGPT can use the endpoint with the current approval state.'],
      authentication_required: ['Approval required', 'warn', 'ChatGPT must be approved again with the current approval token.'],
      unavailable: ['Unavailable', 'warn', 'ChatGPT cannot use Rel.AI until the local service and public endpoint are available.']
    }
  },
  {
    key: 'dashboardUpdates',
    title: 'Dashboard updates',
    descriptions: {
      live: ['Live', 'ok', 'This dashboard is receiving live state and activity updates.'],
      connecting: ['Connecting', 'warn', 'This dashboard is opening its live update stream.'],
      reconnecting: ['Reconnecting', 'warn', 'This dashboard is restoring its live update stream.'],
      paused: ['Paused', 'warn', 'Live dashboard updates are paused.'],
      offline: ['Offline', 'bad', 'This dashboard is not receiving live updates. ChatGPT connectivity may still be available.']
    }
  }
]);

const ALLOWED = Object.freeze({
  localService: new Set(['running', 'starting', 'stopped', 'failed']),
  publicEndpoint: new Set(['available', 'connecting', 'unavailable', 'disabled']),
  chatgptReadiness: new Set(['ready', 'authentication_required', 'unavailable']),
  dashboardUpdates: new Set(['live', 'connecting', 'reconnecting', 'paused', 'offline'])
});

export function normalizeConnectionState(state = {}) {
  return {
    localService: { status: validStatus('localService', state.localService?.status) || DEFAULT_STATE.localService.status },
    publicEndpoint: { status: validStatus('publicEndpoint', state.publicEndpoint?.status) || DEFAULT_STATE.publicEndpoint.status },
    chatgptReadiness: { status: validStatus('chatgptReadiness', state.chatgptReadiness?.status) || DEFAULT_STATE.chatgptReadiness.status },
    dashboardUpdates: { status: normalizeDashboardStatus(state.dashboardUpdates?.status) },
    error: normalizeError(state.error)
  };
}

export function connectionStateFor(data = {}, dashboardStatus = '') {
  const source = data.desktopStatus?.connectionState || data.connectionState || DEFAULT_STATE;
  const normalized = normalizeConnectionState(source);
  if (dashboardStatus) normalized.dashboardUpdates = { status: normalizeDashboardStatus(dashboardStatus) };
  return normalized;
}

export function withConnectionState(data = {}, dashboardStatus = '') {
  return { ...data, connectionState: connectionStateFor(data, dashboardStatus) };
}

export function connectionLayerViews(state = {}) {
  const normalized = normalizeConnectionState(state);
  return LAYERS.map(layer => {
    const status = normalized[layer.key].status;
    const [label, tone, description] = layer.descriptions[status];
    return { key: layer.key, title: layer.title, status, label, tone, description };
  });
}

export function connectionSummary(state = {}) {
  const normalized = normalizeConnectionState(state);
  const errorMessage = normalized.error?.message || '';
  const local = normalized.localService.status;
  const endpoint = normalized.publicEndpoint.status;
  const chatgpt = normalized.chatgptReadiness.status;
  const updates = normalized.dashboardUpdates.status;

  if (local === 'failed') return summary('Local service failed', 'Needs attention', 'bad', errorMessage || 'Rel.AI could not start the local service.');
  if (local === 'stopped') return summary('Local service is stopped', 'Stopped', 'warn', 'Start or restart Rel.AI before ChatGPT can use this computer.');
  if (local === 'starting') return summary('Starting the local service', 'Starting', 'warn', 'Rel.AI is preparing the local dashboard and MCP service.');
  if (endpoint === 'unavailable') return summary('Public endpoint unavailable', 'Needs attention', 'bad', errorMessage || 'The local service is running, but the permanent HTTPS endpoint could not be published.');
  if (endpoint === 'disabled') return summary('Public endpoint not configured', 'Setup required', 'warn', 'Configure a permanent HTTPS endpoint before connecting ChatGPT.');
  if (endpoint === 'connecting') return summary('Publishing the ChatGPT endpoint', 'Connecting', 'warn', 'The local service is running while Rel.AI publishes the permanent HTTPS endpoint.');
  if (chatgpt === 'authentication_required') return summary('ChatGPT approval required', 'Approval required', 'warn', errorMessage || 'Approve ChatGPT again with the current approval token.');
  if (chatgpt !== 'ready') return summary('ChatGPT is unavailable', 'Unavailable', 'warn', 'The endpoint is not currently ready for ChatGPT.');

  const updateNote = updates === 'live'
    ? 'This dashboard is also receiving live updates.'
    : 'ChatGPT is ready, but this dashboard is not currently receiving live updates.';
  return summary('Rel.AI is available to ChatGPT', 'Available', 'ok', `The secure MCP endpoint is published and approved. ${updateNote}`);
}

function summary(title, label, tone, message) {
  return { title, label, tone, message };
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
