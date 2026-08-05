import { importResourceModule } from './resource-path.js';

const { deriveConnectionState } = await importResourceModule('src/desktopUxContracts.js');

function initialDesktopStatus(version = '') {
  return normalizeDesktopStatus({
    serverRunning: false,
    tunnelStatus: 'stopped',
    mcpUrl: '',
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

function formatDesktopError(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export { desktopStatusFailure, initialDesktopStatus, normalizeDesktopStatus };
