import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const CONNECTION_STATES = Object.freeze(['stopped', 'starting', 'ready', 'degraded', 'failed']);

class McpConnectionManager {
  constructor(options = {}) {
    this.clock = options.clock || (() => Date.now());
    this.events = new EventEmitter();
    this.eventHistory = [];
    this.metrics = emptyMetrics();
    this.revision = 0;
    this.state = 'stopped';
    this.serverInstanceId = '';
    this.credentialGeneration = 0;
    this.configurationGeneration = 0;
    this.manifest = null;
    this.lastDisconnectReason = '';
    this.lastRecoveryResult = '';
    this.lastRequestAt = null;
    this.lastRequestMethod = '';
    this.lastPrincipal = '';
  }

  configure({ serverInstanceId, credentialGeneration, configurationGeneration, manifest }) {
    this.metrics = emptyMetrics();
    this.serverInstanceId = String(serverInstanceId || crypto.randomUUID());
    this.credentialGeneration = Number(credentialGeneration || 1);
    this.configurationGeneration = Number(configurationGeneration || 1);
    this.manifest = manifest || null;
    this.state = 'starting';
    this.lastDisconnectReason = '';
    this.lastRecoveryResult = '';
    this.lastRequestAt = null;
    this.lastRequestMethod = '';
    this.lastPrincipal = '';
    this.record('mcp_server_starting', { requestModel: 'stateless' });
    return this.snapshot();
  }

  markReady() {
    this.state = 'ready';
    this.record('mcp_server_ready', { requestModel: 'stateless' });
  }

  markFailed(error) {
    this.state = 'failed';
    this.record('mcp_server_failed', { reasonCode: 'server_error', outcome: messageOf(error) });
  }

  async shutdown(reason = 'server_shutdown') {
    this.state = 'stopped';
    this.lastDisconnectReason = String(reason || 'server_shutdown');
    this.record('mcp_server_stopped', { reasonCode: this.lastDisconnectReason });
  }

  noteRequest({ principal = '', method = '', clientInfo = {}, clientCapabilities = {} } = {}) {
    const now = this.clock();
    this.lastRequestAt = now;
    this.lastRequestMethod = String(method || '');
    this.lastPrincipal = safeId(principal);
    this.metrics.requestsReceived += 1;
    if (this.lastRequestMethod === 'server/discover') this.metrics.discoveryRequests += 1;
    if (this.lastRequestMethod === 'tools/list') this.metrics.toolListRequests += 1;
    if (this.lastRequestMethod.startsWith('tasks/')) this.metrics.taskRequests += 1;
    this.record('mcp_request_received', {
      method: this.lastRequestMethod,
      principal: this.lastPrincipal,
      clientInfo: safeClientInfo(clientInfo),
      clientCapabilities: safeClientCapabilities(clientCapabilities)
    });
    if (this.state === 'degraded') this.state = 'ready';
    return this.snapshot();
  }

  noteRequestResult(method, ok = true) {
    if (ok) this.metrics.requestsSucceeded += 1;
    else this.metrics.requestsFailed += 1;
    this.record(ok ? 'mcp_request_succeeded' : 'mcp_request_failed', { method: String(method || '') });
  }

  async observeManifest(manifest, triggerMethod = '') {
    if (!manifest) return false;
    if (this.manifest?.version === manifest.version) return false;
    const previous = this.manifest;
    this.manifest = manifest;
    this.metrics.toolManifestChanges += 1;
    this.record('tool_manifest_changed', {
      triggerMethod: String(triggerMethod || ''),
      previousToolManifestVersion: previous?.version || '',
      toolManifestVersion: manifest.version,
      activeToolCount: manifest.activeToolCount
    });
    return true;
  }

  async invalidateCredentials(nextGeneration, reason = 'approval_token_rotated') {
    this.credentialGeneration = Number(nextGeneration || this.credentialGeneration + 1);
    this.record('credential_generation_changed', { reasonCode: reason });
    this.record('approval_token_rotated', { reasonCode: reason });
    return this.snapshot();
  }

  async retryConnection(reason = 'manual_retry') {
    this.lastRecoveryResult = 'not_required_stateless';
    this.metrics.manualRecoveryRequests += 1;
    this.record('stateless_recovery_not_required', { reasonCode: reason });
    return {
      ok: true,
      stateless: true,
      hostActionRequired: false,
      message: 'The MCP 2026-07-28 endpoint is stateless; there is no transport session to restart.'
    };
  }

  snapshot() {
    return {
      status: this.state,
      requestModel: 'stateless',
      protocolVersion: '2026-07-28',
      serverInstanceId: this.serverInstanceId,
      configurationGeneration: this.configurationGeneration,
      credentialGeneration: this.credentialGeneration,
      toolManifestVersion: this.manifest?.version || '',
      toolManifestHash: this.manifest?.hash || '',
      currentActiveToolCount: this.manifest?.activeToolCount || 0,
      disabledToolCount: this.manifest?.disabledToolCount || 0,
      filteredToolCount: this.manifest?.filteredToolCount || 0,
      externallyVisibleToolCount: this.manifest?.externallyVisibleToolCount || 0,
      connectedClientCount: 0,
      connectedPrincipalCount: 0,
      activeSessions: [],
      recentSessions: [],
      reconnectAttemptCount: 0,
      lastDisconnectReason: this.lastDisconnectReason,
      lastRecoveryResult: this.lastRecoveryResult,
      manualRecoveryRequired: false,
      lastRequestAt: iso(this.lastRequestAt),
      lastRequestMethod: this.lastRequestMethod,
      lastPrincipal: this.lastPrincipal,
      metrics: { ...this.metrics },
      recentEvents: this.eventHistory.slice(-50),
      revision: this.revision,
      generatedAt: new Date(this.clock()).toISOString()
    };
  }

  record(type, fields = {}) {
    const event = {
      eventId: crypto.randomUUID(),
      type,
      timestamp: new Date(this.clock()).toISOString(),
      serverInstanceId: this.serverInstanceId,
      credentialGeneration: this.credentialGeneration,
      configurationGeneration: this.configurationGeneration,
      toolManifestVersion: this.manifest?.version || '',
      ...redactFields(fields)
    };
    this.eventHistory.push(event);
    this.eventHistory = this.eventHistory.slice(-200);
    this.revision += 1;
    this.events.emit('event', event);
    this.events.emit('change', this.snapshot());
    return event;
  }

  onChange(listener) {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }
}

function emptyMetrics() {
  return {
    requestsReceived: 0,
    requestsSucceeded: 0,
    requestsFailed: 0,
    discoveryRequests: 0,
    toolListRequests: 0,
    taskRequests: 0,
    manualRecoveryRequests: 0,
    toolManifestChanges: 0,
    clientsConnected: 0,
    clientsDisconnected: 0,
    staleSessionsDetected: 0,
    capabilityMismatches: 0,
    toolListNotificationsSent: 0,
    reconnectStarted: 0,
    reconnectSucceeded: 0,
    reconnectFailed: 0,
    manualRecoveryRequired: 0
  };
}

function safeId(value) {
  const text = String(value || '');
  return text ? crypto.createHash('sha256').update(text).digest('base64url').slice(0, 12) : '';
}

function safeClientCapabilities(value) {
  const extensions = value?.extensions && typeof value.extensions === 'object'
    ? Object.fromEntries(Object.keys(value.extensions).sort().map(key => [String(key).slice(0, 160), {}]))
    : {};
  return { extensions };
}

function safeClientInfo(value) {
  return {
    name: String(value?.name || '').slice(0, 120),
    version: String(value?.version || '').slice(0, 80)
  };
}

function redactFields(value) {
  const result = {};
  for (const [key, field] of Object.entries(value || {})) {
    if (/token|authorization|secret|password/i.test(key)) continue;
    if (field !== undefined) result[key] = field;
  }
  return result;
}

function iso(value) {
  const number = Number(value || 0);
  return number > 0 ? new Date(number).toISOString() : null;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

const mcpConnectionManager = new McpConnectionManager();

export { CONNECTION_STATES, McpConnectionManager, mcpConnectionManager, redactFields, safeId };
