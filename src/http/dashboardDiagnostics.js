

import { readConfig } from "../config.js";
import { readAudit, clearAuditHistory } from "../audit.js";
import * as productUx from "../productUx.js";
import * as connection from "../connectionProfile.js";
import { deriveConnectionState, ERROR_CODES, errorPayload } from "../desktopUxContracts.js";
import { buildDiagnosticReport } from "../diagnostics.js";
import { taskHistoryPersistenceSnapshot } from '../taskHistoryStore.js';
import { clearLocalAnalytics } from '../localAnalytics.js';
import { activeLogicalTaskCount } from '../taskState.js';
import { readJsonBody, sendJson } from "./io.js";

function handleApiDiagnostics(ctx) {
  const config = readConfig();
  const workspace = String(ctx.parsed.searchParams.get('workspace') || '').trim();
  const profile = connection.readConnectionProfile();
  const connectionSummary = connection.buildConnectionSummary({
    host: profile.host || ctx.options.host || '127.0.0.1',
    port: profile.port || ctx.options.port || 3333,
    token: ctx.options.token,
    tunnelId: profile.tunnelId || '',
    tunnelProvider: 'openai-secure-mcp',
    showToken: false,
    includeTokenInUrls: false
  });
  const desktopStatus = typeof ctx.options.getDesktopStatus === 'function' ? ctx.options.getDesktopStatus() : null;
  const connectionState = desktopStatus?.connectionState || deriveConnectionState(desktopStatus || {
    serverRunning: false,
    tunnelStatus: 'stopped'
  });
  const activity = typeof ctx.options.getTaskActivity === 'function' ? ctx.options.getTaskActivity() : {};
  const runtimeLogs = typeof ctx.options.getRuntimeLogs === 'function'
    ? ctx.options.getRuntimeLogs({ limit: 100 })
    : { available: false, count: 0, entries: [] };
  const auditLogs = readAudit(config, { limit: 200, ...(workspace ? { workspace } : {}) });
  const report = buildDiagnosticReport({
    workspace,
    health: productUx.healthMonitor(config),
    cautionData: productUx.cautionSummary(config, { windowHours: 24, limit: 500 }),
    connection: connectionSummary,
    connectionState,
    runtimeLogs,
    auditLogs,
    taskHistoryPersistence: taskHistoryPersistenceSnapshot(),
    activeTaskCount: activeLogicalTaskCount(activity)
  });
  sendJson(ctx.res, 200, report);
}

async function handleApiDiagnosticsReset(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const target = String(payload.target || '').trim();
  if (payload.confirm !== true || !['history', 'runtime_logs', 'analytics', 'all'].includes(target)) {
    sendJson(ctx.res, 400, errorPayload(ERROR_CODES.REQUEST_INVALID, 'Diagnostic reset requires confirm=true and target history, runtime_logs, analytics, or all.'));
    return;
  }
  if (target === 'all' && String(payload.confirmation || '').trim() !== 'RESET') {
    sendJson(ctx.res, 400, errorPayload(ERROR_CODES.REQUEST_INVALID, 'Full diagnostic reset requires confirmation=RESET.'));
    return;
  }

  const activity = typeof ctx.options.getTaskActivity === 'function' ? ctx.options.getTaskActivity() : {};
  const activeTasks = activeLogicalTaskCount(activity);
  if ((target === 'history' || target === 'analytics' || target === 'all') && activeTasks > 0) {
    const noun = activeTasks === 1 ? 'task is' : 'tasks are';
    const data = target === 'analytics' ? 'analytics' : 'session and activity history';
    sendJson(ctx.res, 409, errorPayload(ERROR_CODES.STATE_RESET_FAILED, `Cannot clear ${data} while ${activeTasks} Rel.AI ${noun} still active.`));
    return;
  }

  if ((target === 'runtime_logs' || target === 'all') && typeof ctx.options.clearRuntimeLogs !== 'function') {
    sendJson(ctx.res, 409, errorPayload(ERROR_CODES.STATE_RESET_FAILED, 'Service logs can be cleared only in the Rel.AI desktop app.'));
    return;
  }

  const result = { ok: true, target, history: null, runtimeLogs: null, analytics: null };
  if (target === 'history' || target === 'all') result.history = await clearHistory(ctx);
  if (target === 'runtime_logs' || target === 'all') result.runtimeLogs = await ctx.options.clearRuntimeLogs();
  if (target === 'analytics') result.analytics = await clearLocalAnalytics(readConfig());
  result.message = resetMessage(target);
  sendJson(ctx.res, 200, result);
}

async function clearHistory(ctx) {
  if (typeof ctx.options.resetTaskActivity === 'function') {
    const reset = ctx.options.resetTaskActivity();
    if (reset?.ok === false) {
      const error = new Error(reset.error || 'Session history could not be cleared.');
      error.status = 409;
      error.errorCode = ERROR_CODES.STATE_RESET_FAILED;
      throw error;
    }
  }
  const cleared = await clearAuditHistory(readConfig());
  return { removedFiles: cleared.removedFiles, removedBytes: cleared.removedBytes };
}

function resetMessage(target) {
  if (target === 'history') return 'Session and activity history cleared.';
  if (target === 'runtime_logs') return 'Persistent service log cleared.';
  if (target === 'analytics') return 'Local analytics cleared.';
  return 'Session, activity, and service logs cleared.';
}

export { handleApiDiagnostics, handleApiDiagnosticsReset };
