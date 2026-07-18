import { fetchJson } from '../../api.js';
import { esc, timeAgo } from '../../utils.js';
import { getWorkspaceFilter, routeHref } from '../../router.js';

export function mountDiagnostics(container) {
  container.innerHTML = `
    <div class="section-head"><div><h2>Diagnostics</h2><p>Blocking errors, warnings, and recommendations with direct recovery actions.</p></div></div>
    <div id="diagnosticSummary" class="diagnostic-summary"><div class="empty">Loading diagnostics…</div></div>`;
  loadDiagnostics(document.getElementById('diagnosticSummary')).catch(error => {
    const root = document.getElementById('diagnosticSummary');
    if (root) root.innerHTML = `<div class="diagnostic-clear"><strong>Diagnostics unavailable</strong><span>${esc(error instanceof Error ? error.message : String(error))}</span></div>`;
  });
}

async function loadDiagnostics(root) {
  const [health, aliasCheck, cautionData, connection] = await Promise.all([
    fetchJson('/api/health-monitor'),
    fetchJson('/api/alias-diagnostics'),
    fetchJson('/api/caution-summary'),
    fetchJson('/api/connection')
  ]);
  const workspace = getWorkspaceFilter();
  const findings = [
    ...healthFindings(health, workspace),
    ...aliasFindings(aliasCheck, workspace),
    ...connectionFindings(connection)
  ];
  findings.push(...cautionFindings(cautionData, workspace));
  const ordered = findings.toSorted((left, right) => severityRank(left.severity) - severityRank(right.severity));
  root.innerHTML = renderDiagnosticSummary(ordered);
}

function healthFindings(health, workspace) {
  return (health?.findings || [])
    .filter(finding => !workspace || !finding.workspace || finding.workspace === workspace)
    .map(normalizeHealthFinding);
}

function aliasFindings(aliasCheck, workspace) {
  const findings = [];
  for (const item of aliasCheck?.workspaces || []) {
    if (workspace && item.alias !== workspace) continue;
    if (!item.staleKeys?.length) continue;
    findings.push({
      severity: 'warning',
      title: `Stale validation commands in ${item.alias}`,
      impact: 'Saved validation may fail or give a misleading result.',
      recommendation: `Remove or replace: ${item.staleKeys.join(', ')}`,
      action: { label: 'Review workspace', href: routeHref('workspaces', { workspace: item.alias }) },
      details: item
    });
  }
  return findings;
}

function connectionFindings(connection) {
  const findings = [];
  if (!connection?.chatgptMcpUrl) {
    findings.push({
      severity: 'warning',
      title: 'Public connector is unavailable',
      impact: 'The local dashboard works, but ChatGPT cannot reach this machine.',
      recommendation: 'Configure and start the permanent HTTPS tunnel.',
      action: { label: 'Open connector settings', href: '#settings/connector' },
      details: connection
    });
  }
  if (connection?.token !== 'set') {
    findings.push({
      severity: 'error',
      title: 'Dashboard token is missing',
      impact: 'Dashboard and OAuth access are not adequately protected.',
      recommendation: 'Set the dashboard approval token in the Rel.AI desktop app, then restart the connection.',
      action: { label: 'Open connector guidance', href: '#settings/connector' },
      details: connection
    });
  }
  return findings;
}

function cautionFindings(cautionData, workspace) {
  return (cautionData?.workspaces || [])
    .filter(item => Number(item.count || 0) > 0)
    .filter(item => !workspace || item.alias === workspace)
    .map(item => {
      const alias = item.alias === '__unknown__' ? '' : item.alias;
      const latest = Array.isArray(item.recent) ? item.recent[0] : null;
      const count = Number(item.count || 0);
      const params = { workspace: alias, time: activityTimeRange(cautionData.windowHours) };
      if (latest?.tool) params.tool = latest.tool;
      if (latest?.taskId) params.task = latest.taskId;
      else if (latest?.path) params.search = latest.path;
      return {
        severity: 'info',
        title: `Protected configuration ${count === 1 ? 'change' : 'changes'}${alias ? ` in ${alias}` : ''}`,
        impact: `${count} recorded in the last ${cautionData.windowHours || 24} hours${latest?.tool ? `; latest: ${latest.tool} ${timeAgo(latest.ts)}` : ''}.`,
        recommendation: 'Open the matching activity and confirm the change was expected.',
        action: { label: 'Open matching activity', href: routeHref('activity', params) },
        context: item.recent || [],
        details: { windowHours: cautionData.windowHours, workspace: item }
      };
    });
}

function activityTimeRange(windowHours) {
  const hours = Number(windowHours || 24);
  if (hours <= 0.25) return '15m';
  if (hours <= 1) return '1h';
  if (hours <= 24) return '24h';
  if (hours <= 168) return '7d';
  return 'all';
}

function renderDiagnosticSummary(findings) {
  const body = findings.length
    ? `<div class="diagnostic-list">${findings.map(findingCard).join('')}</div>`
    : '<div class="diagnostic-clear"><strong>All clear</strong><span>No blocking errors or warnings were found.</span></div>';
  return summaryCards(findings) + body;
}

function normalizeHealthFinding(finding) {
  const workspace = finding.workspace || '';
  const action = workspace
    ? { label: 'Review workspace', href: routeHref('workspaces', { workspace }) }
    : { label: 'Open settings', href: '#settings' };
  return {
    severity: normalizedSeverity(finding.severity),
    title: humanize(finding.code || 'Runtime finding'),
    impact: workspace ? `Workspace ${workspace} may be unavailable or unreliable.` : 'The local bridge may not operate as expected.',
    recommendation: recommendationFor(finding),
    action,
    details: finding
  };
}

function normalizedSeverity(value) {
  if (value === 'error') return 'error';
  if (value === 'warning') return 'warning';
  return 'info';
}

function recommendationFor(finding) {
  if (finding.code === 'workspace_unavailable') return 'Correct the workspace path or remove the obsolete workspace entry.';
  if (String(finding.code || '').includes('stateDir')) return 'Confirm that the Rel.AI state directory exists and is writable.';
  return finding.message || 'Review the technical details and correct the affected configuration.';
}

function summaryCards(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return `<div class="diagnostic-metrics">
    ${metric('Blocking', counts.error, 'error')}
    ${metric('Warnings', counts.warning, 'warning')}
    ${metric('Recommendations', counts.info, 'info')}
  </div>`;
}

function metric(label, count, severity) {
  return `<div class="diagnostic-metric ${severity}"><span>${esc(label)}</span><strong>${count}</strong></div>`;
}

function findingCard(finding) {
  return `<article class="diagnostic-finding ${finding.severity}">
    <div class="diagnostic-severity">${esc(finding.severity)}</div>
    <div class="diagnostic-copy">
      <h3>${esc(finding.title)}</h3>
      <p><strong>Impact:</strong> ${esc(finding.impact)}</p>
      <p><strong>Recommended action:</strong> ${esc(finding.recommendation)}</p>
      ${findingContext(finding.context)}
      <a class="buttonlike secondary compact-button" href="${esc(finding.action.href)}">${esc(finding.action.label)}</a>
      <details><summary>Raw event data</summary><pre>${esc(JSON.stringify(finding.details, null, 2))}</pre></details>
    </div>
  </article>`;
}

function findingContext(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  return `<div class="diagnostic-context">${entries.map(entry => `
    <div class="diagnostic-context-row">
      <code>${esc(entry.tool || 'configuration change')}</code>
      <span>${esc(timeAgo(entry.ts))}</span>
      <small>${esc(entry.path || entry.reason || 'No additional context recorded.')}</small>
    </div>`).join('')}</div>`;
}

function humanize(value) {
  const text = String(value || '').replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function severityRank(value) {
  if (value === 'error') return 0;
  if (value === 'warning') return 1;
  return 2;
}
