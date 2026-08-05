import { isNativeTaskStatus, isTerminalDashboardTaskStatus } from '../taskState.js';

const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks';
const PROCESS_ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);

export const TASK_ENTITY_IDENTIFIERS = Object.freeze({
  logicalTask: Object.freeze({ label: 'Work session', field: 'work_id', purpose: 'Repository objective spanning multiple tool calls' }),
  nativeTask: Object.freeze({ label: 'Native MCP task', field: 'taskId', purpose: 'One asynchronous MCP request' }),
  process: Object.freeze({ label: 'Managed process', field: 'processId', purpose: 'One operating-system process' })
});

export const DASHBOARD_RUNTIME_HANDOFF_FIELDS = Object.freeze({
  endpoint: ['reachable', 'url', 'checkedAt', 'errorCode'],
  oauth: ['state', 'activeIssuer', 'persistedIssuer', 'corruptState', 'reRegistrationRequired', 'recoveryAction'],
  hostRequest: ['requestId', 'connectionId', 'method', 'startedAt', 'completedAt', 'status', 'clientInfo', 'clientCapabilities', 'clientTasksCapability', 'executionMode'],
  logicalTask: ['work_id', 'title', 'objective', 'workspace', 'status', 'validation', 'repairable', 'startedAt', 'updatedAt', 'endedAt'],
  nativeTask: ['taskId', 'status', 'statusMessage', 'createdAt', 'lastUpdatedAt', 'origin', 'logicalTaskId', 'inputRequired', 'resumable', 'errorCode', 'cancelRequested', 'cancellationRequestedAt', 'cancellationAcknowledgedAt', 'result', 'error', 'internal', 'actions'],
  process: ['processId', 'status', 'commandSummary', 'startedAt', 'endedAt', 'exitCode', 'workSessionId', 'originatingTaskId', 'lifecycle', 'stdoutBytes', 'stderrBytes', 'stdoutTail', 'stderrTail'],
  connector: ['health', 'registrationId', 'issuer', 'refreshRequired', 'reRegistrationRequired']
});

export function taskEntityView(value = {}) {
  return {
    logicalTaskId: text(value.work_id || value.logicalTaskId || value.workSessionId || value.id),
    nativeTaskId: text(value.nativeTaskId || value.originatingTaskId || value.nativeTask?.taskId),
    processId: text(value.processId || value.process?.processId || value.process?.id)
  };
}

export function clientCapabilityViews(data = {}) {
  const candidates = capabilityCandidates(data);
  if (!candidates.length) return [clientCapabilityView({})];
  const seen = new Set();
  const views = [];
  for (const candidate of candidates) {
    const view = clientCapabilityView(candidate);
    const key = view.connectionId || `${view.clientLabel}:${view.observedAt}:${view.capabilityState}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push(view);
  }
  return views.slice(0, 8);
}

export function clientCapabilityView(value = {}) {
  const support = observedTasksSupport(value);
  const explicitMode = executionMode(value.executionMode || value.taskExecutionMode || value.clientTasksCapability?.mode || value.mode);
  const mode = explicitMode !== 'unknown'
    ? explicitMode
    : support === 'supported'
      ? 'native_tasks'
      : support === 'not_advertised'
        ? 'bounded_synchronous'
        : 'unknown';
  const clientInfo = value.clientInfo && typeof value.clientInfo === 'object' ? value.clientInfo : {};
  const clientName = text(value.clientName || clientInfo.name);
  const clientVersion = text(value.clientVersion || clientInfo.version);
  const clientLabel = clientName
    ? `${clientName}${clientVersion ? ` ${clientVersion}` : ''}`
    : 'Observed MCP client';
  const connectionId = text(value.connectionId || value.requestId || value.id || value.principal);
  const observedAt = text(value.observedAt || value.startedAt || value.timestamp || value.lastRequestAt || value.generatedAt);

  if (support === 'supported') {
    return {
      connectionId,
      clientLabel,
      observedAt,
      capabilityState: support,
      capabilityLabel: 'Native MCP Tasks: Supported',
      executionMode: mode,
      executionLabel: mode === 'bounded_synchronous'
        ? 'Execution mode: Bounded synchronous fallback'
        : 'Execution mode: Native asynchronous',
      description: 'The client advertised the MCP Tasks extension for this observed connection.',
      pill: 'supported',
      pillClass: 'ok'
    };
  }
  if (support === 'not_advertised') {
    return {
      connectionId,
      clientLabel,
      observedAt,
      capabilityState: support,
      capabilityLabel: 'Native MCP Tasks: Not advertised by client',
      executionMode: mode,
      executionLabel: mode === 'native_tasks'
        ? 'Execution mode: Native asynchronous'
        : 'Execution mode: Bounded synchronous fallback',
      description: 'This is a client capability choice, not a Rel.AI server failure.',
      pill: 'not advertised',
      pillClass: 'warn'
    };
  }
  return {
    connectionId,
    clientLabel,
    observedAt,
    capabilityState: 'unknown',
    capabilityLabel: 'Native MCP Tasks: Unknown',
    executionMode: mode,
    executionLabel: mode === 'native_tasks'
      ? 'Execution mode: Native asynchronous'
      : mode === 'bounded_synchronous'
        ? 'Execution mode: Bounded synchronous fallback'
        : 'Execution mode: Unknown',
    description: 'No client capability advertisement is present in the current dashboard data.',
    pill: 'unknown',
    pillClass: ''
  };
}

export function nativeTaskCollection(data = {}) {
  const candidates = [
    ['nativeTasks', data.nativeTasks],
    ['nativeTasks.tasks', data.nativeTasks?.tasks],
    ['mcpNativeTasks', data.mcpNativeTasks],
    ['taskActivity.nativeTasks', data.taskActivity?.nativeTasks],
    ['mcpConnection.nativeTasks', data.mcpConnection?.nativeTasks],
    ['runtimeObservability.nativeTasks', data.runtimeObservability?.nativeTasks]
  ];
  const source = candidates.find(([, value]) => Array.isArray(value));
  if (!source) {
    return {
      available: false,
      sourceField: '',
      requiredField: 'nativeTasks',
      tasks: []
    };
  }
  const seen = new Set();
  const tasks = [];
  for (const item of source[1]) {
    const taskId = text(item?.taskId || item?.id);
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    tasks.push(item);
  }
  return { available: true, sourceField: source[0], requiredField: '', tasks };
}

export function nativeTaskView(task = {}, processes = []) {
  const taskId = text(task.taskId || task.id);
  const rawStatus = normalize(task.status);
  const status = isNativeTaskStatus(rawStatus) ? rawStatus : 'unknown';
  const cancelRequested = task.cancelRequested === true || Boolean(task.cancellationRequestedAt);
  const cancellationConfirmed = status === 'cancelled' && Boolean(task.cancellationAcknowledgedAt);
  const statusView = nativeTaskStatusView(status, { cancelRequested, cancellationConfirmed });
  const origin = task.origin && typeof task.origin === 'object' ? task.origin : {};
  const internal = task.internal && typeof task.internal === 'object' ? task.internal : {};
  const logicalTaskId = text(task.logicalTaskId || task.workSessionId || origin.logicalTaskId || internal.logicalTaskId || internal.workSessionId);
  const associatedProcess = (Array.isArray(processes) ? processes : []).find(process =>
    text(process?.originatingTaskId) === taskId
  );
  const processId = text(
    task.processId
    || task.result?.processId
    || internal.processId
    || associatedProcess?.processId
  );
  const cancelAction = task.actions?.cancel || task.cancelAction || {};
  const cancelUrl = dashboardActionUrl(cancelAction.url || cancelAction.href);
  const canCancel = ['working', 'input_required'].includes(status)
    && !cancelRequested
    && cancelAction.available === true
    && Boolean(cancelUrl);
  const operation = text(task.operation || task.tool || origin.name || origin.method) || 'Asynchronous MCP operation';
  const resultSummary = firstText(
    task.resultSummary,
    task.result?.summary,
    task.result?.message,
    status === 'completed' ? task.statusMessage : ''
  );
  const errorSummary = firstText(
    task.errorSummary,
    task.error?.message,
    status === 'failed' || status === 'cancelled' ? task.statusMessage : ''
  );
  return {
    taskId,
    status,
    rawStatus,
    operation,
    logicalTaskId,
    processId,
    workspace: text(task.workspace || internal.workspace || internal.workspaceId),
    startedAt: text(task.createdAt || task.startedAt),
    updatedAt: text(task.lastUpdatedAt || task.updatedAt),
    statusMessage: text(task.statusMessage),
    resultSummary,
    errorSummary,
    cancelRequested,
    cancellationConfirmed,
    cancelUrl,
    canCancel,
    ...statusView
  };
}

export function nativeTaskStatusView(statusValue, options = {}) {
  const status = normalize(statusValue);
  if (status === 'cancelled') {
    return {
      label: options.cancellationConfirmed ? 'Cancelled (confirmed)' : 'Cancelled',
      description: options.cancellationConfirmed
        ? 'Cancellation was acknowledged after execution stopped.'
        : 'The asynchronous MCP request ended without completing.',
      terminal: true,
      active: false,
      showSpinner: false,
      waitingForInput: false,
      pillClass: ''
    };
  }
  if (options.cancelRequested) {
    return {
      label: 'Cancellation requested',
      description: 'Rel.AI is waiting for execution to stop before cancellation is confirmed.',
      terminal: false,
      active: true,
      showSpinner: false,
      waitingForInput: false,
      pillClass: 'warn'
    };
  }
  const states = {
    working: ['Working', 'The asynchronous MCP request is executing.', false, true, true, false, 'working'],
    input_required: ['Input required', 'The server is waiting for the client to provide requested input.', false, false, false, true, 'warn'],
    completed: ['Completed', 'The asynchronous MCP request completed successfully.', true, false, false, false, 'ok'],
    failed: ['Failed', 'The asynchronous MCP request ended with an error.', true, false, false, false, 'bad'],
    unknown: ['Unknown', 'The native task status is unavailable or unrecognized.', false, false, false, false, '']
  };
  const [label, description, terminal, active, showSpinner, waitingForInput, pillClass] = states[status] || states.unknown;
  return { label, description, terminal, active, showSpinner, waitingForInput, pillClass };
}

export function workSessionStateView(value = {}) {
  const status = normalize(typeof value === 'string' ? value : value.status);
  const states = {
    queued: ['Queued', false, true, 'working'],
    planning: ['Planning', false, true, 'working'],
    running: ['Running', false, true, 'working'],
    working: ['Working', false, true, 'working'],
    validating: ['Validating', false, true, 'working'],
    waiting: ['Open', false, false, 'working'],
    settling: ['Settling', false, true, 'working'],
    waiting_for_approval: ['Approval required', false, false, 'warn'],
    blocked: ['Blocked', false, false, 'bad'],
    validation_failed: ['Validation failed', false, false, 'bad'],
    completed: ['Completed', true, false, 'ok'],
    failed: ['Failed', true, false, 'bad'],
    attention: ['Failed', true, false, 'bad'],
    cancelled: ['Cancelled', true, false, ''],
    expired: ['Expired', true, false, ''],
    inactive: ['Expired', true, false, '']
  };
  const [label, terminal, active, pillClass] = states[status] || ['Unknown', isTerminalDashboardTaskStatus(status, value), false, ''];
  return { status: status || 'unknown', label, terminal, active, pillClass };
}

export function processStateView(process = {}, nativeTasks = []) {
  const observedStatus = normalize(process.status);
  const rawStatus = observedStatus === 'unknown_after_restart' ? 'orphaned' : observedStatus;
  const taskId = text(process.originatingTaskId || process.nativeTaskId);
  const associatedTask = (Array.isArray(nativeTasks) ? nativeTasks : []).find(task =>
    text(task?.taskId || task?.id) === taskId
  );
  const taskStatus = normalize(associatedTask?.status);
  const independent = rawStatus === 'running' && taskStatus === 'completed';
  const states = {
    starting: ['Starting', false, true, true, 'working', 'Wait for readiness or stop the process if startup does not complete.'],
    running: [independent ? 'Running independently' : 'Running', false, true, true, 'working', 'Use Stop process when this operating-system process is no longer needed.'],
    stopping: ['Stopping', false, true, false, 'working', 'Rel.AI is waiting for confirmed process-tree exit.'],
    exited: ['Exited', true, false, false, 'ok', 'Review the exit code and recent output before restarting if needed.'],
    stopped: ['Stopped', true, false, false, '', 'Start a new process when the command is needed again.'],
    failed: ['Failed', true, false, false, 'bad', 'Review recent stderr, correct the command or environment, and start it again.'],
    orphaned: ['Unknown after restart', false, false, true, 'warn', 'Live pipes cannot be reattached. Stop the process explicitly if it is still running, then start it again.'],
    unknown: ['Unknown', false, false, false, '', 'Refresh the dashboard. If the state remains unknown, inspect Diagnostics.']
  };
  const [label, terminal, active, canStop, pillClass, recovery] = states[rawStatus] || states.unknown;
  return {
    status: rawStatus || 'unknown',
    label,
    terminal,
    active,
    canStop,
    pillClass,
    recovery,
    independent,
    taskStatus: taskStatus || 'unknown'
  };
}

export function processOutputView(process = {}) {
  const stdoutIncluded = Object.hasOwn(process, 'stdoutTail');
  const stderrIncluded = Object.hasOwn(process, 'stderrTail');
  const stdout = String(process.stdoutTail ?? '');
  const stderr = String(process.stderrTail ?? '');
  const included = stdoutIncluded || stderrIncluded;
  const hasOutput = Boolean(stdout.trim() || stderr.trim());
  return {
    included,
    hasOutput,
    stdout,
    stderr,
    message: included
      ? 'No recent stdout or stderr output was recorded.'
      : 'Recent output was not included in this dashboard snapshot. Required backend fields: stdoutTail and stderrTail.'
  };
}

export function recoveryStateView(value = {}) {
  const state = text(value.recoveryState || value.nativeTask?.status || value.oauthRecovery?.state || value.connectorRecovery?.state).toLowerCase();
  const validationFailed = value.validation === 'failed' && value.repairable !== false;
  if (value.nativeTasksSupported === false) return view('Native Tasks not advertised', 'This client did not advertise native MCP Tasks support. Rel.AI may use bounded synchronous fallback.', 'No server recovery is required.', 'warn');
  if (state === 'input_required') return view('Input required', 'The native MCP task is paused until the host supplies the requested input.', 'Return to the host request and provide the required input.', 'warn');
  if (state === 'interrupted_non_resumable') return view('Task interrupted', 'The native task cannot be resumed after interruption.', 'Start a new host request; keep the work session for repair context.', 'bad');
  if (state === 'cancelled' || state === 'canceled') return view('Native task cancelled', 'The asynchronous MCP request ended without completing.', 'Review the work session before starting another request.', 'warn');
  if (validationFailed) return view('Validation failed', 'The work session remains repairable under the same work_id.', 'Repair the failure and validate again with the same work session.', 'bad');
  if (state === 'issuer_disagreement') return view('OAuth issuer mismatch', 'The active issuer differs from the persisted issuer.', 'Use targeted connector recovery; do not reset unrelated registrations.', 'bad');
  if (state === 'corrupt_oauth_state') return view('OAuth state is corrupt', 'Stored OAuth state could not be read safely.', 'Repair only the affected issuer state, then reauthorize.', 'bad');
  if (state === 'connector_reregistration_required') return view('Connector refresh required', 'The current connector registration is no longer valid for this endpoint.', 'Refresh or recreate only the affected connector.', 'warn');
  return null;
}

function capabilityCandidates(data) {
  const connection = data.mcpConnection && typeof data.mcpConnection === 'object' ? data.mcpConnection : data;
  const directCollections = [
    data.taskCapabilityConnections,
    data.mcpConnections,
    connection.activeConnections,
    connection.connections,
    connection.activeSessions,
    connection.recentSessions
  ];
  const direct = directCollections.flatMap(value => Array.isArray(value) ? value : []);
  const events = (Array.isArray(connection.recentEvents) ? connection.recentEvents : [])
    .filter(event => event?.type === 'mcp_request_received')
    .sort((left, right) => timestamp(right) - timestamp(left));
  if (hasCapabilitySignal(connection)) direct.push(connection);
  return [...direct, ...events];
}

function hasCapabilitySignal(value) {
  return value && typeof value === 'object' && [
    'clientCapabilities',
    'clientTasksCapability',
    'nativeTasksSupported',
    'clientAdvertisedTasks',
    'executionMode',
    'taskExecutionMode'
  ].some(key => Object.hasOwn(value, key));
}

function observedTasksSupport(value) {
  const explicit = explicitSupport(value);
  if (explicit !== 'unknown') return explicit;
  if (!Object.hasOwn(value || {}, 'clientCapabilities')) return 'unknown';
  const capabilities = value.clientCapabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return 'unknown';
  if (!Object.hasOwn(capabilities, 'extensions')) return 'not_advertised';
  const extensions = capabilities.extensions;
  if (!extensions || typeof extensions !== 'object' || Array.isArray(extensions)) return 'unknown';
  return Object.hasOwn(extensions, TASKS_EXTENSION_ID) ? 'supported' : 'not_advertised';
}

function explicitSupport(value = {}) {
  const candidates = [
    value.clientTasksCapability?.supported,
    value.nativeTasksSupported,
    value.clientAdvertisedTasks,
    value.tasksSupported
  ];
  for (const candidate of candidates) {
    if (candidate === true) return 'supported';
    if (candidate === false) return 'not_advertised';
  }
  const state = normalize(typeof value.clientTasksCapability === 'string'
    ? value.clientTasksCapability
    : value.clientTasksCapability?.state || value.capabilityState);
  if (['supported', 'advertised', 'capability_present'].includes(state)) return 'supported';
  if (['unsupported', 'not_advertised', 'capability_absent'].includes(state)) return 'not_advertised';
  return 'unknown';
}

function executionMode(value) {
  const mode = normalize(value);
  if (['native_tasks', 'native_asynchronous', 'asynchronous'].includes(mode)) return 'native_tasks';
  if (['bounded_synchronous', 'synchronous_fallback', 'synchronous'].includes(mode)) return 'bounded_synchronous';
  return 'unknown';
}

function dashboardActionUrl(value) {
  const url = text(value);
  return url.startsWith('/api/') ? url : '';
}

function firstText(...values) {
  return values.map(text).find(Boolean) || '';
}

function timestamp(value) {
  const parsed = Date.parse(value?.observedAt || value?.startedAt || value?.timestamp || value?.lastRequestAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function view(title, message, action, tone) {
  return { title, message, action, tone };
}

function text(value) {
  return String(value ?? '').trim();
}

export {
  PROCESS_ACTIVE_STATUSES,
  TASKS_EXTENSION_ID
};
