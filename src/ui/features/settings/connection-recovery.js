import { requestDashboardRefresh } from '../../api.js';

export function connectionRestartResult(status = {}) {
  const tunnelStatus = String(status?.tunnelStatus || '');
  if (status?.serverRunning === false) {
    return {
      ok: false,
      status,
      error: 'Rel.AI could not restart the local connection. Restart Rel.AI, then try again.'
    };
  }
  if (tunnelStatus === 'failed' || tunnelStatus === 'stopped') {
    return {
      ok: false,
      status,
      error: 'The local connection restarted, but the Secure MCP Tunnel is still unavailable. Review the Tunnel ID and runtime API key in Connection settings.'
    };
  }
  return { ok: true, status };
}

export async function restartConnection() {
  if (typeof window.relaiDesktop?.restartConnection !== 'function') {
    return { ok: false, error: 'Retrying the connection is available in the installed Rel.AI desktop app.' };
  }
  try {
    const status = await window.relaiDesktop.restartConnection();
    requestDashboardRefresh({ structural: true });
    return connectionRestartResult(status);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error || 'Connection retry failed.') };
  }
}
