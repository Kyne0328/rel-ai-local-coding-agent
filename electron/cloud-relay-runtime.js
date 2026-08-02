import { createCloudRelayStateStore } from './cloud-relay-state.js';
import { createCloudRelayClient, DEFAULT_CLOUD_URL } from './cloud-relay-client.js';

function createCloudRelayRuntime(options = {}) {
  const {
    app,
    safeStorage,
    baseUrl = process.env.REL_AI_CLOUD_URL || DEFAULT_CLOUD_URL,
    onStatusChange = () => {},
    onLog = () => {},
    createStateStore = createCloudRelayStateStore,
    createClient = createCloudRelayClient
  } = options;
  if (!app) throw new TypeError('Electron app is required.');
  if (!safeStorage) throw new TypeError('Electron safeStorage is required.');

  let client = null;
  let status = fallbackStatus(baseUrl);

  function initialize() {
    if (client) return getStatus();
    try {
      const stateStore = createStateStore({ app, safeStorage, onLog });
      client = createClient({
        stateStore,
        baseUrl,
        onStatusChange: next => publish(next),
        onLog
      });
      publish(client.getStatus());
    } catch (error) {
      client = null;
      publish({ ...fallbackStatus(baseUrl), state: 'failed', lastError: formatError(error) });
      onLog(`Rel.AI Cloud could not initialize: ${formatError(error)}`, {
        source: 'cloud-relay',
        level: 'warning'
      });
    }
    return getStatus();
  }

  async function start(connection) {
    return requireClient().start(connection);
  }

  function stop() {
    return client ? client.stop() : getStatus();
  }

  async function reconnect() {
    return requireClient().reconnect();
  }

  async function createPairingCode() {
    return requireClient().createPairingCode();
  }

  async function resetRegistration() {
    return requireClient().resetRegistration();
  }

  function getStatus() {
    return client ? client.getStatus() : { ...status };
  }

  function requireClient() {
    if (!client) initialize();
    if (!client) throw new Error(status.lastError || 'Rel.AI Cloud is unavailable in this desktop session.');
    return client;
  }

  function publish(next) {
    status = { ...fallbackStatus(baseUrl), ...(next || {}) };
    try { onStatusChange({ ...status }); } catch {}
  }

  return { initialize, start, stop, reconnect, createPairingCode, resetRegistration, getStatus };
}

function fallbackStatus(baseUrl = DEFAULT_CLOUD_URL) {
  const normalized = String(baseUrl || DEFAULT_CLOUD_URL).replace(/\/$/, '');
  return {
    state: 'stopped',
    baseUrl: normalized,
    mcpUrl: `${normalized}/mcp`,
    registered: false,
    connected: false,
    deviceId: '',
    pairingCode: '',
    pairingExpiresAt: '',
    lastConnectedAt: '',
    reconnectAttempt: 0,
    lastError: '',
    updatedAt: new Date().toISOString()
  };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { createCloudRelayRuntime, fallbackStatus };
