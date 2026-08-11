import { importResourceModule } from './resource-path.js';

const { deriveConnectionState } = await importResourceModule('src/desktopUxContracts.js');

function initialDesktopStatus(version = '') {
  return normalizeDesktopStatus({
    serverRunning: false,
    connectionMode: '',
    tunnelStatus: 'stopped',
    mcpUrl: '',
    gateway: null,
    error: '',
    errorCode: '',
    localUrl: '',
    version,
    taskActivity: {
      state: 'idle',
      activeCalls: 0,
      activeTaskCount: 0,
      tasks: [],
      workspace: '',
      tool: '',
      startedAt: null,
      lastTask: null
    }
  });
}

function normalizeDesktopStatus(status = {}) {
  return { ...status, connectionState: deriveConnectionState(status) };
}

function desktopStatusFailure(errorCode, error, next = {}) {
  return {
    ...next,
    error: formatDesktopError(error),
    errorCode
  };
}

function gatewayAuthorizationRequired(status = {}) {
  const state = String(status.state || '');
  return state === 'pairing_required' || state === 'pairing';
}

function safeGatewayDesktopStatus(status = {}, gatewayOrigin = '') {
  const pairing = status.pairing && typeof status.pairing === 'object'
    ? {
        pairingId: String(status.pairing.pairingId || ''),
        enrollmentId: String(status.pairing.enrollmentId || ''),
        code: String(status.pairing.code || ''),
        expiresAt: Number(status.pairing.expiresAt || 0) || null
      }
    : null;
  return {
    state: String(status.state || 'offline'),
    gatewayOrigin: String(gatewayOrigin || status.gatewayOrigin || ''),
    principalPaired: status.principalPaired === true,
    deviceId: String(status.deviceId || ''),
    pairing,
    schemaVersion: Number(status.schemaVersion || 0) || null,
    schemaStatus: String(status.schemaStatus || ''),
    minimumProtocolVersion: Number(status.minimumProtocolVersion || 0) || null,
    currentProtocolVersion: Number(status.currentProtocolVersion || 0) || null,
    lastConnectedAt: Number(status.lastConnectedAt || 0) || null,
    lastRequestAt: Number(status.lastRequestAt || 0) || null,
    reconnectAttempt: Math.max(0, Math.floor(Number(status.reconnectAttempt) || 0)),
    error: String(status.error || '')
  };
}

function formatDesktopError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { desktopStatusFailure, gatewayAuthorizationRequired, initialDesktopStatus, normalizeDesktopStatus, safeGatewayDesktopStatus };
