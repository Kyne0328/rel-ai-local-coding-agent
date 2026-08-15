import { listManagedProcesses } from '../processManager.js';
import * as crypto from 'node:crypto';
import * as connection from '../connectionProfile.js';
import * as productUx from '../productUx.js';
import * as release from '../release.js';
import { deriveConnectionState } from '../desktopUxContracts.js';
import { getApplicationMetadata } from '../appMetadata.js';
import { readTaskHistory } from '../taskHistoryStore.js';
import { buildSafeActivityProjection, sanitizeActivityEventRecord, sanitizeTaskRecordForProjection } from '../taskObservability.js';
import { eventIdentityKey, eventTimestampMs, eventTimestampValue } from '../taskEvents.js';
import { buildWorkspaceStates } from '../workspaceState.js';
import { runtimeCompatibility } from '../runtimeCompatibility.js';
import { mcpConnectionManager } from '../mcp/connectionManager.js';
import { readMcpAuthenticationStatus } from '../mcp/authenticationStatus.js';
const DASHBOARD_STREAM_ID = crypto.randomUUID();
let dashboardSnapshotSequence = 0;

function buildDashboardPayload(config, options = {}, requireHttpToken = false) {
  const taskActivity = typeof options.getTaskActivity === 'function'
    ? options.getTaskActivity()
    : emptyTaskActivity();
  const connectionProjection = buildDashboardConnectionProjection(config, options);
  const limit = Math.max(Number(options.limit || 100), 200);
  const base = productUx.dashboardData(config, { limit });
  const tasks = readTaskHistory(config, taskActivity, { limit: 500 }).map(summarizeDashboardTask);
  const liveActivityTasks = Array.isArray(taskActivity.tasks) ? taskActivity.tasks : [];
  const auditTail = mergeDashboardActivity(base.auditTail || { entries: [] }, liveActivityTasks, limit);
  const workspaceStates = buildWorkspaceStates(config, tasks, taskActivity);
  const runtimeState = runtimeCompatibility(config, { activeTaskCount: taskActivity.activeTaskCount });

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
    ...connectionProjection,
    ...(options.live ? { live: options.live } : {}),
    taskActivity: sanitizeTaskActivity(taskActivity),
    snapshot: {
      streamId: DASHBOARD_STREAM_ID,
      sequence: ++dashboardSnapshotSequence,
      revision: String(options.snapshotRevision || ''),
      generatedAt: new Date().toISOString(),
      modelVersion: 4
    },
    auditTail,
    tasks,
    workspaceStates,
    managedProcesses: listManagedProcesses(config, { limit: 200, activeOnly: true }).processes
  };
}

function buildDashboardTaskDelta(_options = {}, activities = []) {
  const batch = Array.isArray(activities) ? activities : [activities];
  const taskUpdates = new Map();
  const activityEntries = new Map();
  let latest = null;
  for (const activity of batch) {
    if (!activity || typeof activity !== 'object') continue;
    if (!latest || Number(activity.revision || 0) >= Number(latest.revision || 0)) latest = activity;
    const task = activity.task;
    const taskId = String(task?.taskId || task?.id || activity.taskId || '').trim();
    if (task && taskId) {
      const existing = taskUpdates.get(taskId);
      if (!existing || Number(activity.revision || 0) >= existing.revision) {
        taskUpdates.set(taskId, { revision: Number(activity.revision || 0), task: summarizeDashboardTask(task) });
      }
    }
    if (!activity.activityEvent) continue;
    const normalized = normalizeDashboardActivity({
      ...activity.activityEvent,
      workspace: activity.activityEvent.workspace || activity.workspace || task?.workspace || '',
      taskId: activity.activityEvent.taskId || taskId,
      sessionId: activity.activityEvent.sessionId || taskId
    });
    const key = eventIdentityKey(normalized, activityEntries.size, { preferId: true });
    const existing = activityEntries.get(key);
    activityEntries.set(key, existing ? mergeDashboardActivityEntry(existing, normalized) : normalized);
  }
  return {
    taskActivity: liveTaskActivityDelta(latest),
    taskUpdates: [...taskUpdates.values()].map(item => item.task),
    activityEntries: [...activityEntries.values()].sort((left, right) => eventTimestampMs(left) - eventTimestampMs(right))
  };
}

function liveTaskActivityDelta(activity) {
  if (!activity) return emptyTaskActivity();
  const activeCalls = Math.max(0, Number(activity.activeCalls || 0));
  const activeTaskCount = Math.max(0, Number(activity.activeTaskCount || 0));
  return {
    state: activeCalls > 0 ? 'working' : activeTaskCount > 0 ? 'waiting' : 'idle',
    revision: Math.max(0, Number(activity.revision || 0)),
    activeConnectorCalls: Math.max(0, Number(activity.activeConnectorCalls || 0)),
    activeCalls,
    activeTaskCount
  };
}

function buildDashboardConnectionProjection(_config, options = {}, mcpOverride = null) {
  const profile = connection.readConnectionProfile();
  const desktopStatus = typeof options.getDesktopStatus === 'function' ? options.getDesktopStatus() : null;
  const connectionSummary = connection.buildConnectionSummary({
    host: profile.host || options.host || '127.0.0.1',
    port: profile.port || options.port || 3333,
    token: '',
    tunnelId: profile.tunnelId || '',
    tunnelProvider: 'openai-secure-mcp'
  });
  const connectionStateInput = desktopStatus || {
    serverRunning: true,
    tunnelStatus: profile.tunnelId ? 'connecting' : 'stopped'
  };
  const mcpConnection = mcpOverride || mcpConnectionManager.snapshot();
  return {
    connection: connectionSummary,
    connectionState: desktopStatus?.connectionState || deriveConnectionState(connectionStateInput),
    mcpConnection,
    mcpAuthentication: readMcpAuthenticationStatus(mcpConnection, {
      staticBearerConfigured: Boolean(options.token)
    }),
    desktopStatus
  };
}

function emptyTaskActivity() {
  return { state: 'idle', activeCalls: 0, activeTaskCount: 0, tasks: [], taskId: '', workspace: '', tool: '', startedAt: null, lastTask: null };
}

function mergeDashboardActivity(auditTail, tasks, limit) {
  const entries = [];
  const positions = new Map();
  const add = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const key = eventIdentityKey(entry, entries.length, { preferId: true });
    const normalized = normalizeDashboardActivity(entry);
    if (positions.has(key)) entries[positions.get(key)] = mergeDashboardActivityEntry(entries[positions.get(key)], normalized);
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
  entries.sort((left, right) => eventTimestampMs(left) - eventTimestampMs(right));
  return { ...(auditTail || {}), entries: entries.slice(-Math.max(1, Number(limit || 100))) };
}

function mergeDashboardActivityEntry(existing, incoming) {
  const merged = { ...existing, ...incoming };
  for (const key of ['summary', 'message', 'currentActivity', 'title', 'operation', 'path']) {
    if (!displayText(incoming?.[key]) && displayText(existing?.[key])) merged[key] = existing[key];
  }
  merged.safeCopy = buildSafeActivityProjection(merged);
  return merged;
}

function displayText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
    ts: eventTimestampValue(entry),
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

function summarizeDashboardTask(task) {
  if (!task || typeof task !== 'object') return task;
  const { events: _events, ...withoutEvents } = task;
  const projected = sanitizeTaskRecordForProjection(withoutEvents);
  return projected && typeof projected === 'object' ? { ...projected } : projected;
}

function sanitizeTaskActivity(activity = {}) {
  return {
    ...activity,
    tasks: Array.isArray(activity.tasks) ? activity.tasks.map(summarizeDashboardTask) : [],
    lastTask: activity.lastTask ? summarizeDashboardTask(activity.lastTask) : null
  };
}

export { buildDashboardConnectionProjection, buildDashboardPayload, buildDashboardTaskDelta, mergeDashboardActivity, summarizeDashboardTask };