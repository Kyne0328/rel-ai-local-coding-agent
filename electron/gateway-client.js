import { randomUUID } from 'node:crypto';

import {
  GATEWAY_PROTOCOL_VERSION,
  MAX_GATEWAY_MESSAGE_BYTES,
  parseRecoveryCode,
  validWorkspaceAlias,
  validateGatewayFrame
} from '../src/gateway/protocol.js';
import { MCP_PROTOCOL_VERSION } from '../src/mcp/protocolConstants.js';
import { createGatewayState } from './gateway-state.js';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const CONTROL_TIMEOUT_MS = 15_000;

function createGatewayClient({
  gatewayOrigin,
  identity,
  WebSocketImpl = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  clock = defaultClock(),
  onRequest = async () => ({ ok: false, error: { code: 'LOCAL_EXECUTION_UNAVAILABLE', message: 'Local execution is unavailable.' } }),
  onStatus = () => {},
  getWorkspaces = () => [],
  capabilities = {},
  appVersion = 'unknown',
  mcpProtocolVersion = MCP_PROTOCOL_VERSION,
  displayName = 'Rel.AI Desktop',
  pairingPollMs = 1500,
  requestId = randomUUID
} = {}) {
  const origin = normalizeOrigin(gatewayOrigin);
  if (!identity?.open || !identity?.snapshot || !identity?.signChallenge || !identity?.setPrincipalState || !identity?.clearPrincipalState) {
    throw new TypeError('gateway identity is required.');
  }
  if (typeof WebSocketImpl !== 'function') throw new TypeError('WebSocket implementation is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required.');
  if (typeof onRequest !== 'function' || typeof onStatus !== 'function' || typeof getWorkspaces !== 'function') {
    throw new TypeError('gateway client callbacks are invalid.');
  }

  const state = createGatewayState({ gatewayOrigin: origin });
  const pendingControls = new Map();
  const inFlight = new Map();
  let started = false;
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let suppressReconnect = false;
  let pairingSession = null;
  let pairingTimer = null;

  async function start() {
    const current = await identity.open();
    started = true;
    suppressReconnect = false;
    update({
      principalPaired: current.paired === true,
      deviceId: current.deviceId,
      principalId: current.principalId || '',
      error: ''
    });
    if (!current.paired || !current.principalId) {
      update({ state: 'pairing_required' });
      return snapshot();
    }
    connect();
    return snapshot();
  }

  async function stop() {
    started = false;
    suppressReconnect = true;
    clearReconnect();
    clearPairingTimer();
    for (const entry of inFlight.values()) entry.controller.abort();
    inFlight.clear();
    rejectControls(new Error('Gateway client stopped.'));
    const currentSocket = socket;
    socket = null;
    if (currentSocket && currentSocket.readyState !== 3) {
      try { currentSocket.close(1000, 'Rel.AI gateway stopped.'); } catch {}
    }
    update({ state: 'offline', reconnectAttempt: 0 });
    return snapshot();
  }

  function snapshot() {
    return state.snapshot();
  }

  async function beginPairing(options = {}) {
    const recoveryCode = String(options.recoveryCode || '').trim();
    const recovery = recoveryCode ? parseRecoveryCode(recoveryCode) : null;
    if (recoveryCode && !recovery) throw new Error('Recovery code is invalid.');
    const current = await identity.open();
    clearPairingTimer();
    const response = await fetchGatewayJson(`${origin}/v1/pairings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: current.deviceId,
        publicJwk: current.publicJwk,
        displayName: boundedLabel(displayName, 120),
        appVersion: boundedLabel(appVersion, 80),
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        capabilities: safeCapabilities(capabilities),
        ...(recoveryCode ? { recoveryCode } : {})
      })
    });
    if (!response?.ok || !response.pairingId || !response.pollToken || !response.code) {
      throw new Error('Gateway pairing could not be started.');
    }
    pairingSession = {
      pairingId: String(response.pairingId),
      pollToken: String(response.pollToken),
      code: String(response.code),
      expiresAt: Number(response.expiresAt || 0),
      recoverySecret: recovery?.recoverySecret || ''
    };
    update({
      state: 'pairing',
      pairing: { pairingId: pairingSession.pairingId, code: pairingSession.code, expiresAt: pairingSession.expiresAt },
      error: ''
    });
    schedulePairingPoll();
    return { pairingId: pairingSession.pairingId, code: pairingSession.code, expiresAt: pairingSession.expiresAt };
  }

  function cancelPairing() {
    clearPairingTimer();
    pairingSession = null;
    update({ state: 'pairing_required', pairing: null });
    return snapshot();
  }

  function requestUsage(month) {
    return sendControl('usage_request', { ...(month ? { month } : {}) }, 'usage_result', frame => ({
      month: frame.month,
      totals: frame.totals,
      tools: frame.tools,
      devices: frame.devices,
      workspaces: frame.workspaces
    }));
  }

  function listDevices() {
    return sendControl('devices_request', {}, 'devices_result', frame => frame.devices);
  }

  async function revokeDevice(deviceId) {
    const normalized = String(deviceId || '').trim();
    if (!normalized) return Promise.reject(new Error('deviceId is required.'));
    const self = normalized === identity.snapshot().deviceId;
    const result = await sendControl('device_revoke', { deviceId: normalized }, 'device_revoke_result', frame => ({ ok: frame.ok, deviceId: frame.deviceId }));
    if (!result.ok || !self) return result;
    await identity.clearPrincipalState();
    clearReconnect();
    reconnectAttempt = 0;
    for (const entry of inFlight.values()) entry.controller.abort();
    inFlight.clear();
    rejectControls(new Error('This Rel.AI device was disconnected.'));
    const currentSocket = socket;
    socket = null;
    if (currentSocket && currentSocket.readyState !== 3) {
      try { currentSocket.close(1000, 'This Rel.AI device was disconnected.'); } catch {}
    }
    update({
      state: 'pairing_required',
      principalPaired: false,
      principalId: '',
      pairing: null,
      schemaVersion: null,
      manifestHash: '',
      schemaStatus: '',
      minimumProtocolVersion: null,
      currentProtocolVersion: null,
      observedAt: null,
      lastRequestAt: null,
      reconnectAttempt: 0,
      error: ''
    });
    return { ...result, selfRevoked: true };
  }

  function createDeviceLink() {
    return sendControl('device_link_request', {}, 'device_link_result', frame => ({
      ok: frame.ok === true,
      ...(frame.ok ? { linkCode: String(frame.linkCode || ''), expiresAt: Number(frame.expiresAt || 0) } : { code: String(frame.code || 'DEVICE_LINK_FAILED') })
    }));
  }

  function connect() {
    if (!started || suppressReconnect) return;
    const current = identity.snapshot();
    if (!current.paired || !current.principalId) {
      update({ state: 'pairing_required' });
      return;
    }
    clearReconnect();
    update({ state: 'connecting', reconnectAttempt, error: '' });
    const url = deviceSocketUrl(origin, current.principalId, current.deviceId);
    let nextSocket;
    try {
      nextSocket = new WebSocketImpl(url);
    } catch (error) {
      handleTransportFailure(error);
      return;
    }
    socket = nextSocket;
    nextSocket.addEventListener('open', () => {
      if (nextSocket !== socket || !started) return;
      update({ state: 'authenticating' });
    });
    nextSocket.addEventListener('message', event => {
      void handleMessage(nextSocket, event?.data);
    });
    nextSocket.addEventListener('close', event => {
      if (nextSocket !== socket) return;
      socket = null;
      for (const entry of inFlight.values()) entry.controller.abort();
      inFlight.clear();
      rejectControls(new Error('Gateway connection closed.'));
      if (!started || suppressReconnect) return;
      update({ state: 'offline', error: event?.reason ? String(event.reason) : '' });
      scheduleReconnect();
    });
    nextSocket.addEventListener('error', () => {
      if (nextSocket !== socket || !started) return;
      update({ state: 'offline', error: 'Gateway connection failed.' });
    });
  }

  async function handleMessage(currentSocket, raw) {
    if (currentSocket !== socket || !started) return;
    if (typeof raw !== 'string') {
      protocolFailure(currentSocket, 'Gateway frame must be text.');
      return;
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_GATEWAY_MESSAGE_BYTES) {
      protocolFailure(currentSocket, 'Gateway frame exceeds the maximum size.');
      return;
    }
    let frame;
    try { frame = JSON.parse(raw); } catch {
      protocolFailure(currentSocket, 'Gateway frame is not valid JSON.');
      return;
    }
    if (frame?.type === 'challenge' && frame.protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
      suppressReconnect = true;
      update({ state: 'device_update_required', error: 'Rel.AI Desktop must be updated for the gateway protocol.' });
      try { currentSocket.close(1008, 'Device update required.'); } catch {}
      return;
    }
    const validation = validateGatewayFrame(frame);
    if (!validation.ok) {
      protocolFailure(currentSocket, validation.error || 'Gateway frame is invalid.');
      return;
    }
    if (frame.type === 'challenge') {
      await authenticate(currentSocket, frame);
      return;
    }
    if (frame.type === 'authenticated') {
      handleAuthenticated(currentSocket, frame);
      return;
    }
    if (frame.type === 'request') {
      if (frame.synchronization) updateSynchronization(frame.synchronization);
      await handleRequestFrame(currentSocket, frame);
      return;
    }
    if (frame.type === 'cancel') {
      const entry = inFlight.get(frame.requestKey);
      if (entry && entry.gatewayRequestId === frame.gatewayRequestId) entry.controller.abort();
      return;
    }
    if (['usage_result', 'devices_result', 'device_revoke_result', 'device_link_result'].includes(frame.type)) {
      settleControl(frame);
      return;
    }
    if (frame.type === 'heartbeat') return;
    if (frame.type === 'error') {
      update({ error: frame.message || frame.code || 'Gateway error.' });
      return;
    }
    protocolFailure(currentSocket, 'Unexpected gateway frame.');
  }

  async function authenticate(currentSocket, frame) {
    const current = identity.snapshot();
    if (
      frame.principalId !== current.principalId ||
      frame.deviceId !== current.deviceId ||
      !Number.isFinite(frame.expiresAt) ||
      frame.expiresAt <= clock.now()
    ) {
      protocolFailure(currentSocket, 'Gateway challenge does not match this device.');
      return;
    }
    const signature = await identity.signChallenge(frame);
    sendFrame(currentSocket, {
      type: 'authenticate',
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      principalId: frame.principalId,
      deviceId: frame.deviceId,
      nonce: frame.nonce,
      expiresAt: frame.expiresAt,
      signature
    });
  }

  function handleAuthenticated(currentSocket, frame) {
    const current = identity.snapshot();
    if ((frame.principalId && frame.principalId !== current.principalId) || (frame.deviceId && frame.deviceId !== current.deviceId)) {
      protocolFailure(currentSocket, 'Gateway authenticated the wrong device.');
      return;
    }
    reconnectAttempt = 0;
    update({ state: 'connected', lastConnectedAt: clock.now(), reconnectAttempt: 0, error: '' });
    sendFrame(currentSocket, {
      type: 'capabilities',
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      appVersion: boundedLabel(appVersion, 80),
      mcpProtocolVersion: boundedLabel(mcpProtocolVersion, 80),
      capabilities: safeCapabilities(capabilities)
    });
    sendFrame(currentSocket, { type: 'workspaces', aliases: safeWorkspaces(getWorkspaces()) });
  }

  function updateSynchronization(value = {}) {
    update({
      schemaVersion: Number(value.schemaVersion || 0) || null,
      manifestHash: String(value.manifestHash || ''),
      schemaStatus: String(value.status || ''),
      minimumProtocolVersion: Number(value.minimumProtocolVersion || 0) || null,
      currentProtocolVersion: Number(value.currentProtocolVersion || 0) || null,
      observedAt: Number(value.observedAt || 0) || null
    });
  }

  async function handleRequestFrame(currentSocket, frame) {
    const controller = new AbortController();
    const startedAt = clock.now();
    update({ lastRequestAt: startedAt });
    inFlight.set(frame.requestKey, { controller, gatewayRequestId: frame.gatewayRequestId });
    sendFrame(currentSocket, { type: 'accepted', gatewayRequestId: frame.gatewayRequestId, requestKey: frame.requestKey });
    let outcome;
    try {
      outcome = await onRequest({
        principalId: identity.snapshot().principalId,
        gatewayRequestId: frame.gatewayRequestId,
        requestKey: frame.requestKey,
        message: frame.message,
        workspace: frame.workspace || '',
        deadlineAt: frame.expiresAt || null,
        signal: controller.signal
      });
    } catch {
      outcome = { ok: false, error: { code: controller.signal.aborted ? 'CANCELLED' : 'LOCAL_EXECUTION_FAILED', message: controller.signal.aborted ? 'Cancelled.' : 'Local execution failed.' } };
    } finally {
      inFlight.delete(frame.requestKey);
    }
    if (currentSocket !== socket || currentSocket.readyState === 3) return;
    const normalized = normalizeExecutionOutcome(outcome, clock.now() - startedAt);
    sendFrame(currentSocket, {
      type: 'result',
      gatewayRequestId: frame.gatewayRequestId,
      requestKey: frame.requestKey,
      ok: normalized.ok,
      ...(normalized.payload !== undefined ? { payload: normalized.payload } : {}),
      ...(normalized.error !== undefined ? { error: normalized.error } : {}),
      durationMs: normalized.durationMs
    });
  }

  function sendControl(type, fields, expectedType, project) {
    if (!socket || socket.readyState !== 1 || state.snapshot().state !== 'connected') {
      return Promise.reject(new Error('Gateway is not connected.'));
    }
    const id = `ctl_${requestId()}`;
    const frame = { type, requestId: id, ...fields };
    sendFrame(socket, frame);
    return new Promise((resolve, reject) => {
      const timer = clock.setTimeout(() => {
        pendingControls.delete(id);
        reject(new Error('Gateway control request timed out.'));
      }, CONTROL_TIMEOUT_MS);
      pendingControls.set(id, { expectedType, resolve, reject, timer, project });
    });
  }

  function settleControl(frame) {
    const pending = pendingControls.get(frame.requestId);
    if (!pending || pending.expectedType !== frame.type) return;
    pendingControls.delete(frame.requestId);
    clock.clearTimeout(pending.timer);
    pending.resolve(pending.project(frame));
  }

  function rejectControls(error) {
    for (const entry of pendingControls.values()) {
      clock.clearTimeout(entry.timer);
      entry.reject(error);
    }
    pendingControls.clear();
  }

  function sendFrame(target, frame) {
    const validation = validateGatewayFrame(frame);
    if (!validation.ok) throw new Error(validation.error || 'Gateway frame is invalid.');
    target.send(JSON.stringify(frame));
  }

  function protocolFailure(target, message) {
    suppressReconnect = true;
    update({ state: 'error', error: String(message || 'Gateway protocol error.') });
    try { target.close(1008, 'Gateway protocol error.'); } catch {}
  }

  function handleTransportFailure(error) {
    update({ state: 'offline', error: messageOf(error) });
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (!started || suppressReconnect || reconnectTimer) return;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.min(reconnectAttempt, 10)));
    const jitter = 0.8 + Math.max(0, Math.min(1, Number(clock.random()))) * 0.4;
    const delay = Math.max(RECONNECT_BASE_MS, Math.min(RECONNECT_MAX_MS, Math.round(base * jitter)));
    reconnectAttempt += 1;
    update({ reconnectAttempt });
    reconnectTimer = clock.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function clearReconnect() {
    if (reconnectTimer) clock.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function schedulePairingPoll() {
    clearPairingTimer();
    if (!started || !pairingSession) return;
    pairingTimer = clock.setTimeout(async () => {
      pairingTimer = null;
      await pollPairing();
    }, Math.max(500, Number(pairingPollMs) || 1500));
  }

  async function pollPairing() {
    if (!pairingSession || !started) return;
    if (pairingSession.expiresAt && pairingSession.expiresAt <= clock.now()) {
      pairingSession = null;
      update({ state: 'pairing_required', pairing: null, error: 'Pairing expired.' });
      return;
    }
    try {
      const result = await fetchGatewayJson(`${origin}/v1/pairings/${encodeURIComponent(pairingSession.pairingId)}`, {
        headers: { 'X-RelAI-Pairing-Token': pairingSession.pollToken }
      });
      if (result.status === 'pending') {
        schedulePairingPoll();
        return;
      }
      const recoverySecret = String(result.recoverySecret || pairingSession.recoverySecret || '');
      if (result.status !== 'paired' || !result.principalId || !recoverySecret) {
        throw new Error('Pairing completion did not include recoverable principal state.');
      }
      await identity.setPrincipalState({ principalId: String(result.principalId), recoverySecret });
      pairingSession = null;
      update({
        state: 'connecting',
        pairing: null,
        principalPaired: true,
        principalId: identity.snapshot().principalId,
        error: ''
      });
      connect();
    } catch (error) {
      update({ state: 'pairing', error: messageOf(error) });
      schedulePairingPoll();
    }
  }

  function clearPairingTimer() {
    if (pairingTimer) clock.clearTimeout(pairingTimer);
    pairingTimer = null;
  }

  async function fetchGatewayJson(url, options = {}) {
    const response = await fetchImpl(url, options);
    if (!response?.ok) throw new Error(`Gateway request failed with HTTP ${response?.status || 0}.`);
    return response.json();
  }

  function update(patch) {
    const next = state.update(patch);
    try { onStatus(next); } catch {}
    return next;
  }

  return Object.freeze({
    start,
    stop,
    snapshot,
    beginPairing,
    cancelPairing,
    requestUsage,
    listDevices,
    revokeDevice,
    createDeviceLink
  });
}

function normalizeOrigin(value) {
  const url = new URL(String(value || ''));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Gateway origin must use HTTP or HTTPS.');
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function deviceSocketUrl(origin, principalId, deviceId) {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/v1/principals/${encodeURIComponent(principalId)}/devices/${encodeURIComponent(deviceId)}/socket`;
  return url.toString();
}

function safeWorkspaces(values) {
  const aliases = Array.isArray(values) ? values : [];
  return [...new Set(aliases.map(value => String(value || '').trim()).filter(validWorkspaceAlias))].sort();
}

function safeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function boundedLabel(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return 'unknown';
  return text.slice(0, maxLength);
}

function normalizeExecutionOutcome(value, measuredDurationMs) {
  const durationMs = Number.isFinite(Number(value?.durationMs)) && Number(value.durationMs) >= 0
    ? Math.min(24 * 60 * 60 * 1000, Math.floor(Number(value.durationMs)))
    : Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.floor(Number(measuredDurationMs) || 0)));
  if (value && typeof value === 'object' && typeof value.ok === 'boolean') {
    return {
      ok: value.ok,
      ...(value.payload !== undefined ? { payload: value.payload } : {}),
      ...(value.error !== undefined ? { error: value.error } : {}),
      durationMs
    };
  }
  return { ok: true, payload: value, durationMs };
}

function defaultClock() {
  return {
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id)
  };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown gateway error.');
}

export { createGatewayClient };
