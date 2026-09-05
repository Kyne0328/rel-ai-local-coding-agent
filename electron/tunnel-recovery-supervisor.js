const DEFAULT_RETRY_DELAYS_MS = Object.freeze([1000, 2000, 5000, 10000, 30000]);
const TERMINAL_TUNNEL_CODES = new Set([
  'tunnel_authentication_failed',
  'tunnel_access_denied',
  'tunnel_not_found',
  'tunnel_runtime_unavailable'
]);

function createTunnelRecoverySupervisor({
  restartConnection,
  onSchedule = () => {},
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof restartConnection !== 'function') throw new TypeError('restartConnection is required.');
  if (typeof onSchedule !== 'function') throw new TypeError('onSchedule must be a function.');

  const delays = normalizeRetryDelays(retryDelaysMs);
  let retryTimer = null;
  let inFlight = null;
  let attempt = 0;
  let nextRetryAt = null;
  let recoveryGeneration = 0;

  function observe(status = {}) {
    const tunnelStatus = String(status.state || status.tunnelStatus || '');
    const errorCode = String(status.errorCode || '');
    if (tunnelStatus === 'running') {
      reset(true);
      return snapshot();
    }
    if (tunnelStatus === 'failed') {
      if (isTerminalTunnelCode(errorCode)) {
        reset(true);
        return snapshot();
      }
      schedule(status.error || 'The Secure MCP Tunnel stopped unexpectedly.');
      return snapshot();
    }
    if (tunnelStatus === 'stopped' && !inFlight) reset();
    return snapshot();
  }

  function schedule(lastError = '') {
    if (retryTimer || inFlight) return snapshot();
    const runGeneration = recoveryGeneration;
    attempt += 1;
    const delayMs = delays[Math.min(attempt - 1, delays.length - 1)];
    nextRetryAt = now() + delayMs;
    onSchedule({ attempt, delayMs, nextRetryAt, lastError: String(lastError || '') });
    retryTimer = setTimer(() => {
      retryTimer = null;
      nextRetryAt = null;
      if (runGeneration !== recoveryGeneration) return;
      void runAttempt(runGeneration);
    }, delayMs);
    return snapshot();
  }

  function retryNow() {
    clearScheduledRetry();
    attempt = 0;
    return runAttempt();
  }

  async function runAttempt(runGeneration = recoveryGeneration) {
    if (inFlight) return inFlight;
    const pending = Promise.resolve()
      .then(restartConnection)
      .catch(error => ({
        serverRunning: true,
        tunnelStatus: 'failed',
        errorCode: String(error?.code || 'secure_tunnel_failed'),
        error: error instanceof Error ? error.message : String(error || 'Secure MCP Tunnel retry failed.')
      }));
    inFlight = pending;
    const status = await pending;
    if (inFlight === pending) inFlight = null;
    if (runGeneration !== recoveryGeneration) return status;

    const tunnelStatus = String(status?.tunnelStatus || status?.state || '');
    const errorCode = String(status?.errorCode || '');
    if (tunnelStatus === 'running' || isTerminalTunnelCode(errorCode) || status?.serverRunning === false) {
      reset();
      return status;
    }
    schedule(status?.error || 'The Secure MCP Tunnel is still unavailable.');
    return status;
  }

  function cancel() {
    reset(true);
    return snapshot();
  }

  function reset(invalidateInFlight = false) {
    if (invalidateInFlight) recoveryGeneration += 1;
    clearScheduledRetry();
    attempt = 0;
    nextRetryAt = null;
  }

  function clearScheduledRetry() {
    if (!retryTimer) return;
    clearTimer(retryTimer);
    retryTimer = null;
    nextRetryAt = null;
  }

  function snapshot() {
    return Object.freeze({
      attempt,
      nextRetryAt,
      scheduled: Boolean(retryTimer),
      inFlight: Boolean(inFlight)
    });
  }

  return Object.freeze({ observe, retryNow, cancel, snapshot });
}

function normalizeRetryDelays(values) {
  const delays = Array.isArray(values)
    ? values.map(Number).filter(value => Number.isFinite(value) && value >= 0)
    : [];
  return delays.length ? delays : [...DEFAULT_RETRY_DELAYS_MS];
}

function isTerminalTunnelCode(value) {
  return TERMINAL_TUNNEL_CODES.has(String(value || ''));
}

export { createTunnelRecoverySupervisor };
