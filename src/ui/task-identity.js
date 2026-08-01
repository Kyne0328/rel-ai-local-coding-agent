export const TASK_ENTITY_IDENTIFIERS = Object.freeze({
  logicalTask: Object.freeze({ label: 'Logical task', field: 'task_id', purpose: 'Workspace coding objective' }),
  nativeTask: Object.freeze({ label: 'Native MCP task', field: 'taskId', purpose: 'One asynchronous MCP request' }),
  process: Object.freeze({ label: 'Managed process', field: 'processId', purpose: 'Managed command or development process' })
});

export const DASHBOARD_RUNTIME_HANDOFF_FIELDS = Object.freeze({
  endpoint: ['reachable', 'url', 'checkedAt', 'errorCode'],
  oauth: ['state', 'activeIssuer', 'persistedIssuer', 'corruptState', 'reRegistrationRequired', 'recoveryAction'],
  hostRequest: ['requestId', 'method', 'startedAt', 'completedAt', 'status', 'clientTasksCapability'],
  logicalTask: ['task_id', 'title', 'objective', 'workspace', 'status', 'validation', 'repairable'],
  nativeTask: ['taskId', 'status', 'inputRequired', 'resumable', 'errorCode', 'logicalTaskId'],
  process: ['processId', 'status', 'command', 'startedAt', 'endedAt', 'logicalTaskId'],
  connector: ['health', 'registrationId', 'issuer', 'refreshRequired', 'reRegistrationRequired']
});

export function taskEntityView(value = {}) {
  return {
    logicalTaskId: text(value.task_id || value.logicalTaskId || value.id),
    nativeTaskId: text(value.nativeTaskId || value.nativeTask?.taskId),
    processId: text(value.processId || value.process?.id)
  };
}

export function recoveryStateView(value = {}) {
  const state = text(value.recoveryState || value.nativeTask?.status || value.oauthRecovery?.state || value.connectorRecovery?.state).toLowerCase();
  const validationFailed = value.validation === 'failed' && value.repairable !== false;
  if (value.nativeTasksSupported === false) return view('Native Tasks unavailable', 'This host did not advertise native MCP Tasks support.', 'Refresh or recreate the connector with a compatible host.', 'warn');
  if (state === 'input_required') return view('Input required', 'The native MCP task is paused until the host supplies the requested input.', 'Return to the host request and provide the required input.', 'warn');
  if (state === 'interrupted_non_resumable') return view('Task interrupted', 'The native task cannot be resumed after interruption.', 'Start a new host request; keep the logical task for repair context.', 'bad');
  if (state === 'cancelled' || state === 'canceled') return view('Native task cancelled', 'The asynchronous MCP request ended without completing.', 'Review the logical task before starting another request.', 'warn');
  if (validationFailed) return view('Validation failed', 'The logical task remains repairable under the same task_id.', 'Repair the failure and validate again with the same logical task.', 'bad');
  if (state === 'issuer_disagreement') return view('OAuth issuer mismatch', 'The active issuer differs from the persisted issuer.', 'Use targeted connector recovery; do not reset unrelated registrations.', 'bad');
  if (state === 'corrupt_oauth_state') return view('OAuth state is corrupt', 'Stored OAuth state could not be read safely.', 'Repair only the affected issuer state, then reauthorize.', 'bad');
  if (state === 'connector_reregistration_required') return view('Connector refresh required', 'The current connector registration is no longer valid for this endpoint.', 'Refresh or recreate only the affected connector.', 'warn');
  return null;
}

function view(title, message, action, tone) {
  return { title, message, action, tone };
}

function text(value) {
  return String(value ?? '').trim();
}
