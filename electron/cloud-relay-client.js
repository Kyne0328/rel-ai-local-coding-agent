import {
  createPrivateKey,
  generateKeyPairSync,
  sign
} from 'node:crypto';

const DEFAULT_CLOUD_URL = 'https://rel-ai-cloud.kynskie13.workers.dev';
const MAX_RELAY_BODY_BYTES = 1024 * 1024;
const CLOUD_REQUEST_TIMEOUT_MS = 15_000;
const LOCAL_MCP_TIMEOUT_MS = 55_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE']);
const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'content-type',
  'mcp-protocol-version',
  'traceparent',
  'tracestate'
]);
const FORWARDED_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-type',
  'mcp-protocol-version'
]);

function createCloudRelayClient(options = {}) {
  const {
    stateStore,
    baseUrl = DEFAULT_CLOUD_URL,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = globalThis.WebSocket,
    onStatusChange = () => {},
    onLog = () => {},
    allowInsecureLocalhost = false,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  } = options;
  if (!stateStore || typeof stateStore.load !== 'function' || typeof stateStore.save !== 'function') {
    throw new TypeError('A cloud relay state store is required.');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required for the cloud relay.');
  if (typeof WebSocketImpl !== 'function') throw new TypeError('WebSocket is required for the cloud relay.');

  const cloudBaseUrl = normalizeCloudBaseUrl(baseUrl, { allowInsecureLocalhost });
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let generation = 0;
  let running = false;
  let local = null;
  let registrationPromise = null;
  let status = baseStatus(cloudBaseUrl);

  function getStatus() {
    return { ...status };
  }

  async function start(connection = {}) {
    local = normalizeLocalConnection(connection);
    running = true;
    generation += 1;
    reconnectAttempt = 0;
    clearReconnect();
    closeSocket(1000, 'Rel.AI Cloud connection restarting.');
    updateStatus({ state: 'registering', lastError: '', reconnectAttempt: 0 });
    try {
      const registered = await ensureRegistered();
      updateStatus({
        registered: true,
        deviceId: registered.deviceId,
        state: 'connecting'
      });
      await connect(generation);
    } catch (error) {
      handleConnectionFailure(error, generation);
    }
    return getStatus();
  }

  function stop() {
    running = false;
    generation += 1;
    clearReconnect();
    closeSocket(1000, 'Rel.AI Cloud connection stopped.');
    updateStatus({ state: 'stopped', connected: false, reconnectAttempt: 0 });
    return getStatus();
  }

  async function reconnect() {
    if (!local) throw new Error('The local Rel.AI service must be running before reconnecting to Rel.AI Cloud.');
    return start(local);
  }

  async function createPairingCode() {
    const registered = await ensureRegistered();
    const result = await cloudJson('/v1/devices/pairing-code', {
      method: 'POST',
      bearer: registered.deviceToken,
      body: {}
    });
    const pairingCode = String(result.pairing_code || '');
    const pairingExpiresAt = String(result.expires_at || '');
    if (!pairingCode) throw new Error('Rel.AI Cloud did not return a pairing code.');
    updateStatus({ pairingCode, pairingExpiresAt });
    return { ok: true, pairingCode, expiresAt: pairingExpiresAt, status: getStatus() };
  }

  async function resetRegistration() {
    const restartConnection = local;
    stop();
    stateStore.clear();
    registrationPromise = null;
    updateStatus({
      state: 'unregistered',
      registered: false,
      connected: false,
      deviceId: '',
      pairingCode: '',
      pairingExpiresAt: '',
      lastError: ''
    });
    if (restartConnection) return start(restartConnection);
    return getStatus();
  }

  async function ensureRegistered() {
    const existing = stateStore.load();
    if (validStoredRegistration(existing)) return existing;
    if (registrationPromise) return registrationPromise;
    registrationPromise = registerDevice(existing).finally(() => {
      registrationPromise = null;
    });
    return registrationPromise;
  }

  async function registerDevice(existing) {
    updateStatus({ state: 'registering', registered: false, connected: false });
    let publicKeyJwk = existing.publicKeyJwk;
    let privateKeyJwk = existing.privateKeyJwk;
    if (!validKeyPair(publicKeyJwk, privateKeyJwk)) {
      const pair = generateKeyPairSync('ed25519');
      publicKeyJwk = pair.publicKey.export({ format: 'jwk' });
      privateKeyJwk = pair.privateKey.export({ format: 'jwk' });
      stateStore.save({ deviceId: '', publicKeyJwk, privateKeyJwk, deviceToken: '' });
    }

    const challenge = await cloudJson('/v1/devices/register/challenge', {
      method: 'POST',
      body: { public_key_jwk: publicKeyJwk }
    });
    const challengeId = String(challenge.challenge_id || '');
    const challengeText = String(challenge.challenge || '');
    if (!challengeId || !challengeText) throw new Error('Rel.AI Cloud returned an invalid device challenge.');
    const signature = sign(
      null,
      Buffer.from(challengeText, 'utf8'),
      createPrivateKey({ key: privateKeyJwk, format: 'jwk' })
    ).toString('base64url');
    const completed = await cloudJson('/v1/devices/register/complete', {
      method: 'POST',
      body: { challenge_id: challengeId, signature }
    });
    const deviceId = String(completed.device_id || '');
    const deviceToken = String(completed.device_token || '');
    if (!deviceId || !deviceToken) throw new Error('Rel.AI Cloud did not return device credentials.');
    const saved = stateStore.save({ deviceId, publicKeyJwk, privateKeyJwk, deviceToken });
    onLog('Rel.AI Cloud device registration completed.', { source: 'cloud-relay' });
    updateStatus({ registered: true, deviceId, state: 'connecting' });
    return saved;
  }

  async function connect(expectedGeneration) {
    if (!running || expectedGeneration !== generation) return;
    const registered = await ensureRegistered();
    const ticket = await cloudJson('/v1/devices/connection-ticket', {
      method: 'POST',
      bearer: registered.deviceToken,
      body: {}
    });
    if (!running || expectedGeneration !== generation) return;
    const protocol = String(ticket.websocket_protocol || '');
    if (!/^relai-device\.relai_ticket_[A-Za-z0-9_-]+$/.test(protocol)) {
      throw new Error('Rel.AI Cloud returned an invalid connection ticket.');
    }

    const websocketUrl = new URL('/v1/devices/connect', cloudBaseUrl);
    websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const nextSocket = new WebSocketImpl(websocketUrl.href, [protocol]);
    socket = nextSocket;
    updateStatus({ state: 'connecting', connected: false, lastError: '' });

    attachSocketHandler(nextSocket, 'open', () => {
      if (nextSocket !== socket || expectedGeneration !== generation || !running) return;
      reconnectAttempt = 0;
      updateStatus({
        state: 'connected',
        connected: true,
        lastConnectedAt: new Date().toISOString(),
        reconnectAttempt: 0,
        lastError: ''
      });
      onLog('Rel.AI Cloud relay connected.', { source: 'cloud-relay' });
    });
    attachSocketHandler(nextSocket, 'message', event => {
      if (nextSocket !== socket || expectedGeneration !== generation || !running) return;
      void handleSocketMessage(nextSocket, socketMessageData(event)).catch(error => {
        onLog(`Rel.AI Cloud request failed: ${safeMessage(error)}`, {
          source: 'cloud-relay',
          level: 'warning'
        });
      });
    });
    attachSocketHandler(nextSocket, 'error', () => {
      if (nextSocket !== socket || expectedGeneration !== generation || !running) return;
      updateStatus({ connected: false, state: 'reconnecting', lastError: 'The Rel.AI Cloud WebSocket connection failed.' });
    });
    attachSocketHandler(nextSocket, 'close', event => {
      if (nextSocket !== socket || expectedGeneration !== generation) return;
      socket = null;
      updateStatus({ connected: false });
      if (!running) return;
      const code = Number(event?.code || 0);
      const reason = cleanText(event?.reason, 240);
      handleConnectionFailure(new Error(reason || `Rel.AI Cloud disconnected${code ? ` (${code})` : ''}.`), expectedGeneration);
    });
  }

  async function handleSocketMessage(targetSocket, rawMessage) {
    if (typeof rawMessage !== 'string' || rawMessage.length > encodedRelayLimit()) {
      throw new Error('Rel.AI Cloud sent an invalid relay message.');
    }
    let envelope;
    try {
      envelope = JSON.parse(rawMessage);
    } catch {
      throw new Error('Rel.AI Cloud sent malformed JSON.');
    }
    if (envelope?.type === 'connected') return;
    if (envelope?.type !== 'request') return;
    const requestId = cleanText(envelope.request_id, 160);
    if (!requestId) return;

    let response;
    try {
      response = await forwardLocalMcp(envelope);
    } catch (error) {
      response = relayFailureResponse(requestId, error);
    }
    if (targetSocket.readyState === 1) targetSocket.send(JSON.stringify(response));
  }

  async function forwardLocalMcp(envelope) {
    if (!local) throw new Error('The local Rel.AI service is not configured.');
    const requestId = cleanText(envelope.request_id, 160);
    const method = String(envelope.method || '').toUpperCase();
    if (!requestId || !ALLOWED_METHODS.has(method) || envelope.path !== '/mcp') {
      throw new Error('The cloud relay request is outside the local MCP boundary.');
    }
    const body = decodeBase64Body(envelope.body_base64);
    if (body.byteLength > MAX_RELAY_BODY_BYTES) throw new Error('The cloud relay request body is too large.');

    const headers = new Headers();
    for (const [name, value] of Object.entries(envelope.headers || {})) {
      const normalized = String(name).toLowerCase();
      if (FORWARDED_REQUEST_HEADERS.has(normalized)) headers.set(normalized, String(value));
    }
    headers.set('authorization', `Bearer ${local.token}`);
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), LOCAL_MCP_TIMEOUT_MS);
    try {
      const response = await fetchImpl(new URL('/mcp', local.baseUrl), {
        method,
        headers,
        signal: controller.signal,
        ...(method === 'POST' ? { body } : {})
      });
      const responseBody = new Uint8Array(await response.arrayBuffer());
      if (responseBody.byteLength > MAX_RELAY_BODY_BYTES) throw new Error('The local MCP response is too large for the cloud relay.');
      const responseHeaders = {};
      for (const [name, value] of response.headers.entries()) {
        const normalized = name.toLowerCase();
        if (FORWARDED_RESPONSE_HEADERS.has(normalized)) responseHeaders[normalized] = value;
      }
      return {
        type: 'response',
        request_id: requestId,
        status: response.status,
        headers: responseHeaders,
        body_base64: Buffer.from(responseBody).toString('base64')
      };
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  function handleConnectionFailure(error, expectedGeneration) {
    if (!running || expectedGeneration !== generation) return;
    const message = safeMessage(error);
    updateStatus({ state: 'reconnecting', connected: false, lastError: message });
    scheduleReconnect(expectedGeneration);
  }

  function scheduleReconnect(expectedGeneration) {
    if (!running || reconnectTimer || expectedGeneration !== generation) return;
    reconnectAttempt += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * (2 ** Math.min(5, reconnectAttempt - 1)));
    updateStatus({ state: 'reconnecting', reconnectAttempt });
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      void connect(expectedGeneration).catch(error => handleConnectionFailure(error, expectedGeneration));
    }, delay);
  }

  function clearReconnect() {
    if (reconnectTimer) clearTimeoutImpl(reconnectTimer);
    reconnectTimer = null;
  }

  function closeSocket(code, reason) {
    const current = socket;
    socket = null;
    if (!current) return;
    try { current.close(code, reason); } catch {}
  }

  async function cloudJson(pathname, request = {}) {
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), CLOUD_REQUEST_TIMEOUT_MS);
    try {
      const headers = { accept: 'application/json', 'content-type': 'application/json' };
      if (request.bearer) headers.authorization = `Bearer ${request.bearer}`;
      const response = await fetchImpl(new URL(pathname, cloudBaseUrl), {
        method: request.method || 'GET',
        headers,
        signal: controller.signal,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) })
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 128 * 1024) throw new Error('Rel.AI Cloud returned an oversized control response.');
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (error) {
        throw new Error(`Rel.AI Cloud returned invalid JSON (HTTP ${response.status}).`, { cause: error });
      }
      if (!response.ok || body.ok === false) {
        throw new Error(cleanText(body?.error?.message || body?.error || `Rel.AI Cloud returned HTTP ${response.status}.`, 500));
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('Rel.AI Cloud did not respond before the request timeout.', { cause: error });
      }
      throw error;
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  function updateStatus(patch) {
    status = { ...status, ...patch, updatedAt: new Date().toISOString() };
    try { onStatusChange(getStatus()); } catch {}
  }

  return {
    start,
    stop,
    reconnect,
    createPairingCode,
    resetRegistration,
    getStatus
  };
}

function baseStatus(baseUrl) {
  return {
    state: 'stopped',
    baseUrl,
    mcpUrl: new URL('/mcp', baseUrl).href,
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

function normalizeCloudBaseUrl(value, options = {}) {
  const url = new URL(String(value || DEFAULT_CLOUD_URL));
  const insecureLocalhost = options.allowInsecureLocalhost === true
    && url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !insecureLocalhost) throw new Error('Rel.AI Cloud must use HTTPS.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Rel.AI Cloud URL must not contain credentials, query parameters, or fragments.');
  url.pathname = '/';
  return url.href;
}

function normalizeLocalConnection(value = {}) {
  const baseUrl = new URL(String(value.localUrl || value.baseUrl || ''));
  if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1' || baseUrl.username || baseUrl.password) {
    throw new Error('The cloud relay may connect only to the local Rel.AI service on 127.0.0.1.');
  }
  baseUrl.pathname = '/';
  baseUrl.search = '';
  baseUrl.hash = '';
  const token = String(value.token || '').trim();
  if (!token) throw new Error('The local Rel.AI bearer token is required for cloud relay forwarding.');
  return { baseUrl: baseUrl.href, token };
}

function validStoredRegistration(value) {
  return Boolean(value?.deviceId && value?.deviceToken && validKeyPair(value.publicKeyJwk, value.privateKeyJwk));
}

function validKeyPair(publicKeyJwk, privateKeyJwk) {
  return Boolean(
    publicKeyJwk?.kty === 'OKP'
    && publicKeyJwk?.crv === 'Ed25519'
    && typeof publicKeyJwk?.x === 'string'
    && privateKeyJwk?.kty === 'OKP'
    && privateKeyJwk?.crv === 'Ed25519'
    && typeof privateKeyJwk?.d === 'string'
  );
}

function attachSocketHandler(socket, event, handler) {
  if (typeof socket.addEventListener === 'function') socket.addEventListener(event, handler);
  else if (typeof socket.on === 'function') socket.on(event, handler);
  else socket[`on${event}`] = handler;
}

function socketMessageData(event) {
  const value = event?.data ?? event;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  return '';
}

function decodeBase64Body(value) {
  const text = String(value || '');
  if (text.length > encodedRelayLimit()) throw new Error('The cloud relay request body is too large.');
  return new Uint8Array(Buffer.from(text, 'base64'));
}

function encodedRelayLimit() {
  return Math.ceil(MAX_RELAY_BODY_BYTES / 3) * 4 + 64 * 1024;
}

function relayFailureResponse(requestId, error) {
  const payload = Buffer.from(JSON.stringify({
    ok: false,
    error: {
      code: 'LOCAL_RELAY_FAILED',
      message: safeMessage(error)
    }
  }), 'utf8');
  return {
    type: 'response',
    request_id: requestId,
    status: error?.name === 'AbortError' ? 504 : 502,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body_base64: payload.toString('base64')
  };
}

function safeMessage(error) {
  if (error?.name === 'AbortError') return 'The local Rel.AI MCP request timed out.';
  return cleanText(error instanceof Error ? error.message : error, 500) || 'Rel.AI Cloud relay failed.';
}

function cleanText(value, limit = 500) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export {
  DEFAULT_CLOUD_URL,
  MAX_RELAY_BODY_BYTES,
  createCloudRelayClient,
  normalizeCloudBaseUrl,
  normalizeLocalConnection
};
