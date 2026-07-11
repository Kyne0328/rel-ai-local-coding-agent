import { pillHtml } from '../components/pill.js';
import { badgeHtml } from '../components/badge.js';
import { esc, metricHtml, statusClass, timeAgo } from '../utils.js';
import { getWorkspaceFilter, routeHref } from '../router.js';

function buildWorkspaces(data) {
  const cfg = data.config || {};
  const health = data.health || {};
  const workspaceFilter = getWorkspaceFilter();
  const allWorkspaces = Array.isArray(cfg.workspaces) ? cfg.workspaces : [];
  const workspaces = workspaceFilter ? allWorkspaces.filter(workspace => workspace.alias === workspaceFilter) : allWorkspaces;
  const toolCount = Number.isFinite(Number(data.toolCount)) && Number(data.toolCount) >= 0 ? Number(data.toolCount) : 0;
  const healthByAlias = new Map((Array.isArray(health.workspaces) ? health.workspaces : []).map(item => [item.alias, item]));
  const validationReady = workspaces.filter(ws => (ws.testCommandKeys || []).length || (ws.discoveredTestCommandKeys || []).length).length;

  const root = document.createElement('div');
  root.className = 'section';
  root.innerHTML = `
    <div class="section-head">
      <div><h2>Workspaces</h2><p>Repositories ChatGPT can inspect, change, validate, review, and restore through the same workspace-tool surface.</p></div>
      <div class="section-head-actions">
        <button type="button" data-add-workspace>Add workspace</button>
        <span class="section-action">${esc(workspaces.length)} configured</span>
      </div>
    </div>
    <div class="overview-grid">
      ${metricHtml('Workspaces', workspaces.length, 'configured aliases', 'blue')}
      ${metricHtml('Validation ready', validationReady + '/' + workspaces.length, 'configured or auto-detected', validationReady === workspaces.length ? 'good' : 'warn')}
      ${metricHtml('Health findings', actionableFindings(health).length, health.ok === false ? 'needs attention' : 'all clear', health.ok === false ? 'bad' : 'good')}
      ${metricHtml('ChatGPT tools', toolCount, 'workspace tools', 'good')}
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'workspace-grid';
  grid.innerHTML = workspaces.length ? workspaces.map(ws => workspaceCard(ws, healthByAlias.get(ws.alias))).join('') : '<div class="empty">No workspaces configured.</div>';
  root.appendChild(grid);

  const findings = actionableFindings(health);
  if (findings.length) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="card-head"><h3>Health findings</h3><a class="section-action" href="#settings/diagnostics">Open diagnostics</a></div>';
    const body = document.createElement('div');
    body.className = 'card-body list';
    body.innerHTML = findings.map(findingRow).join('');
    card.appendChild(body);
    root.appendChild(card);
  }

  return root;
}

function listValue(value) {
  return Array.isArray(value) ? value : [];
}

function isFocusedContext(ws) {
  return ws.fastTask?.enabled !== false;
}

function workspaceCardView(ws, health) {
  const testKeys = listValue(ws.testCommandKeys);
  const detected = listValue(ws.discoveredTestCommandKeys);
  return {
    alias: ws.alias || 'workspace',
    aliasAttr: esc(ws.alias || ''),
    path: ws.path || '',
    status: health?.ok === false ? 'check' : 'healthy',
    testKeys,
    commandKeys: listValue(ws.commandKeys),
    detected,
    staleKeys: listValue(ws.staleTestCommandKeys),
    protectedBranches: listValue(ws.protectedBranches),
    sessionActive: ws.sessionPolicy?.sessionActive === true,
    taskHint: ws.sessionPolicy?.taskHint || '',
    cautionCount: Number.isFinite(ws.caution?.count) ? ws.caution.count : 0,
    focused: isFocusedContext(ws),
    healthWarning: health?.ok === false ? health.error || 'Workspace unavailable' : '',
    operational: ws.operational || {}
  };
}

function workspaceHealthHtml(view) {
  if (!view.healthWarning) return '';
  return `<div class="workspace-warning"><span>⚠ ${esc(view.healthWarning)}</span><button class="secondary" type="button" data-fix-path="${view.aliasAttr}">Fix path</button></div>`;
}

function workspaceBadgeRow(view) {
  return [
    badgeHtml('configured tests ' + view.testKeys.length),
    view.staleKeys.length ? badgeHtml('stale tests ' + view.staleKeys.length, 'warn') : '',
    badgeHtml('detected tests ' + view.detected.length, view.detected.length ? 'good' : 'warn'),
    badgeHtml('commands ' + view.commandKeys.length),
    badgeHtml('context mode ' + (view.focused ? 'focused' : 'broad'), view.focused ? 'good' : 'warn'),
    badgeHtml('protected ' + (view.protectedBranches.join(', ') || 'none')),
    view.sessionActive ? badgeHtml('session active', 'good') : '',
    view.cautionCount > 0 ? badgeHtml('caution ' + view.cautionCount, 'warn') : ''
  ].join('');
}

function workspaceExtraLines(view, ws) {
  const stale = view.staleKeys.length ? `<div class="path warning-text">Stale tests: ${esc(view.staleKeys.join(', '))}</div>` : '';
  const task = view.sessionActive && view.taskHint ? `<div class="path">Task: ${esc(view.taskHint)}</div>` : '';
  const op = view.operational || {};
  const branch = branchSummary(op);
  const worktree = op.dirty ? `${esc(op.changedFileCount || 0)} changed · ${esc(op.sessionChangedFileCount || 0)} session-owned` : 'Clean worktree';
  const validation = op.lastValidation ? `Last validation ${esc(op.lastValidation.status)} · ${esc(timeAgo(op.lastValidation.completedAt))}` : 'No validation task recorded';
  const lastTask = op.lastTask ? `Last task ${esc(op.lastTask.status)} · ${esc(timeAgo(op.lastTask.completedAt || op.lastTask.startedAt))}` : 'No task history';
  return `${stale}<div class="workspace-operational"><div><span>Branch</span><strong>${branch}</strong></div><div><span>Worktree</span><strong>${worktree}</strong></div><div><span>Validation</span><strong>${validation}</strong></div><div><span>Activity</span><strong>${lastTask}</strong></div></div><div class="path">${fastTaskText(ws.fastTask)}</div>${task}`;
}

function branchSummary(operational) {
  if (!operational.branch) return 'Git state unavailable';
  const branch = esc(operational.branch);
  if (!operational.ahead && !operational.behind) return branch;
  return `${branch} · ↑${esc(operational.ahead || 0)} ↓${esc(operational.behind || 0)}`;
}

function pluralSuffix(count) {
  return count === 1 ? '' : 's';
}

function saveDetectedButton(view) {
  if (!view.detected.length || view.testKeys.length) return '';
  return `<button type="button" data-save-detected="${view.aliasAttr}">Save detected tests</button>`;
}

function pruneStaleButton(view) {
  if (!view.staleKeys.length) return '';
  return `<button class="secondary danger" type="button" data-prune-stale="${view.aliasAttr}">Remove ${esc(view.staleKeys.length)} stale test${pluralSuffix(view.staleKeys.length)}</button>`;
}

function workspaceActionButtons(view) {
  const saveDetected = saveDetectedButton(view);
  const prune = pruneStaleButton(view);
  return `
    <a class="buttonlike secondary" href="${routeHref('tasks', { workspace: view.alias })}">Tasks</a>
    <a class="buttonlike secondary" href="${routeHref('activity', { workspace: view.alias })}">Activity</a>
    <button class="secondary" type="button" data-run-validation="${view.aliasAttr}">Run validation</button>
    <button class="secondary" type="button" data-open-folder="${view.aliasAttr}">Open folder</button>
    <button class="secondary" type="button" data-preflight="${view.aliasAttr}">Review Git state</button>
    <button class="secondary" type="button" data-toggle-fast-task="${view.aliasAttr}">${view.focused ? 'Use broad context' : 'Use focused context'}</button>
    <button class="secondary" type="button" data-edit-fast-task="${view.aliasAttr}">Context settings</button>
    <button class="secondary" type="button" data-edit-workspace="${view.aliasAttr}">Edit</button>
    <button class="secondary" type="button" data-rename-workspace="${view.aliasAttr}">Rename</button>
    <button class="secondary danger" type="button" data-clear-workspace="${view.aliasAttr}">Clear</button>
    ${saveDetected}${prune}`;
}

function workspaceCard(ws, health) {
  const view = workspaceCardView(ws, health);
  return `
    <div class="workspace-card" data-workspace-card="${view.aliasAttr}">
      <div class="workspace-card-head">
        <strong>${esc(view.alias)}</strong>
        ${pillHtml(view.status)}
      </div>
      <div class="path">${esc(view.path)}</div>
      ${workspaceHealthHtml(view)}
      <div class="badge-row">${workspaceBadgeRow(view)}</div>
      <div class="path">${validationText(view.testKeys, view.detected)}</div>
      ${workspaceExtraLines(view, ws)}
      <div class="workspace-actions">${workspaceActionButtons(view)}</div>
      <pre class="copy-box preflight-output" data-preflight-out="${view.aliasAttr}"></pre>
    </div>`;
}

function fastTaskText(fastTask = {}) {
  const enabled = fastTask.enabled !== false;
  const max = fastTask.maxIndexFiles || 750;
  const includeRoots = Array.isArray(fastTask.includeRoots) && fastTask.includeRoots.length ? ' Include roots: ' + esc(fastTask.includeRoots.join(', ')) + '.' : '';
  return enabled
    ? `Focused context: on. Skips broad indexing for small tasks, caps focused indexes at ${esc(max)} files, and respects .relaiignore/context excludes.${includeRoots}`
    : 'Focused context: off. Context scans may inspect more of the workspace.';
}

function validationText(configured, detected) {
  if (configured.length) return 'Configured tests: ' + esc(configured.join(', '));
  if (detected.length) return 'Auto-detected validation: ' + esc(detected.join(', ')) + '. ChatGPT can run these via relai_run_checks even before saving them.';
  return 'No validation checks found yet. ChatGPT can still run explicit workspace checks.';
}

function findingRow(finding) {
  const alias = finding.workspace || '';
  const actionable = finding.code === 'workspace_unavailable' && alias;
  const inner = `<span class="dot ${statusClass(finding.severity)}"></span><div class="finding-main"><div class="item-title">${esc(finding.code || finding.severity || 'finding')}</div><div class="item-sub">${esc(finding.message || '')}</div></div>`;
  if (actionable) {
    return `<div class="list-item finding-row">${inner}<div class="finding-actions"><button class="secondary" type="button" data-finding-edit="${esc(alias)}">Edit path</button><button class="secondary danger" type="button" data-finding-remove="${esc(alias)}">Remove</button></div></div>`;
  }
  return `<a class="list-item finding-link" href="#settings/diagnostics">${inner}<div class="item-time">${pillHtml(finding.severity || 'info')}</div></a>`;
}

function actionableFindings(health) {
  return Array.isArray(health.findings) ? health.findings.filter(f => f.severity !== 'info') : [];
}

export { buildWorkspaces, pluralSuffix };
