import { listManagedProcesses } from '../processManager.js';
import * as crypto from 'node:crypto';
import * as connection from '../connectionProfile.js';
import * as productUx from '../productUx.js';
import * as release from '../release.js';
import { deriveConnectionState } from '../desktopUxContracts.js';
import { getApplicationMetadata } from '../appMetadata.js';
import { readTaskHistory } from '../taskHistoryStore.js';
import { buildSafeActivityProjection, sanitizeActivityEventRecord, sanitizeTaskRecord } from '../taskObservability.js';
import { buildWorkspaceStates } from '../workspaceState.js';
import { runtimeCompatibility } from '../runtimeCompatibility.js';
import { mcpConnectionManager } from '../mcp/connectionManager.js';
import { readMcpAuthenticationStatus } from '../mcp/authenticationStatus.js';
const DASHBOARD_STREAM_ID = crypto.randomUUID();
let dashboardSnapshotSequence = 0;

function buildDashboardPayload(config, options = {}, requireHttpToken = false) {
  const profile = connection.readConnectionProfile();
  const taskActivity = typeof options.getTaskActivity === 'function'
    ? options.getTaskActivity()
    : { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], taskId: '', workspace: '', tool: '', startedAt: null, lastTask: null };
  const desktopStatus = typeof options.getDesktopStatus === 'function' ? options.getDesktopStatus() : null;
  const connectionSummary = connection.buildConnectionSummary({
    host: profile.host || options.host || '127.0.0.1',
    port: profile.port || options.port || 3333,
    publicUrl: profile.publicUrl || options.publicUrl || '',
    token: '',
    tunnelProvider: profile.tunnelProvider || 'none'
  });
  const connectionStateInput = desktopStatus || {
    serverRunning: true,
    tunnelStatus: connectionSummary.chatgptMcpUrl ? 'running' : 'stopped',
    mcpUrl: connectionSummary.chatgptMcpUrl || ''
  };
  const limit = Math.max(Number(options.limit || 100), 200);
  const base = productUx.dashboardData(config, { limit });
  const tasks = readTaskHistory(config, taskActivity, { limit: 500 });
  const auditTail = mergeDashboardActivity(base.auditTail || { entries: [] }, tasks, limit);
  const workspaceStates = buildWorkspaceStates(config, tasks, taskActivity);
  const runtimeState = runtimeCompatibility(config, { activeTaskCount: taskActivity.activeTaskCount });
  const mcpConnection = mcpConnectionManager.snapshot();
  const mcpAuthentication = readMcpAuthenticationStatus(mcpConnection, {
    staticBearerConfigured: Boolean(options.token)
  });
  if (Array.isArray(base.config?.workspaces)) {
    for (const workspace of base.config.workspaces) workspace.operational = workspaceStates[workspace.alias] || null;
  }
  return {
    ...base,
    application: getApplicationMetadata(),
    runtime: runtimeState.runtime,
    repositoryRuntime: runtimeState.repository,
    runtimeCompatibility: runtimeState.compatibility,
    readiness: release.releaseReadiness(config, { requireHttpToken }),
    connection: connectionSummary,
    connectionState: desktopStatus?.connectionState || deriveConnectionState(connectionStateInput),
    mcpConnection,
    mcpAuthentication,
    taskActivity: sanitizeTaskActivity(taskActivity),
    desktopStatus,
    snapshot: {
      streamId: DASHBOARD_STREAM_ID,
      sequence: ++dashboardSnapshotSequence,
      generatedAt: new Date().toISOString(),
      modelVersion: 3
    },
    auditTail,
    tasks,
    workspaceStates,
    managedProcesses: listManagedProcesses(config, { limit: 200, activeOnly: true }).processes
  };
}

function mergeDashboardActivity(auditTail, tasks, limit) {
  const entries = [];
  const positions = new Map();
  const add = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const key = entry.eventId || entry.id || entry.operationId || `${entry.ts || entry.timestamp || ''}:${entry.tool || ''}:${entry.taskId || ''}`;
    const normalized = normalizeDashboardActivity(entry);
    if (positions.has(key)) entries[positions.get(key)] = { ...entries[positions.get(key)], ...normalized };
    else {
      positions.set(key, entries.length);
      entries.push(normalized);
    }
  };
  for (const entry of auditTail?.entries || []) add(entry);
  for (const task of tasks || []) {
    for (const event of task.events || []) add({
      ...event,
      workspace: event.workspace || task.workspace,
      taskId: event.taskId || task.id,
      sessionId: event.sessionId || task.id
    });
  }
  entries.sort((left, right) => Date.parse(left.ts || 0) - Date.parse(right.ts || 0));
  return { ...(auditTail || {}), entries: entries.slice(-Math.max(1, Number(limit || 100))) };
}

function normalizeDashboardActivity(entry) {
  entry = sanitizeActivityEventRecord(entry);
  const status = entry.status || (entry.ok === false ? 'failed' : 'succeeded');
  const safeCopy = buildSafeActivityProjection({ ...entry, status });
  const toolName = typeof entry.tool === 'object' ? entry.tool.name : entry.tool;
  return {
    ...entry,
    id: entry.eventId || entry.id || entry.operationId,
    eventId: entry.eventId || entry.id || entry.operationId,
    ts: entry.timestamp || entry.ts || entry.at || entry.createdAt,
    tool: toolName || entry.type || 'activity',
    operation: entry.title || entry.tool?.operation || entry.operation,
    message: entry.summary || entry.message || entry.result?.outcome || entry.error?.message || entry.error,
    error: typeof entry.error === 'object' ? entry.error.message : entry.error,
    path: entry.target?.workspaceRelativePath || entry.path,
    resourceUri: entry.target?.resourceUri,
    status,
    ok: ['succeeded', 'completed'].includes(status) ? true : ['failed', 'blocked', 'cancelled'].includes(status) ? false : entry.ok,
    safeCopy,
    args: undefined,
    output: undefined
  };
}

function sanitizeTaskActivity(activity = {}) {
  return {
    ...activity,
    tasks: Array.isArray(activity.tasks) ? activity.tasks.map(sanitizeTaskRecord) : [],
    lastTask: activity.lastTask ? sanitizeTaskRecord(activity.lastTask) : null
  };
}

export { buildDashboardPayload, mergeDashboardActivity };