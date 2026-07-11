import { fetchJson } from '../../api.js';
import { esc } from '../../utils.js';
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
  const caution = cautionFinding(cautionData, workspace);
  if (caution) findings.push(caution);
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
      recommendation: 'Generate and save a dashboard approval token.',
      action: { label: 'Open settings', href: '#settings' },
      details: connection
    });
  }
  return findings;
}

function cautionFinding(cautionData, workspace) {
  const count = (cautionData?.workspaces || [])
    .filter(item => !workspace || item.alias === workspace)
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (!count) return null;
  const changeLabel = count === 1 ? 'change' : 'changes';
  return {
    severity: 'info',
    title: `${count} protected configuration ${changeLabel}`,
    impact: 'Rel.AI recorded changes in a caution-sensitive area.',
    recommendation: 'Review the affected tasks and confirm the resulting configuration.',
    action: { label: 'Review tasks', href: routeHref('tasks', { workspace }) },
    details: cautionData
  };
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
      <a class="buttonlike secondary compact-button" href="${esc(finding.action.href)}">${esc(finding.action.label)}</a>
      <details><summary>Technical details</summary><pre>${esc(JSON.stringify(finding.details, null, 2))}</pre></details>
    </div>
  </article>`;
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
