

function createDesktopStatusModel({ version = '', deriveConnectionState, formatError } = {}) {
  if (typeof deriveConnectionState !== 'function') throw new TypeError('deriveConnectionState is required.');
  const format = typeof formatError === 'function'
    ? formatError
    : error => error instanceof Error ? error.message : String(error || 'Unknown error');
  const base = {
    serverRunning: false,
    tunnelStatus: 'stopped',
    mcpUrl: '',
    error: '',
    errorCode: '',
    localUrl: '',
    cloudRelay: {
      state: 'stopped', baseUrl: '', mcpUrl: '', registered: false, connected: false,
      deviceId: '', pairingCode: '', pairingExpiresAt: '', lastConnectedAt: '',
      reconnectAttempt: 0, lastError: '', updatedAt: ''
    },
    version,
    taskActivity: { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], workspace: '', tool: '', startedAt: null, lastTask: null }
  };
  const normalize = status => ({ ...status, connectionState: deriveConnectionState(status) });
  const failure = (errorCode, error, next = {}) => ({
    ...next,
    error: format(error),
    errorCode
  });
  return {
    initial: () => normalize({ ...base, taskActivity: { ...base.taskActivity, tasks: [] } }),
    normalize,
    failure
  };
}

export { createDesktopStatusModel };
