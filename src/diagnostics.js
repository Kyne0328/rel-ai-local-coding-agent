

import { ERROR_CODES, errorGuidance, normalizeErrorCode } from "./desktopUxContracts.js";

const SENSITIVE_KEY = /token|secret|password|authorization|api[_-]?key|authtoken|client[_-]?secret|bootstrap/i;
const SECRET_TEXT_REPLACEMENTS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]{0,50000}?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi, '[redacted-private-key]'],
  [/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]'],
  [/([?&](?:token|bootstrap|code|client_secret)=)[^&#\s]+/gi, '$1[redacted]'],
  [/(["']?(?:token|secret|password|authorization|api[_-]?key|authtoken|client[_-]?secret)["']?\s*:\s*)["'][^"']*["']/gi, '$1"[redacted]"'],
  [/\b(token|secret|password|authorization|api[_-]?key|authtoken|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]'],
  [/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|AUTH_CODE|CLIENT_SECRET)[A-Z0-9_]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/g, '$1=[redacted]']
];

function sanitizeText(value, maxLength = 4000) {
  let text = String(value == null ? '' : value);
  for (const [pattern, replacement] of SECRET_TEXT_REPLACEMENTS) text = text.replace(pattern, replacement);
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}\n[diagnostic text truncated]`;
  return text;
}

function sanitizeDiagnosticValue(value, depth = 0) {
  if (depth > 8) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeDiagnosticValue(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitizeText(value) : value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeDiagnosticValue(item, depth + 1);
  }
  return out;
}

function buildDiagnosticReport(input = {}) {
  const workspace = String(input.workspace || '');
  const findings = [
    ...healthFindings(input.health, workspace),
    ...connectionFindings(input.connection, input.connectionState),
    ...cautionFindings(input.cautionData, workspace)
  ];
  const ordered = dedupeFindings(findings).sort(compareDiagnosticFindings);
  const runtime = normalizeRuntimeLogs(input.runtimeLogs);
  const failedActivity = normalizeFailedActivity(input.auditLogs);
  const activeCalls = Number(input.activeCalls || 0);
  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: workspace ? { workspace } : { workspace: '' },
    summary: countFindings(ordered),
    findings: ordered,
    logs: { runtime, failedActivity },
    maintenance: {
      history: {
        available: true,
        blocked: activeCalls > 0,
        reason: activeCalls > 0 ? `${activeCalls} Rel.AI tool call${activeCalls === 1 ? ' is' : 's are'} still running.` : '',
        endpoint: '/api/diagnostics/reset',
        target: 'history'
      },
      runtimeLogs: {
        available: runtime.available,
        blocked: false,
        reason: runtime.available ? '' : 'Service logs are available only in the desktop app.',
        endpoint: '/api/diagnostics/reset',
        target: 'runtime_logs'
      },
      all: {
        available: runtime.available,
        blocked: activeCalls > 0,
        reason: activeCalls > 0
          ? `${activeCalls} Rel.AI tool call${activeCalls === 1 ? ' is' : 's are'} still running.`
          : runtime.available ? '' : 'Full reset is available only in the desktop app.',
        endpoint: '/api/diagnostics/reset',
        target: 'all',
        confirmation: 'RESET'
      }
    }
  };
  report.reportText = formatDiagnosticReport(report);
  return report;
}

function healthFindings(health, workspace) {
  return (health?.findings || [])
    .filter(finding => !workspace || !finding.workspace || finding.workspace === workspace)
    .map(finding => {
      const code = normalizeHealthCode(finding.code);
      const alias = String(finding.workspace || '');
      return diagnosticFinding({
        severity: normalizedSeverity(finding.severity),
        code,
        title: humanize(finding.code || errorGuidance(code).title),
        impact: alias ? `Workspace ${alias} may be unavailable or unreliable.` : 'The local bridge may not operate as expected.',
        recommendation: recommendationForHealth(finding, code),
        action: alias
          ? { label: 'Review workspace', href: `#workspaces?workspace=${encodeURIComponent(alias)}` }
          : actionFromGuidance(code),
        details: finding
      });
    });
}

function connectionFindings(connection, state) {
  const findings = [];
  const endpointStatus = String(state?.publicEndpoint?.status || '');
  const tunnelConfigured = Boolean(String(connection?.tunnelId || '').trim());
  if (endpointStatus === 'unavailable' || endpointStatus === 'disabled' || (!endpointStatus && !tunnelConfigured)) {
    findings.push(findingFromCode(
      ERROR_CODES.PUBLIC_ENDPOINT_FAILED,
      'warning',
      'The local dashboard works, but the OpenAI Secure MCP Tunnel is not available for ChatGPT requests.',
      { ...connection, endpointStatus }
    ));
  }
  if (connection?.token !== 'set') {
    findings.push(findingFromCode(
      ERROR_CODES.CONFIGURATION_INVALID,
      'error',
      'The private local MCP bearer credential is missing.',
      connection
    ));
  }
  const connectionError = state?.error;
  if (connectionError?.message) findings.push(findingFromCode(connectionError.code, 'error', connectionError.message, connectionError));
  return findings;
}

function cautionFindings(cautionData, workspace) {
  return (cautionData?.workspaces || [])
    .filter(item => Number(item.count || 0) > 0)
    .filter(item => !workspace || item.alias === workspace)
    .map(item => {
      const alias = item.alias === '__unknown__' ? '' : item.alias;
      const count = Number(item.count || 0);
      return diagnosticFinding({
        severity: 'info',
        code: 'protected_configuration_changes',
        title: `Protected configuration ${count === 1 ? 'change' : 'changes'}${alias ? ` in ${alias}` : ''}`,
        impact: `${count} recorded in the last ${cautionData.windowHours || 24} hours.`,
        recommendation: 'Open Activity and confirm the recorded changes were expected.',
        action: { label: 'Open Activity', href: alias ? `#activity?workspace=${encodeURIComponent(alias)}&time=24h` : '#activity?time=24h' },
        context: item.recent || [],
        details: item
      });
    });
}

function findingFromCode(code, severity, impact, details) {
  const normalized = normalizeErrorCode(code) || ERROR_CODES.UNKNOWN;
  const guidance = errorGuidance(normalized);
  return diagnosticFinding({
    severity,
    code: normalized,
    title: guidance.title,
    impact,
    recommendation: guidance.recovery,
    action: actionFromGuidance(normalized),
    details
  });
}

function diagnosticFinding(value) {
  return {
    id: findingId(value),
    severity: normalizedSeverity(value.severity),
    code: String(value.code || ERROR_CODES.UNKNOWN),
    title: sanitizeText(value.title || 'Diagnostic finding', 240),
    impact: sanitizeText(value.impact || '', 1000),
    recommendation: sanitizeText(value.recommendation || '', 1000),
    action: value.action || { label: 'Open Diagnostics', href: '#diagnostics' },
    context: sanitizeDiagnosticValue(value.context || []),
    details: sanitizeDiagnosticValue(value.details || {})
  };
}

function normalizeRuntimeLogs(value) {
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  const ordered = [...entries].sort(compareChronological).slice(-100);
  return {
    available: value?.available === true,
    persistent: value?.persistent === true,
    revision: Number.isFinite(Number(value?.revision)) ? Math.max(0, Number(value.revision)) : 0,
    count: Number(value?.count ?? entries.length),
    entries: ordered.map(entry => ({
      ts: entry.ts || null,
      level: ['error', 'warning', 'info'].includes(entry.level) ? entry.level : 'info',
      source: sanitizeText(entry.source || 'desktop', 80),
      code: sanitizeText(entry.code || '', 120),
      message: sanitizeText(entry.message || '', 2000),
      taskId: sanitizeText(entry.taskId || '', 160),
      eventId: sanitizeText(entry.eventId || '', 160),
      workspace: sanitizeText(entry.workspace || '', 120),
      tool: sanitizeText(entry.tool || '', 120),
      operation: sanitizeText(entry.operation || '', 240)
    }))
  };
}

function normalizeFailedActivity(value) {
  const entries = Array.isArray(value?.entries) ? value.entries : Array.isArray(value) ? value : [];
  return entries
    .filter(entry => entry?.ok === false || entry?.error)
    .sort(compareChronological)
    .slice(-20)
    .map(entry => sanitizeDiagnosticValue({
      ts: entry.ts || entry.at || entry.createdAt || null,
      eventId: entry.eventId || entry.operationId || entry.id || '',
      taskId: entry.taskId || entry.sessionId || '',
      tool: entry.tool || entry.type || 'activity',
      workspace: entry.workspace || '',
      errorCode: sanitizeText(entry.errorCode || '', 120),
      error: entry.error || entry.message || 'Failed activity'
    }));
}

function logContext(entry = {}, fields = []) {
  const labels = { code: 'code', errorCode: 'code', workspace: 'workspace', taskId: 'task', eventId: 'event', tool: 'tool', operation: 'operation' };
  const context = fields
    .map(field => entry[field] ? `${labels[field] || field}=${entry[field]}` : '')
    .filter(Boolean);
  return context.length ? ` [${context.join(' ')}]` : '';
}

function formatDiagnosticReport(report) {
  const lines = [
    'Rel.AI MCP diagnostic report',
    `Generated: ${report.generatedAt}`,
    `Scope: ${report.scope.workspace || 'all workspaces'}`,
    `Findings: ${report.summary.blocking} blocking, ${report.summary.warnings} warnings, ${report.summary.recommendations} recommendations`
  ];
  for (const finding of report.findings) {
    lines.push('', `[${finding.severity.toUpperCase()}] ${finding.code}`, finding.title, `Impact: ${finding.impact}`, `Action: ${finding.recommendation}`);
  }
  if (report.logs.runtime.entries.length) {
    lines.push('', 'Recent service logs:');
    for (const entry of report.logs.runtime.entries.slice(-20)) {
      const context = logContext(entry, ['code', 'workspace', 'taskId', 'eventId', 'tool', 'operation']);
      lines.push(`${entry.ts || ''} ${entry.level.toUpperCase()} ${entry.source}${context}: ${entry.message}`.trim());
    }
  }
  if (report.logs.failedActivity.length) {
    lines.push('', 'Recent failed activity:');
    for (const entry of report.logs.failedActivity) {
      const context = logContext(entry, ['errorCode', 'workspace', 'taskId', 'eventId']);
      lines.push(`${entry.ts || ''} ${entry.tool || 'activity'}${context}: ${entry.error}`.trim());
    }
  }
  return sanitizeText(lines.join('\n'), 30000);
}

function dedupeFindings(findings) {
  const byId = new Map();
  for (const finding of findings) if (!byId.has(finding.id)) byId.set(finding.id, finding);
  return [...byId.values()];
}

function countFindings(findings) {
  const summary = { blocking: 0, warnings: 0, recommendations: 0, total: findings.length };
  for (const finding of findings) {
    if (finding.severity === 'error') summary.blocking += 1;
    else if (finding.severity === 'warning') summary.warnings += 1;
    else summary.recommendations += 1;
  }
  return summary;
}

function findingId(value) {
  const details = value.details || {};
  return [value.code || 'finding', details.workspace || details.alias || '', details.path || ''].join(':');
}

function normalizeHealthCode(value) {
  if (value === 'workspace_unavailable') return ERROR_CODES.WORKSPACE_UNAVAILABLE;
  return ERROR_CODES.CONFIGURATION_INVALID;
}

function recommendationForHealth(finding, code) {
  if (finding.code === 'workspace_unavailable') return errorGuidance(ERROR_CODES.WORKSPACE_UNAVAILABLE).recovery;
  if (String(finding.code || '').includes('stateDir')) return 'Confirm that the Rel.AI state directory exists and is writable.';
  return sanitizeText(finding.message || errorGuidance(code).recovery, 1000);
}

function actionFromGuidance(code) {
  const guidance = errorGuidance(code);
  return { label: guidance.actionLabel, href: guidance.href || '#diagnostics' };
}

function normalizedSeverity(value) {
  if (value === 'error') return 'error';
  if (value === 'warning') return 'warning';
  return 'info';
}

function severityRank(value) {
  if (value === 'error') return 0;
  if (value === 'warning') return 1;
  return 2;
}

function compareDiagnosticFindings(left, right) {
  return severityRank(left?.severity) - severityRank(right?.severity)
    || findingWorkspace(left).localeCompare(findingWorkspace(right), 'en-US', { numeric: true, sensitivity: 'base' })
    || String(left?.code || '').localeCompare(String(right?.code || ''), 'en-US', { numeric: true, sensitivity: 'base' })
    || String(left?.title || '').localeCompare(String(right?.title || ''), 'en-US', { numeric: true, sensitivity: 'base' });
}

function findingWorkspace(finding) {
  return String(finding?.details?.workspace || finding?.details?.alias || '');
}

function compareChronological(left, right) {
  const timestampDifference = diagnosticTimestamp(left) - diagnosticTimestamp(right);
  if (timestampDifference) return timestampDifference;
  return String(left?.source || left?.tool || left?.type || '').localeCompare(String(right?.source || right?.tool || right?.type || ''), 'en-US', { numeric: true, sensitivity: 'base' });
}

function diagnosticTimestamp(entry) {
  const timestamp = Date.parse(entry?.ts || entry?.at || entry?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function humanize(value) {
  const text = String(value || '').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export { sanitizeText, sanitizeDiagnosticValue, buildDiagnosticReport,  };
