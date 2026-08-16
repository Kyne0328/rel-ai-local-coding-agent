import { ERROR_CODES } from '../desktopUxContracts.js';

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host || '').toLowerCase());
}

function errorCodeForRequest(req) {
  const path = String(req?.url || '').split('?')[0];
  if (path === '/api/workspaces' || path.startsWith('/api/workspace/')) return ERROR_CODES.WORKSPACE_UNAVAILABLE;
  if (path === '/api/diagnostics/reset') return ERROR_CODES.STATE_RESET_FAILED;
  if (path === '/api/diagnostics') return ERROR_CODES.DIAGNOSTICS_UNAVAILABLE;
  return ERROR_CODES.UNKNOWN;
}

export { errorCodeForRequest, isLoopbackHost };
