

import { readConfig } from "../config.js";
import { readAudit, clearAuditHistory } from "../audit.js";
import * as productUx from "../productUx.js";
import * as connection from "../connectionProfile.js";
import { deriveConnectionState, ERROR_CODES, errorPayload } from "../desktopUxContracts.js";
import { buildDiagnosticReport } from "../diagnostics.js";
import { taskHistoryPersistenceSnapshot } from '../taskHistoryStore.js';
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
    serverRunning: true,
    tunnelStatus: profile.tunnelId ? 'connecting' : 'stopped'
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
    activeCalls: activity.activeCalls || 0
  });
  sendJson(ctx.res, 200, report);
}

async function handleApiDiagnosticsReset(ctx) {
  const payload = await readJsonBody(ctx.req, ctx.options.maxBodyBytes);
  const target = String(payload.target || '').trim();
  if (payload.confirm !== true || !['history', 'runtime_logs', 'all'].includes(target)) {
    sendJson(ctx.res, 400, errorPayload(ERROR_CODES.REQUEST_INVALID, 'Diagnostic reset requires confirm=true and target history, runtime_logs, or all.'));
    return;
  }
  if (target === 'all' && String(payload.confirmation || '').trim() !== 'RESET') {
    sendJson(ctx.res, 400, errorPayload(ERROR_CODES.REQUEST_INVALID, 'Full diagnostic reset requires confirmation=RESET.'));
    return;
  }

  const activity = typeof ctx.options.getTaskActivity === 'function' ? ctx.options.getTaskActivity() : {};
  if ((target === 'history' || target === 'all') && Number(activity.activeCalls || 0) > 0) {
    sendJson(ctx.res, 409, errorPayload(ERROR_CODES.STATE_RESET_FAILED, 'Cannot clear session and activity history while a Rel.AI tool call is running.'));
    return;
  }

  if ((target === 'runtime_logs' || target === 'all') && typeof ctx.options.clearRuntimeLogs !== 'function') {
    sendJson(ctx.res, 409, errorPayload(ERROR_CODES.STATE_RESET_FAILED, 'Service logs can be cleared only in the Rel.AI desktop app.'));
    return;
  }

  const result = { ok: true, target, history: null, runtimeLogs: null };
  if (target === 'history' || target === 'all') result.history = await clearHistory(ctx);
  if (target === 'runtime_logs' || target === 'all') result.runtimeLogs = await ctx.options.clearRuntimeLogs();
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
  return 'Session, activity, and service logs cleared.';
}

export { handleApiDiagnostics, handleApiDiagnosticsReset };
