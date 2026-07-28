

const TERMINOLOGY = Object.freeze({
  connection: 'Connection',
  approvalToken: 'Approval token',
  sessions: 'Sessions',
  activity: 'Activity',
  tools: 'Tools',
  workspace: 'Workspace'
});

const ERROR_CODES = Object.freeze({
  UNKNOWN: 'unknown',
  REQUEST_INVALID: 'request_invalid',
  CONFIGURATION_INVALID: 'configuration_invalid',
  LOCAL_SERVICE_START_FAILED: 'local_service_start_failed',
  LOCAL_SERVICE_STOP_FAILED: 'local_service_stop_failed',
  LOCAL_PORT_IN_USE: 'local_port_in_use',
  PUBLIC_ENDPOINT_FAILED: 'public_endpoint_failed',
  APPROVAL_TOKEN_REQUIRED: 'approval_token_required',
  APPROVAL_TOKEN_REJECTED: 'approval_token_rejected',
  DASHBOARD_UNAVAILABLE: 'dashboard_unavailable',
  WORKSPACE_UNAVAILABLE: 'workspace_unavailable',
  SETTINGS_SAVE_FAILED: 'settings_save_failed',
  DIAGNOSTICS_UNAVAILABLE: 'diagnostics_unavailable',
  DIAGNOSTICS_EXPORT_FAILED: 'diagnostics_export_failed',
  STATE_RESET_FAILED: 'state_reset_failed',
  UPDATE_FAILED: 'update_failed',
  UPDATE_NOT_SUPPORTED: 'update_not_supported',
  UPDATE_BUSY: 'update_busy',
  UPDATE_INSTALL_BLOCKED: 'update_install_blocked',
  STARTUP_SETTING_NOT_SUPPORTED: 'startup_setting_not_supported',
  STARTUP_SETTING_FAILED: 'startup_setting_failed',
  LIFECYCLE_STATE_FAILED: 'lifecycle_state_failed'
});

const ERROR_GUIDANCE = Object.freeze({
  [ERROR_CODES.UNKNOWN]: Object.freeze({ title: 'Unexpected error', recovery: 'Retry the action. Open Diagnostics if the problem continues.', actionLabel: 'Open Diagnostics', href: '#settings/diagnostics', retryable: true }),
  [ERROR_CODES.REQUEST_INVALID]: Object.freeze({ title: 'Request could not be read', recovery: 'Check the submitted values and try again.', actionLabel: 'Review the form', href: '', retryable: true }),
  [ERROR_CODES.CONFIGURATION_INVALID]: Object.freeze({ title: 'Configuration needs attention', recovery: 'Review Connection settings and correct the invalid value.', actionLabel: 'Open Connection settings', href: '#settings/connection', retryable: true }),
  [ERROR_CODES.LOCAL_SERVICE_START_FAILED]: Object.freeze({ title: 'Local service could not start', recovery: 'Open Diagnostics, review the service error, and retry after correcting the cause.', actionLabel: 'Open Diagnostics', href: '#settings/diagnostics', retryable: true }),
  [ERROR_CODES.LOCAL_SERVICE_STOP_FAILED]: Object.freeze({ title: 'Local service could not stop', recovery: 'Retry once. Restart the desktop app if the process remains active.', actionLabel: 'Open Diagnostics', href: '#settings/diagnostics', retryable: true }),
  [ERROR_CODES.LOCAL_PORT_IN_USE]: Object.freeze({ title: 'Local port is already in use', recovery: 'Choose another local port or stop the process using the configured port.', actionLabel: 'Open Connection settings', href: '#settings/connection', retryable: true }),
  [ERROR_CODES.PUBLIC_ENDPOINT_FAILED]: Object.freeze({ title: 'Public endpoint could not start', recovery: 'Review the ngrok account key and static domain, then restart the connection.', actionLabel: 'Open Connection', href: '#settings/connection', retryable: true }),
  [ERROR_CODES.APPROVAL_TOKEN_REQUIRED]: Object.freeze({ title: 'Approval is required', recovery: 'Approve the existing ChatGPT app with the current Rel.AI approval token.', actionLabel: 'Open Connection', href: '#settings/connection', retryable: false }),
  [ERROR_CODES.APPROVAL_TOKEN_REJECTED]: Object.freeze({ title: 'Approval token was rejected', recovery: 'Use the current token from Connection settings and approve the existing ChatGPT app again.', actionLabel: 'Open Connection settings', href: '#settings/connection', retryable: false }),
  [ERROR_CODES.DASHBOARD_UNAVAILABLE]: Object.freeze({ title: 'Dashboard is unavailable', recovery: 'Retry opening the dashboard. Use the recovery fallback only when the dashboard still cannot load.', actionLabel: 'Retry dashboard', href: '#home', retryable: true }),
  [ERROR_CODES.WORKSPACE_UNAVAILABLE]: Object.freeze({ title: 'Workspace is unavailable', recovery: 'Correct the workspace path or remove the obsolete workspace entry.', actionLabel: 'Open Workspaces', href: '#workspaces', retryable: true }),
  [ERROR_CODES.SETTINGS_SAVE_FAILED]: Object.freeze({ title: 'Settings could not be saved', recovery: 'Review the changed values and retry. Existing saved settings were preserved.', actionLabel: 'Open Settings', href: '#settings', retryable: true }),
  [ERROR_CODES.DIAGNOSTICS_UNAVAILABLE]: Object.freeze({ title: 'Diagnostics are unavailable', recovery: 'Refresh the dashboard. Restart the local service if diagnostics still cannot load.', actionLabel: 'Open Connection', href: '#settings/connection', retryable: true }),
  [ERROR_CODES.DIAGNOSTICS_EXPORT_FAILED]: Object.freeze({ title: 'Diagnostic report could not be copied', recovery: 'Retry the copy action or review the report directly on this page.', actionLabel: 'Open Diagnostics', href: '#settings/diagnostics', retryable: true }),
  [ERROR_CODES.STATE_RESET_FAILED]: Object.freeze({ title: 'Stored diagnostic data could not be cleared', recovery: 'Stop active Rel.AI calls and retry the selected reset action.', actionLabel: 'Open Activity', href: '#activity', retryable: true }),
  [ERROR_CODES.UPDATE_FAILED]: Object.freeze({ title: 'Update failed', recovery: 'Keep the current version and retry the update later.', actionLabel: 'Open Diagnostics', href: '#settings/diagnostics', retryable: true }),
  [ERROR_CODES.UPDATE_NOT_SUPPORTED]: Object.freeze({ title: 'Automatic updates are unavailable', recovery: 'Use the installed Windows app or download the current build from GitHub Releases.', actionLabel: 'Open General settings', href: '#settings', retryable: false }),
  [ERROR_CODES.UPDATE_BUSY]: Object.freeze({ title: 'Update action is already running', recovery: 'Wait for the current check, download, or installation step to finish.', actionLabel: 'Open General settings', href: '#settings', retryable: true }),
  [ERROR_CODES.UPDATE_INSTALL_BLOCKED]: Object.freeze({ title: 'Update restart is waiting', recovery: 'Let active Rel.AI tool calls finish, then restart to install the downloaded update.', actionLabel: 'Open Sessions', href: '#tasks', retryable: true }),
  [ERROR_CODES.STARTUP_SETTING_NOT_SUPPORTED]: Object.freeze({ title: 'Launch at sign-in is unavailable', recovery: 'Use the installed Windows app. Portable and browser builds cannot register a startup entry.', actionLabel: 'Open General settings', href: '#settings', retryable: false }),
  [ERROR_CODES.STARTUP_SETTING_FAILED]: Object.freeze({ title: 'Launch at sign-in could not be changed', recovery: 'Retry from General settings or review Windows startup-app permissions.', actionLabel: 'Open General settings', href: '#settings', retryable: true }),
  [ERROR_CODES.LIFECYCLE_STATE_FAILED]: Object.freeze({ title: 'Desktop lifecycle state could not be saved', recovery: 'Rel.AI can continue running, but update and recovery history may be incomplete. Review Diagnostics if this repeats.', actionLabel: 'Open Diagnostics', href: '#settings/diagnostics', retryable: true })
});

const CONNECTION_STATE_VALUES = Object.freeze({
  localService: Object.freeze(['running', 'starting', 'stopped', 'failed']),
  publicEndpoint: Object.freeze(['available', 'connecting', 'unavailable', 'disabled']),
  chatgptReadiness: Object.freeze(['ready', 'authentication_required', 'unavailable']),
  dashboardUpdates: Object.freeze(['live', 'connecting', 'reconnecting', 'paused', 'offline'])
});

const knownErrorCodes = new Set(Object.values(ERROR_CODES));
const localFailureCodes = new Set([
  ERROR_CODES.CONFIGURATION_INVALID,
  ERROR_CODES.LOCAL_SERVICE_START_FAILED,
  ERROR_CODES.LOCAL_SERVICE_STOP_FAILED,
  ERROR_CODES.LOCAL_PORT_IN_USE
]);
const authenticationCodes = new Set([
  ERROR_CODES.APPROVAL_TOKEN_REQUIRED,
  ERROR_CODES.APPROVAL_TOKEN_REJECTED
]);

function normalizeErrorCode(value) {
  const code = String(value || '').trim();
  if (!code) return '';
  return knownErrorCodes.has(code) ? code : ERROR_CODES.UNKNOWN;
}

function errorGuidance(value) {
  const code = normalizeErrorCode(value) || ERROR_CODES.UNKNOWN;
  return ERROR_GUIDANCE[code] || ERROR_GUIDANCE[ERROR_CODES.UNKNOWN];
}

function normalizeDashboardUpdateStatus(value) {
  const state = String(value || '').trim();
  if (CONNECTION_STATE_VALUES.dashboardUpdates.includes(state)) return state;
  if (state === 'stopped') return 'offline';
  return 'offline';
}

function deriveConnectionState(status = {}) {
  const errorCode = normalizeErrorCode(status.errorCode);
  const localServiceStatus = status.serverRunning === true
    ? 'running'
    : status.starting === true
      ? 'starting'
      : localFailureCodes.has(errorCode)
        ? 'failed'
        : 'stopped';

  let publicEndpointStatus = 'disabled';
  if (status.tunnelStatus === 'running' && status.mcpUrl) publicEndpointStatus = 'available';
  else if (status.tunnelStatus === 'connecting') publicEndpointStatus = 'connecting';
  else if (status.tunnelStatus === 'failed') publicEndpointStatus = 'unavailable';

  let chatgptReadinessStatus = 'unavailable';
  if (status.authenticationRequired === true || authenticationCodes.has(errorCode)) {
    chatgptReadinessStatus = 'authentication_required';
  } else if (localServiceStatus === 'running' && publicEndpointStatus === 'available') {
    chatgptReadinessStatus = 'ready';
  }

  const message = String(status.error || '').trim();
  return {
    localService: { status: localServiceStatus },
    publicEndpoint: { status: publicEndpointStatus },
    chatgptReadiness: { status: chatgptReadinessStatus },
    dashboardUpdates: { status: normalizeDashboardUpdateStatus(status.dashboardUpdateStatus) },
    error: message ? { code: errorCode || ERROR_CODES.UNKNOWN, message } : null
  };
}

function errorPayload(code, message, extra = {}) {
  const errorCode = normalizeErrorCode(code) || ERROR_CODES.UNKNOWN;
  const guidance = errorGuidance(errorCode);
  return {
    ...extra,
    ok: false,
    errorCode,
    error: String(message || 'Unknown error'),
    title: guidance.title,
    recovery: {
      message: guidance.recovery,
      actionLabel: guidance.actionLabel,
      href: guidance.href,
      retryable: guidance.retryable
    }
  };
}

export { TERMINOLOGY, ERROR_CODES, ERROR_GUIDANCE, CONNECTION_STATE_VALUES, normalizeErrorCode, errorGuidance, normalizeDashboardUpdateStatus, deriveConnectionState, errorPayload };
